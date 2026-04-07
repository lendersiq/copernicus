/**
 * Loan Profitability — spread vs matched-maturity Treasury (BankersIQ trates + api_key).
 * Curve fetch, directory join, and row math live in js/tools (fred-client, customer-directory, loan-spread).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  function loanRiskDisclaimer() {
    var sk = LA.Skills && LA.Skills.get && LA.Skills.get('banking.loan-profitability');
    return (sk && sk.riskDisclaimer) || '';
  }

  function runWithCurve(state, opt, curve) {
    var skill = LA.Skills.get('banking.loan-profitability') || { assumptions: {} };
    var a = skill.assumptions;
    var tools = LA.tools || {};
    var buildRows = tools.buildLoanTreasurySpreadRows;
    var summarizeCurve = tools.summarizeTreasuryCurveForResult;
    if (typeof buildRows !== 'function' || typeof summarizeCurve !== 'function') {
      return { error: 'Loan spread tools (loan-spread.js) not available.', optionalDataPresent: opt };
    }

    var nameMap = state.customerDirectory || {};
    var loanRows = buildRows(state.loans || [], 'loans', curve, a, nameMap);
    var mortRows = opt.mortgages && (state.mortgages || []).length
      ? buildRows(state.mortgages || [], 'mortgages', curve, a, nameMap)
      : [];
    var all = loanRows.concat(mortRows);

    var totalNet = 0;
    var totalNetLife = 0;
    var totalBal = 0;
    for (var j = 0; j < all.length; j++) {
      totalNet += all[j].estNetSpreadMonthly;
      totalNetLife += all[j].estNetSpreadRemaining != null ? all[j].estNetSpreadRemaining : 0;
      totalBal += all[j].balance;
    }

    var treasSrc = curve.curveSource === 'bankersiq_trates' ? 'BankersIQ Treasury (trates)' : 'Treasury';
    var summary = all.length + ' position' + (all.length !== 1 ? 's' : '') +
      ' · est. net spread next month $' + Math.round(totalNet * 100) / 100 +
      ' · est. net spread remaining (sum) $' + Math.round(totalNetLife * 100) / 100 +
      (opt.mortgages === false
        ? ' · mortgages: optional source not ingested'
        : (mortRows.length ? ' · mortgages: ' + mortRows.length + ' row(s)' : ' · mortgages: ingested (0 rows)')) +
      ' · Treasury: ' + treasSrc + ' · as-of ' + (curve.asOf || '');

    return {
      summary: summary,
      riskDisclaimer: loanRiskDisclaimer(),
      loanProfitability: all,
      yieldCurveSummary: summarizeCurve(curve),
      optionalDataPresent: opt,
      mortgagesIncluded: mortRows.length,
      totals: {
        positions: all.length,
        outstandingBalance: Math.round(totalBal * 100) / 100,
        estNetSpreadMonthly: Math.round(totalNet * 100) / 100,
        estNetSpreadRemaining: Math.round(totalNetLife * 100) / 100
      },
      queryContext: {
        rowsKey: 'loanProfitability',
        skillId: 'banking.query-context',
        entityLabel: 'Loan position',
        entityPlural: 'loan positions',
        idFields: ['reference', 'customerName', 'customerId', 'customer_id'],
        insightsPrimaryKey: 'estNetSpreadMonthly'
      },
      skills: { loanProfitability: a },
      ingestedFiles: LA.Data.summarizeIngestedFiles(state)
    };
  }

  var agent = LA.Agent({
    id: 'loan-profitability',
    name: 'Loan Profitability',
    description: 'Loan-level spread vs Treasury with **contractual amortization**: remaining term from maturity or seasoning, payment from file or inferred level P&I, declining balance month-by-month. Curve from **BankersIQ** trates + **KeyRing** API key (browser-only). Loans CSV required; mortgages and customer directory optional. Not ALM or hedge advice.',
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
      var disclaimer = loanRiskDisclaimer();

      if (typeof tools.loadTreasuryCurveFromKeyRing !== 'function') {
        return { error: 'Treasury tools (fred-client.js) not available.' };
      }

      return tools.loadTreasuryCurveFromKeyRing().then(function (curve) {
        return runWithCurve(state, opt, curve);
      }).catch(function (err) {
        var msg = String(err && err.message || err);
        if (msg === 'BANKERSIQ_TRATES_KEY_REQUIRED') {
          return {
            needsBankersIqKey: true,
            error: 'Save your BankersIQ API key below (Treasury trates). It stays only in this browser.',
            optionalDataPresent: opt,
            riskDisclaimer: disclaimer
          };
        }
        return {
          error: msg,
          optionalDataPresent: opt,
          riskDisclaimer: disclaimer,
          hint: 'Check network and BankersIQ key — https://bankersiq.com/api/luci/trates/ (see AGENTS.md).'
        };
      });
    }
  });

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
