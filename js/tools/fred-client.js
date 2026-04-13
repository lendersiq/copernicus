/**
 * Treasury curve 1..360 months for loan spread math.
 *
 * Primary path (FRED proxy):
 *   Fetches 10 FRED constant-maturity series via the BankersIQ Copernicus proxy
 *   (https://bankersiq.com/api/copernicus/proxy/), then linearly interpolates to a
 *   full 1–360 month curve.  Proxy parameter: `_key=` (same key as trates, stored
 *   in KeyRing as `bankersiq_luci_api`; see KeyRingIds.BANKERSIQ_TRATES_API).
 *   Override proxy base URL: `Copernicus.Fred.copernicusProxyUrl`.
 *
 * Legacy path (BankersIQ trates):
 *   `fetchBankersIqCurve` / `buildMonthlyTreasuryCurve` call
 *   https://bankersiq.com/api/luci/trates/ (pre-built 1-360 curve, `api_key=`).
 *   Override: `Copernicus.Fred.bankersIqTratesUrl`.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  LA.Fred = LA.Fred || {};

  var DEFAULT_BANKERSIQ_TRATES = 'https://bankersiq.com/api/luci/trates/';
  var DEFAULT_COPERNICUS_PROXY  = 'https://bankersiq.com/api/copernicus/proxy/';

  var KNOT_PREVIEW_MONTHS = [1, 12, 24, 60, 120, 240, 360];

  /**
   * FRED series → tenor in months.
   * Values returned by FRED are already in annual percent points (4.35 = 4.35%).
   */
  var FRED_KNOTS = [
    { seriesId: 'DGS3MO', months: 3   },
    { seriesId: 'DGS6MO', months: 6   },
    { seriesId: 'DGS1',   months: 12  },
    { seriesId: 'DGS2',   months: 24  },
    { seriesId: 'DGS3',   months: 36  },
    { seriesId: 'DGS5',   months: 60  },
    { seriesId: 'DGS7',   months: 84  },
    { seriesId: 'DGS10',  months: 120 },
    { seriesId: 'DGS20',  months: 240 },
    { seriesId: 'DGS30',  months: 360 }
  ];

  /* ── Rate helpers ─────────────────────────────────────────────────── */

  /**
   * Single convention for annual rates in spread math and display:
   * **percent points** (7 = 7%, 4.81 = 4.81%), not decimal fraction of 1.
   * BankersIQ trates: 0.0481 → 4.81. Loan CSV may use 6.25, 7, or 0.07 (7%) —
   * values in [0, 0.5) are treated as decimal fractions and scaled ×100.
   * FRED series are already percent points; do NOT pass them through this function.
   */
  function annualRateToPercentPoints(v) {
    var n = Number(v);
    if (!isFinite(n)) return NaN;
    if (n >= 0 && n < 0.5) return n * 100;
    return n;
  }

  /* ── Proxy URL helpers ────────────────────────────────────────────── */

  function copernicusProxyBaseUrl() {
    var u = LA.Fred && LA.Fred.copernicusProxyUrl;
    return (u != null && String(u).trim()) ? String(u).trim() : DEFAULT_COPERNICUS_PROXY;
  }

  /**
   * Build proxy URL for a single FRED series/observations request.
   * Parameter name: `_key` (not `api_key`).
   */
  function buildFredProxyUrl(seriesId, apiKey) {
    var base = String(copernicusProxyBaseUrl()).replace(/[?&]+$/, '');
    var k = String(apiKey || '').trim();
    if (!k) throw new Error('BANKERSIQ_TRATES_KEY_REQUIRED');
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep +
      '_key=' + encodeURIComponent(k) +
      '&service=fred' +
      '&endpoint=series/observations' +
      '&series_id=' + encodeURIComponent(seriesId) +
      '&limit=1&sort_order=desc';
  }

  /** Fetch the most recent non-missing observation for one FRED series via proxy. */
  function fetchFredSeriesLatest(seriesId, apiKey) {
    var url = buildFredProxyUrl(seriesId, apiKey);
    return global.fetch(url, { method: 'GET', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('FRED proxy HTTP ' + res.status + ' (' + seriesId + ')');
        return res.json();
      })
      .then(function (j) {
        var obs = j && j.observations;
        if (!Array.isArray(obs) || !obs.length) {
          throw new Error('FRED proxy: no observations for ' + seriesId);
        }
        var raw = obs[0].value;
        if (raw === '.' || raw == null) {
          throw new Error('FRED proxy: missing value for ' + seriesId);
        }
        var n = parseFloat(raw);
        if (!isFinite(n) || n < 0) {
          throw new Error('FRED proxy: invalid value "' + raw + '" for ' + seriesId);
        }
        return { seriesId: seriesId, annualPercent: n, date: obs[0].date || null };
      });
  }

  /* ── Linear interpolation ─────────────────────────────────────────── */

  /**
   * Build a full 1–360 month array from sparse knots.
   * - Below first knot: flat at first knot rate.
   * - Between knots: linear interpolation.
   * - Above last knot: flat at last knot rate (last knot IS month 360; safe guard only).
   * @param {Array<{months:number, annualPercent:number}>} knots  sorted ascending
   */
  function interpolateMonthlyFromKnots(knots) {
    var first = knots[0];
    var last  = knots[knots.length - 1];
    var monthly = [];
    for (var m = 1; m <= 360; m++) {
      var pct;
      if (m <= first.months) {
        pct = first.annualPercent;
      } else if (m >= last.months) {
        pct = last.annualPercent;
      } else {
        var lo = first, hi = last;
        for (var ki = 0; ki < knots.length - 1; ki++) {
          if (m >= knots[ki].months && m <= knots[ki + 1].months) {
            lo = knots[ki];
            hi = knots[ki + 1];
            break;
          }
        }
        var t = (m - lo.months) / (hi.months - lo.months);
        pct = lo.annualPercent + t * (hi.annualPercent - lo.annualPercent);
      }
      monthly.push({ month: m, treasuryAnnualPct: Math.round(pct * 10000) / 10000 });
    }
    return monthly;
  }

  /* ── FRED proxy curve builder ─────────────────────────────────────── */

  /**
   * Fetch all 10 FRED Treasury series in parallel via proxy → interpolated 1–360 month curve.
   * FRED values are already in annual percent points; no conversion applied.
   */
  function buildTreasuryCurveFromFredProxy(apiKey) {
    var biq = apiKey && String(apiKey).trim() ? String(apiKey).trim() : null;
    if (!biq) return Promise.reject(new Error('BANKERSIQ_TRATES_KEY_REQUIRED'));

    var fetches = FRED_KNOTS.map(function (k) {
      return fetchFredSeriesLatest(k.seriesId, biq);
    });

    return Promise.all(fetches).then(function (results) {
      var knots = results.map(function (r, i) {
        return {
          seriesId: r.seriesId,
          months: FRED_KNOTS[i].months,
          annualPercent: r.annualPercent,
          date: r.date
        };
      });
      knots.sort(function (a, b) { return a.months - b.months; });

      var monthly = interpolateMonthlyFromKnots(knots);
      var asOf = results[0].date || new Date().toISOString().slice(0, 10);

      var knotsForDisplay = [];
      for (var ki = 0; ki < KNOT_PREVIEW_MONTHS.length; ki++) {
        var mo = KNOT_PREVIEW_MONTHS[ki];
        knotsForDisplay.push({
          months: mo,
          series_id: 'fred_interp',
          annualPercent: monthly[mo - 1].treasuryAnnualPct
        });
      }

      return {
        monthly: monthly,
        knots: knotsForDisplay,
        rawKnots: knots,
        asOf: asOf,
        curveSource: 'fred_proxy',
        treasuryServiceDescription: 'FRED via BankersIQ proxy · ' +
          knots.map(function (k) { return k.seriesId; }).join(', ') +
          ' · interpolated 1–360 mo'
      };
    });
  }

  /* ── Legacy BankersIQ trates path ────────────────────────────────── */

  function bankersIqTratesUrl() {
    var u = LA.Fred && LA.Fred.bankersIqTratesUrl;
    return (u != null && String(u).trim()) ? String(u).trim() : DEFAULT_BANKERSIQ_TRATES;
  }

  function bankersIqTratesUrlWithKey(apiKey) {
    var base = String(bankersIqTratesUrl()).trim().replace(/[?&]+$/, '');
    var k = String(apiKey).trim();
    if (!k) throw new Error('BANKERSIQ_TRATES_KEY_REQUIRED');
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'api_key=' + encodeURIComponent(k);
  }

  function fetchBankersIqCurve(bankersIqApiKey) {
    var url = bankersIqTratesUrlWithKey(bankersIqApiKey);
    return global.fetch(url, { method: 'GET', credentials: 'omit' })
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
          var annualPct = annualRateToPercentPoints(raw);
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

  function buildMonthlyTreasuryCurve(bankersIqApiKey) {
    var biq = bankersIqApiKey && String(bankersIqApiKey).trim() ? String(bankersIqApiKey).trim() : null;
    if (!biq) return Promise.reject(new Error('BANKERSIQ_TRATES_KEY_REQUIRED'));
    return fetchBankersIqCurve(biq);
  }

  /* ── Shared helpers ───────────────────────────────────────────────── */

  function treasuryYieldForTermMonths(curve, termMonths) {
    if (!curve || !curve.monthly || !curve.monthly.length) return null;
    var m = Math.max(1, Math.min(360, Math.round(termMonths || 1)));
    return curve.monthly[m - 1].treasuryAnnualPct;
  }

  /* ── Primary entry point ──────────────────────────────────────────── */

  /**
   * BankersIQ key from KeyRing → FRED proxy Treasury curve (1–360 mo, linearly
   * interpolated from 10 constant-maturity series).
   * Rejects with Error message `BANKERSIQ_TRATES_KEY_REQUIRED` when no key.
   */
  function loadTreasuryCurveFromKeyRing() {
    var kr = LA.KeyRing && typeof LA.KeyRing.get === 'function' && LA.KeyRingIds;
    var pBiq = kr ? LA.KeyRing.get(LA.KeyRingIds.BANKERSIQ_TRATES_API) : Promise.resolve(null);
    return pBiq.then(function (biqKey) {
      var biq = biqKey && String(biqKey).trim() ? String(biqKey).trim() : null;
      if (!biq) return Promise.reject(new Error('BANKERSIQ_TRATES_KEY_REQUIRED'));
      return buildTreasuryCurveFromFredProxy(biq);
    });
  }

  LA.tools = LA.tools || {};
  LA.tools.buildMonthlyTreasuryCurve       = buildMonthlyTreasuryCurve;      // legacy trates
  LA.tools.fetchBankersIqTreasuryCurve     = fetchBankersIqCurve;            // legacy trates
  LA.tools.buildTreasuryCurveFromFredProxy = buildTreasuryCurveFromFredProxy; // FRED proxy
  LA.tools.fetchFredSeriesLatest           = fetchFredSeriesLatest;
  LA.tools.treasuryYieldForTermMonths      = treasuryYieldForTermMonths;
  LA.tools.annualRateToPercentPoints       = annualRateToPercentPoints;
  LA.tools.loadTreasuryCurveFromKeyRing    = loadTreasuryCurveFromKeyRing;
  LA.tools.FRED_KNOTS                      = FRED_KNOTS;
})(typeof window !== 'undefined' ? window : this);
