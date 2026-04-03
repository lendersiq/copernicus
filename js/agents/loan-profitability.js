/**
 * Loan Profitability — spread vs matched-maturity Treasury (BankersIQ trates + api_key).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  var RISK_DISCLAIMER =
    'Outputs are illustrative spread math only, not ALM, FTP, hedge, or fair-value advice. ' +
    'Treasury inputs must be current and approved under your model risk / IRR policy. ' +
    'Mis-stated discount or benchmark rates can materially misstate economic value and NII.';

  function inferTermMonths(acc, defaultTerm) {
    var t = acc.term;
    if (t != null && !isNaN(Number(t))) {
      return Math.max(1, Math.min(360, Math.round(Number(t))));
    }
    return Math.max(1, Math.min(360, defaultTerm));
  }

  function lookupDirectoryName(dir, val) {
    if (!dir || val == null || val === '') return '';
    var loader = global.CSVLoader;
    var k = loader && loader.getNormalizedCustomerId
      ? loader.getNormalizedCustomerId(val)
      : String(val).trim();
    if (!k) return '';
    if (dir[k] != null) return String(dir[k]).trim();
    var n = Number(String(k).replace(/,/g, ''));
    if (!isNaN(n) && isFinite(n) && Math.abs(n) < 1e15) {
      var ik = String(Math.round(n));
      if (dir[ik] != null) return String(dir[ik]).trim();
    }
    return '';
  }

  /**
   * Match loan row to customer directory: mapped ids first, then any raw cell (handles
   * mis-mapped customerId when another column still holds the relationship key).
   */
  function resolveCustomerName(acc, dir) {
    if (!dir || typeof dir !== 'object') return '';
    var nm = lookupDirectoryName(dir, acc.customerId);
    if (nm) return nm;
    nm = lookupDirectoryName(dir, acc.accountId);
    if (nm) return nm;
    var raw = acc.raw;
    if (!Array.isArray(raw)) return '';
    for (var i = 0; i < raw.length; i++) {
      nm = lookupDirectoryName(dir, raw[i]);
      if (nm) return nm;
    }
    return '';
  }

  function processLoanRows(rows, sourceLabel, curve, assumptions, customerDirectory) {
    var out = [];
    var dir = customerDirectory || {};
    var servicingBps = assumptions.annualServicingBps != null ? assumptions.annualServicingBps : 25;
    var defaultTerm = assumptions.defaultTermMonths != null ? assumptions.defaultTermMonths : 60;
    var tools = LA.tools || {};
    for (var i = 0; i < rows.length; i++) {
      var acc = rows[i];
      var term = inferTermMonths(acc, defaultTerm);
      var rateRaw = acc.rate != null ? Number(acc.rate) : 0;
      var rate = typeof tools.annualRateToPercentPoints === 'function'
        ? tools.annualRateToPercentPoints(rateRaw)
        : rateRaw;
      if (!isFinite(rate)) rate = 0;
      var bal = acc.balance != null ? acc.balance : 0;
      var treas = typeof tools.treasuryYieldForTermMonths === 'function'
        ? tools.treasuryYieldForTermMonths(curve, term)
        : null;
      if (treas == null) continue;
      var spread = Math.round((rate - treas) * 10000) / 10000;
      var grossSpreadMonthly = bal * (spread / 100) / 12;
      var servicingMonthly = bal * (servicingBps / 10000) / 12;
      var netMonthly = Math.round((grossSpreadMonthly - servicingMonthly) * 100) / 100;
      var cid = acc.customerId != null ? String(acc.customerId).trim() : '';
      var customerName = resolveCustomerName(acc, dir);
      out.push({
        customerId: cid,
        customerName: customerName,
        reference: acc.accountId || acc.customerId,
        accountId: acc.accountId,
        balance: Math.round(bal * 100) / 100,
        rateAnnualPct: Math.round(rate * 10000) / 10000,
        termMonths: term,
        treasuryAnnualPct: Math.round(treas * 10000) / 10000,
        spreadAnnualPct: spread,
        estGrossSpreadMonthly: Math.round(grossSpreadMonthly * 100) / 100,
        estServicingMonthly: Math.round(servicingMonthly * 100) / 100,
        estNetSpreadMonthly: netMonthly,
        sourceFileType: sourceLabel
      });
    }
    return out;
  }

  function runWithCurve(state, opt, curve) {
    var skill = LA.Skills.get('banking.loan-profitability') || { assumptions: {} };
    var a = skill.assumptions;
    var nameMap = state.customerDirectory || {};

    var loanRows = processLoanRows(state.loans || [], 'loans', curve, a, nameMap);
    var mortRows = opt.mortgages && (state.mortgages || []).length
      ? processLoanRows(state.mortgages || [], 'mortgages', curve, a, nameMap)
      : [];
    var all = loanRows.concat(mortRows);

    var totalNet = 0;
    var totalBal = 0;
    for (var j = 0; j < all.length; j++) {
      totalNet += all[j].estNetSpreadMonthly;
      totalBal += all[j].balance;
    }

    var treasSrc = curve.curveSource === 'bankersiq_trates' ? 'BankersIQ Treasury (trates)' : 'Treasury';
    var summary = all.length + ' position' + (all.length !== 1 ? 's' : '') +
      ' · est. net spread (monthly) $' + Math.round(totalNet * 100) / 100 +
      (opt.mortgages === false
        ? ' · mortgages: optional source not ingested'
        : (mortRows.length ? ' · mortgages: ' + mortRows.length + ' row(s)' : ' · mortgages: ingested (0 rows)')) +
      ' · Treasury: ' + treasSrc + ' · as-of ' + (curve.asOf || '');

    return {
      summary: summary,
      riskDisclaimer: RISK_DISCLAIMER,
      loanProfitability: all,
      yieldCurveSummary: {
        asOf: curve.asOf,
        curveSource: curve.curveSource,
        treasuryServiceDescription: curve.treasuryServiceDescription,
        knotCount: curve.knots ? curve.knots.length : 0,
        knots: (curve.knots || []).map(function (k) {
          return { series_id: k.series_id, months: k.months, annualPercent: k.annualPercent };
        })
      },
      optionalDataPresent: opt,
      mortgagesIncluded: mortRows.length,
      totals: {
        positions: all.length,
        outstandingBalance: Math.round(totalBal * 100) / 100,
        estNetSpreadMonthly: Math.round(totalNet * 100) / 100
      },
      queryContext: {
        rowsKey: 'loanProfitability',
        skillId: 'banking.query-context',
        entityLabel: 'Loan position',
        entityPlural: 'loan positions',
        idFields: ['reference', 'customerName', 'customerId', 'customer_id'],
        insightsPrimaryKey: 'estNetSpreadMonthly',
        fieldCatalog: [
          { key: 'reference', labels: ['loan', 'account', 'id', 'loan number'], fmt: 'text' },
          { key: 'customerName', labels: ['name', 'customer name', 'full name', 'borrower'], fmt: 'text' },
          { key: 'customerId', labels: ['customer', 'customer id', 'portfolio'], fmt: 'text' },
          { key: 'balance', labels: ['balance', 'outstanding', 'principal', 'outstanding balance'], fmt: 'dollar' },
          { key: 'rateAnnualPct', labels: ['rate', 'coupon', 'apr', 'note rate'], fmt: 'pct' },
          { key: 'termMonths', labels: ['term', 'maturity', 'tenor', 'months'], fmt: 'int' },
          { key: 'treasuryAnnualPct', labels: ['treasury', 'risk free', 'matched treasury'], fmt: 'pct' },
          { key: 'spreadAnnualPct', labels: ['spread', 'nim', 'margin over treasury'], fmt: 'pct' },
          { key: 'estNetSpreadMonthly', labels: ['net spread', 'monthly profit', 'contribution'], fmt: 'dollar' },
          { key: 'sourceFileType', labels: ['mortgage', 'loans file'], fmt: 'text' }
        ]
      },
      skills: { loanProfitability: a },
      ingestedFiles: (state.meta && state.meta.files || []).map(function (f) {
        return { name: f.name, type: f.type, rows: f.rowCount };
      })
    };
  }

  var agent = LA.Agent({
    id: 'loan-profitability',
    name: 'Loan Profitability',
    description: 'Loan-level spread vs matched-maturity Treasury yields. Treasury curve is fetched from **BankersIQ** trates (`/api/luci/trates/`) with your **BankersIQ API key** (browser-only). General loans CSV required; mortgages and customer directory (customerId → name) optional for display and natural-language references. Not ALM or hedge advice.',
    requiredDataTypes: ['loans'],
    optionalDataTypes: ['mortgages', 'customers'],
    run: function () {
      var ingest = LA.Data.ensureIngested(['loans'], { optionalTypes: ['mortgages', 'customers'] });
      if (!ingest.ok) {
        return {
          needsData: true,
          missingTypes: ingest.missingTypes || ['loans'],
          error: ingest.error || 'Ingest at least one loans CSV (general lending). Mortgage loans are optional.'
        };
      }

      var state = ingest.state;
      var opt = ingest.optionalDataPresent || {};
      var tools = LA.tools || {};

      if (typeof tools.buildMonthlyTreasuryCurve !== 'function') {
        return { error: 'Treasury tools (fred-client.js) not available.' };
      }

      var kr = LA.KeyRing && typeof LA.KeyRing.get === 'function' && LA.KeyRingIds;
      var pBiq = kr ? LA.KeyRing.get(LA.KeyRingIds.BANKERSIQ_TRATES_API) : Promise.resolve(null);

      return pBiq.then(function (biqKey) {
        var biq = biqKey && String(biqKey).trim() ? String(biqKey).trim() : null;
        return tools.buildMonthlyTreasuryCurve(biq).then(function (curve) {
          return runWithCurve(state, opt, curve);
        }).catch(function (err) {
          var msg = String(err && err.message || err);
          if (msg === 'BANKERSIQ_TRATES_KEY_REQUIRED') {
            return {
              needsBankersIqKey: true,
              error: 'Save your BankersIQ API key below (Treasury trates). It stays only in this browser.',
              optionalDataPresent: opt,
              riskDisclaimer: RISK_DISCLAIMER
            };
          }
          return {
            error: msg,
            optionalDataPresent: opt,
            riskDisclaimer: RISK_DISCLAIMER,
            hint: 'Check network and BankersIQ key — https://bankersiq.com/api/luci/trates/ (see AGENTS.md).'
          };
        });
      });
    }
  });

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
