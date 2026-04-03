/**
 * Treasury curve 1..360 for loan spread math (BankersIQ trates only).
 *
 * Endpoint: `https://bankersiq.com/api/luci/trates/?api_key=…` (vendor path; or override
 * base URL without query via `Copernicus.Fred.bankersIqTratesUrl`).
 * Key: `Copernicus.KeyRing` id `bankersiq_luci_api` (see KeyRingIds.BANKERSIQ_TRATES_API).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  LA.Fred = LA.Fred || {};

  var DEFAULT_BANKERSIQ_TRATES = 'https://bankersiq.com/api/luci/trates/';

  var KNOT_PREVIEW_MONTHS = [1, 12, 24, 60, 120, 240, 360];

  /**
   * Single convention for annual rates used in spread math and display:
   * **percent points** (7 = 7%, 4.81 = 4.81%), not decimal fraction of 1.
   * BankersIQ trates: 0.0481 → 4.81. Loan CSV may use 6.25, 7, or 0.07 meaning 7% — values in [0, 0.5)
   * are treated as decimal fractions and scaled ×100 so they match Treasury.
   */
  function annualRateToPercentPoints(v) {
    var n = Number(v);
    if (!isFinite(n)) return NaN;
    if (n >= 0 && n < 0.5) return n * 100;
    return n;
  }

  function rawRateToAnnualPercent(v) {
    return annualRateToPercentPoints(v);
  }

  function bankersIqTratesUrl() {
    var u = LA.Fred && LA.Fred.bankersIqTratesUrl;
    return (u != null && String(u).trim()) ? String(u).trim() : DEFAULT_BANKERSIQ_TRATES;
  }

  /** Append `api_key` to base URL (supports base that already has query params). */
  function bankersIqTratesUrlWithKey(apiKey) {
    var base = String(bankersIqTratesUrl()).trim().replace(/[?&]+$/, '');
    var k = String(apiKey).trim();
    if (!k) throw new Error('BANKERSIQ_TRATES_KEY_REQUIRED');
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'api_key=' + encodeURIComponent(k);
  }

  function fetchBankersIqCurve(bankersIqApiKey) {
    var url = bankersIqTratesUrlWithKey(bankersIqApiKey);
    return fetch(url, { method: 'GET', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('Treasury service HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var values = j && j.values;
        if (!values || typeof values !== 'object') {
          throw new Error('Invalid Treasury response (expected values map).');
        }
        var monthly = [];
        for (var m = 1; m <= 360; m++) {
          var raw = values[String(m)];
          if (raw == null) raw = values[m];
          var annualPct = rawRateToAnnualPercent(raw);
          if (!isFinite(annualPct)) {
            throw new Error('Treasury curve missing month ' + m);
          }
          monthly.push({
            month: m,
            treasuryAnnualPct: Math.round(annualPct * 10000) / 10000
          });
        }
        var knots = [];
        for (var ki = 0; ki < KNOT_PREVIEW_MONTHS.length; ki++) {
          var mo = KNOT_PREVIEW_MONTHS[ki];
          knots.push({
            months: mo,
            series_id: 'trates',
            annualPercent: monthly[mo - 1].treasuryAnnualPct
          });
        }
        var asOf = new Date().toISOString().slice(0, 10);
        return {
          monthly: monthly,
          knots: knots,
          asOf: asOf,
          curveSource: 'bankersiq_trates',
          treasuryServiceDescription: j.description || null
        };
      });
  }

  /**
   * @param {string|null|undefined} bankersIqApiKey — required
   */
  function buildMonthlyTreasuryCurve(bankersIqApiKey) {
    var biq = bankersIqApiKey && String(bankersIqApiKey).trim() ? String(bankersIqApiKey).trim() : null;
    if (!biq) {
      return Promise.reject(new Error('BANKERSIQ_TRATES_KEY_REQUIRED'));
    }
    return fetchBankersIqCurve(biq);
  }

  function treasuryYieldForTermMonths(curve, termMonths) {
    if (!curve || !curve.monthly || !curve.monthly.length) return null;
    var m = Math.max(1, Math.min(360, Math.round(termMonths || 1)));
    return curve.monthly[m - 1].treasuryAnnualPct;
  }

  LA.tools = LA.tools || {};
  LA.tools.buildMonthlyTreasuryCurve = buildMonthlyTreasuryCurve;
  LA.tools.fetchBankersIqTreasuryCurve = fetchBankersIqCurve;
  LA.tools.treasuryYieldForTermMonths = treasuryYieldForTermMonths;
  LA.tools.annualRateToPercentPoints = annualRateToPercentPoints;
})(typeof window !== 'undefined' ? window : this);
