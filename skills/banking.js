/**
 * Banking domain skills — centralized assumptions, formulas, and AI context.
 * All agents consume these via Copernicus.Skills.get(id).
 * User overrides persist via Copernicus.Store.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Skills) return;

  /* ── Credit for Funding ────────────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.credit-for-funding',
    name: 'Credit for Funding',
    domain: 'banking',
    assumptions: {
      rate: 0.03
    },
    formulas: {
      monthlyCredit: function (avgBalance, rate) {
        return (avgBalance * (rate != null ? rate : 0.03)) / 12;
      },
      annualCredit: function (avgBalance, rate) {
        return avgBalance * (rate != null ? rate : 0.03);
      }
    },
    context: 'Checking deposits generate an earnings credit for the bank (credit for funding), ' +
      'not a cost of funds. The ECR (Earnings Credit Rate) is applied to average collected ' +
      'balances. Default rate: 3.00% annually. Divide by 12 for monthly.',
    sources: ['Internal bank policy', 'FTP methodology']
  });

  /* ── Transaction Processing Costs ──────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.processing-costs',
    name: 'Transaction Processing Costs',
    domain: 'banking',
    assumptions: {
      perDeposit: 0.25,
      perCheck: 0.15,
      perElectronic: 0.05,
      perNSF: 3.00,
      accountMaintenanceMonthly: 8.00
    },
    formulas: {
      transactionCost: function (deposits, checks, nsf, a) {
        a = a || {};
        return (deposits * (a.perDeposit || 0.25)) +
               (checks * (a.perCheck || 0.15)) +
               (nsf * (a.perNSF || 3.00));
      },
      totalMonthlyCost: function (deposits, checks, nsf, accountCount, a) {
        a = a || {};
        var txn = (deposits * (a.perDeposit || 0.25)) +
                  (checks * (a.perCheck || 0.15)) +
                  (nsf * (a.perNSF || 3.00));
        return txn + (accountCount * (a.accountMaintenanceMonthly || 8.00));
      }
    },
    context: 'Internal bank processing costs (activity-based costing). ' +
      'Per deposit: $0.25, per check: $0.15, per electronic: $0.05, ' +
      'per NSF item: $3.00, account maintenance: $8.00/month. ' +
      'These are the bank\'s internal costs, not customer-facing fees.',
    sources: [
      'Fed 2026 Check Services Fee Schedule',
      'SouthState / Kohl Analytics Group',
      'Oregon State Banking Services 2025-27'
    ]
  });

  /* ── Customer Segmentation ─────────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.segmentation',
    name: 'Customer Segmentation',
    domain: 'banking',
    assumptions: {
      primaryDepthThreshold: 70,
      primaryBalanceThreshold: 50000,
      growthDepthThreshold: 50,
      growthBalanceThreshold: 20000,
      growthTenureThreshold: 3,
      developingDepthThreshold: 30
    },
    context: 'Customer segments by relationship depth and balance: ' +
      'Primary (depth>=70, deposits>=$50K), Growth (depth>=50, deposits>=$20K or tenure>=3yr), ' +
      'Developing (depth>=30), Emerging (has deposits), Unknown.',
    sources: ['Internal segmentation model']
  });

  /* ── Relationship Depth Scoring ────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.relationship-depth',
    name: 'Relationship Depth Scoring',
    domain: 'banking',
    assumptions: {
      primaryChecking: 30,
      directDeposit: 20,
      loanRelationship: 20,
      savingsOrCD: 15,
      digitalEngagement: 5,
      tenureOver5: 10,
      maxScore: 100
    },
    formulas: {
      score: function (profile, a) {
        a = a || {};
        var s = 0;
        if (profile.primaryChecking) s += (a.primaryChecking || 30);
        if (profile.directDeposit) s += (a.directDeposit || 20);
        if (profile.hasLoan) s += (a.loanRelationship || 20);
        if (profile.hasSavingsOrCD) s += (a.savingsOrCD || 15);
        s += (a.digitalEngagement || 5);
        if (profile.tenureYearsMax != null && profile.tenureYearsMax >= 5) s += (a.tenureOver5 || 10);
        return Math.min(s, a.maxScore || 100);
      }
    },
    context: 'Relationship depth score (0-100): Primary checking +30, ' +
      'Direct deposit +20, Loan relationship +20, Savings/CD +15, ' +
      'Digital engagement +5, Tenure>5yr +10.',
    sources: ['Relationship depth model']
  });

  /* ── Share of Wallet ───────────────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.share-of-wallet',
    name: 'Share of Wallet',
    domain: 'banking',
    assumptions: {
      depthWeight: 0.5,
      walletWeight: 0.5
    },
    context: 'Composite SOW score (0-100) blends relationship depth (50%) ' +
      'and income-based wallet share (50%). Both components normalized to 0-100.',
    sources: ['SOW composite model']
  });

  /* ── Column Inference Context ──────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.column-inference',
    name: 'Column Inference Context',
    domain: 'banking',
    assumptions: {},
    context: 'In banking CSV files, "Portfolio" typically means customer ID ' +
      '(the account holder). Common patterns: Statement_Rate = interest rate, ' +
      'Previous_Average_Balance = balance, PMTD_* = period-to-date metrics. ' +
      'Customer IDs are typically integers with consistent formatting, ' +
      'moderate cardinality, and non-monotonic ordering.',
    sources: ['Banking data conventions']
  });

  /* ── Query context (NL → fields) — referenced by banking agents; engine stays domain-agnostic ── */

  LA.Skills.register({
    id: 'banking.query-context',
    name: 'Banking Query Context',
    domain: 'banking',
    assumptions: {},
    context: 'Maps natural language about banking metrics to result JSON field keys. ' +
      'Agents attach queryContext.rowsKey + skillId so Copernicus.AI resolves prompts from data + this catalog.',
    sources: ['Copernicus query model'],
    queryContext: {
      entityLabel: 'Customer',
      entityPlural: 'customers',
      idFields: ['reference', 'customerName', 'customerId', 'customer_id'],
      unprofitableMetricKey: 'monthlyProfit',
      fieldCatalog: [
        { key: 'customerName', labels: ['name', 'customer name', 'full name', 'fullname', 'display name'], fmt: 'text' },
        { key: 'reference', labels: ['reference', 'label', 'display', 'who'], fmt: 'text' },
        { key: 'totalBalance', labels: ['balance', 'balances', 'ledger', 'checking balance', 'average balance', 'avg balance'], fmt: 'dollar' },
        { key: 'totalDeposits', labels: ['deposits', 'deposit', 'total deposits', 'deposit balance', 'checking deposits'], fmt: 'dollar' },
        { key: 'monthlyProfit', labels: ['profit', 'profits', 'monthly profit', 'p and l', 'pnl', 'income', 'earnings'], fmt: 'dollar' },
        { key: 'totalRevenue', labels: ['revenue', 'total revenue', 'rev'], fmt: 'dollar' },
        { key: 'totalCost', labels: ['cost', 'costs', 'total cost', 'expense', 'expenses'], fmt: 'dollar' },
        { key: 'creditForFunding', labels: ['funding', 'credit for funding', 'ecf', 'ecr', 'earnings credit'], fmt: 'dollar' },
        { key: 'interestPaid', labels: ['interest', 'interest paid', 'int paid'], fmt: 'dollar' },
        { key: 'netFeeRevenue', labels: ['fee', 'fees', 'net fee', 'service charge'], fmt: 'dollar' },
        { key: 'numDeposits', labels: ['number of deposits', 'deposit count', 'deposit items', 'credits'], fmt: 'int' },
        { key: 'numChecks', labels: ['checks', 'check', 'debits', 'check count'], fmt: 'int' },
        { key: 'numNSF', labels: ['nsf', 'nonsufficient', 'nsf items'], fmt: 'int' },
        { key: 'avgRate', labels: ['rate', 'rates', 'apr', 'apy', 'interest rate'], fmt: 'pct' },
        { key: 'tenureYears', labels: ['tenure', 'years', 'age', 'relationship length'], fmt: 'years' },
        { key: 'accountCount', labels: ['accounts', 'account count', 'number of accounts'], fmt: 'int' },
        { key: 'shareOfWallet', labels: ['sow', 'share of wallet', 'wallet', 'wallet share'], fmt: 'score' },
        { key: 'depthScore', labels: ['depth', 'relationship depth', 'depth score', 'score'], fmt: 'score' },
        { key: 'totalLoans', labels: ['loans', 'loan', 'loan balance', 'total loans'], fmt: 'dollar' }
      ]
    }
  });

})(typeof window !== 'undefined' ? window : this);
