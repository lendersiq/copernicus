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

  /* ── Field Inference Context ──────────────────────────────────────── */

  LA.Skills.register({
    id: 'banking.field-inference',
    name: 'Field Inference Context',
    domain: 'banking',
    assumptions: {},
    context: 'In banking CSV files, "Portfolio" (and CIF, relationship id, member id, borrower id) ' +
      'is the relationship / customer key — map it to customerId. Risk_Rating, credit grade, PD, LGD, ' +
      'FICO, and two-character letter buckets are never customer identifiers. ' +
      'Loan number, note number, contract id belong on the loan reference field, not customerId. ' +
      'Statement_Rate = interest rate; Previous_Average_Balance = balance; PMTD_* = period-to-date. ' +
      'Field signal test: Ask about **inferred vs ai-engine**, **anomalies**, or **severity** — the agent ships `fieldSignalLexicon` and the engine answers from that glossary.',
    sources: ['Banking data conventions']
  });

  /* ── Profit column header signals (checking PMTD / DDA; stem-aware discovery) ── */

  LA.Skills.register({
    id: 'banking.profit-column-signals',
    name: 'Profit column header signals',
    domain: 'banking',
    assumptions: {},
    context: 'Header aliases for PMTD and DDA profitability columns on checking extracts. ' +
      'Bundled as headerSignals.checkingProfitability; matched by js/tools/profit-column-discovery.js.',
    sources: ['Core banking statement conventions', 'PMTD patterns'],
    headerSignals: {
      checkingProfitability: {
        interestEarned: [
          'pmtd_interest_earned', 'interest_earned', 'interest earned', 'int_earned',
          'ytd_interest', 'interest_income', 'int_income', 'interest_credit',
          'credit_interest', 'earned_interest', 'int_credited', 'interest_accrued',
          'accrued_interest', 'interest_paid_customer', 'paid_interest',
          'period_interest', 'mtd_interest', 'cycle_interest', 'stmt_interest',
          'interest_revenue', 'dividend_earned', 'int_earn', 'pmtd_int_earned',
          'interest_recognized'
        ],
        serviceCharge: [
          'pmtd_service_charge', 'service_charge', 'service charge', 'monthly_fee',
          'maint_fee', 'maintenance_fee', 'account_fee', 'service_chg', 'svc_charge',
          'svc_chg', 'assessed_charge', 'eval_fee', 'periodic_fee', 'account_service_fee',
          'dda_service_charge', 'mgmt_fee', 'management_fee', 'service_assessment',
          'monthly_service_fee', 'maint_charge', 'fee_service', 'charge_service'
        ],
        serviceChargeWaived: [
          'pmtd_service_charge_waived', 'service_charge_waived', 'charge_waived',
          'fee_waived', 'waived_fee', 'waived_service', 'service_waiver',
          'fee_waiver', 'waiver_service', 'reversal_service_charge', 'svc_charge_waived',
          'waived_maint', 'forgiven_fee', 'fee_reversal', 'charge_reversal'
        ],
        otherCharges: [
          'pmtd_other_charges', 'other_charges', 'other charges', 'misc_charges',
          'misc_fees', 'other_fees', 'ancillary_charges', 'miscellaneous_fee',
          'other_service_charges', 'stop_pay_fee', 'wire_fee', 'overdraft_fee',
          'od_fee', 'item_fee', 'misc_debit', 'other_debits', 'sundry_charges',
          'additional_charges'
        ],
        otherChargesWaived: [
          'pmtd_other_charges_waived', 'other_charges_waived', 'other_waived',
          'misc_waived', 'waived_other', 'misc_fee_waiver', 'od_waiver',
          'fee_credit_misc', 'charge_credit_other'
        ],
        numDeposits: [
          'pmtd_number_of_deposits', 'number_of_deposits', 'num_deposits',
          'deposit_count', 'number_of_credits', 'num_credits', 'credit_count',
          'credit_items', 'deposit_items', 'count_deposits', 'deposits_count',
          'number_credits', 'ach_credits_count', 'incoming_credits',
          'credit_transactions', 'num_credit_items', 'pmtd_deposits', 'period_deposits',
          'deposit_number'
        ],
        numChecks: [
          'pmtd_checks', 'number_of_checks', 'check_count', 'num_checks',
          'number_of_debits', 'num_debits', 'debit_count', 'checks_paid',
          'checks_written', 'draft_count', 'num_drafts', 'share_drafts',
          'ach_debits_count', 'withdrawal_items', 'debit_items', 'check_items',
          'num_check_paid', 'cleared_checks', 'paid_checks', 'pmtd_debits'
        ],
        numNSF: [
          'pmtd_number_of_items_nsf', 'number_of_items_nsf', 'nsf_count',
          'nsf_items', 'nsf', 'nsf_number', 'items_nsf', 'nonsufficient_funds',
          'nonsufficient', 'insufficient_funds', 'insufficient_fund',
          'returned_item', 'return_items', 'bounced_item', 'od_items_nsf',
          'nsf_transactions', 'reject_items', 'unpaid_items', 'dishonored_items'
        ],
        avgBalance: [
          'previous_average_balance', 'average_balance', 'avg_balance', 'avg_bal',
          'mean_balance', 'average_collected_balance', 'collected_average',
          'avg_collected_balance', 'ledger_average', 'stmt_average_balance',
          'statement_average', 'cycle_average_balance', 'prior_avg_balance',
          'avg_ledger_balance', 'mean_daily_balance', 'mdb', 'adb',
          'average_book_balance', 'avg_book', 'collected_bal_avg'
        ]
      }
    }
  });

  /* ── Loan profitability (Treasury curve match + spread) ───────────── */

  LA.Skills.register({
    id: 'banking.loan-profitability',
    name: 'Loan Profitability',
    domain: 'banking',
    assumptions: {
      defaultTermMonths: 60,
      annualServicingBps: 25
    },
    formulas: {
      spreadAnnualPct: function (loanRatePct, treasuryPct) {
        return (loanRatePct != null ? loanRatePct : 0) - (treasuryPct != null ? treasuryPct : 0);
      },
      estGrossSpreadMonthly: function (balance, spreadAnnualPct) {
        return (balance || 0) * ((spreadAnnualPct || 0) / 100) / 12;
      },
      estServicingMonthly: function (balance, annualServicingBps) {
        var bps = annualServicingBps != null ? annualServicingBps : 25;
        return (balance || 0) * (bps / 10000) / 12;
      }
    },
    context: 'Matches each loan term (months) to a monthly Treasury curve from BankersIQ (HTTPS /api/luci/trates/ with api_key via Copernicus.KeyRing). ' +
      'Service outages, relay or proxy misconfiguration, and stale API data create interest-rate and spread risk in reported margins. ' +
      'Spread = note rate minus matched Treasury (annual %). Gross monthly spread = balance × spread / 12. ' +
      'Net subtracts servicing as balance × (annualServicingBps/10000) / 12. Not ALM, FTP, hedge, or OAS.',
    sources: [
      'BankersIQ — Treasury rates by term (trates)',
      'https://bankersiq.com/api/luci/trates/'
    ]
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
        { key: 'totalLoans', labels: ['loans', 'loan', 'loan balance', 'total loans'], fmt: 'dollar' },
        { key: 'treasuryAnnualPct', labels: ['treasury', 'treasury yield', 'risk free rate'], fmt: 'pct' },
        { key: 'spreadAnnualPct', labels: ['spread', 'margin over treasury', 'loan spread'], fmt: 'pct' },
        { key: 'estNetSpreadMonthly', labels: ['net spread monthly', 'loan contribution', 'monthly spread profit'], fmt: 'dollar' },
        { key: 'sourceFileType', labels: ['mortgage', 'loans source', 'file type'], fmt: 'text' }
      ]
    }
  });

})(typeof window !== 'undefined' ? window : this);
