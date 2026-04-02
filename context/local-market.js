/**
 * =============================================================================
 * LOCAL MARKET CONTEXT (this deployment / geography)
 * =============================================================================
 * Not general banking rules — edit when you deploy to another region.
 *
 * Skill registered: local.market  →  Copernicus.Skills.get('local.market')
 *
 * -----------------------------------------------------------------------------
 * Household income
 * -----------------------------------------------------------------------------
 * Assumption: average household income  $70,000 / year  (annual)
 *
 * Use: When ingested CSVs have no per-customer income, the Share of Wallet
 * agent uses assumptions.averageHouseholdIncome (with segment multipliers)
 * for the deposit-vs-implied-wallet-pool half of the composite score.
 *
 * Code: LA.Skills.get('local.market').assumptions.averageHouseholdIncome
 * (this file: context/local-market.js)
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Skills) return;

  LA.Skills.register({
    id: 'local.market',
    name: 'Local market context',
    domain: 'local',
    assumptions: {
      averageHouseholdIncome: 70000
    },
    context: 'Deployment-specific market stats (e.g. typical household income for a geography). ' +
      'Used only when agents need a fallback and CSV data does not supply a value. ' +
      'Documented in the file header comment above.',
    sources: ['Local market research']
  });
})(typeof window !== 'undefined' ? window : this);
