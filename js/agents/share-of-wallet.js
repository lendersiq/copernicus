/**
 * Share of Wallet agent — per-customer wallet and relationship strength.
 * Blends relationship depth with estimated deposit share of household income;
 * weights and thresholds come from Copernicus.Skills.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  function allCustomerIds(state) {
    var ids = {};
    ['checking', 'savings', 'cd', 'loans', 'mortgages'].forEach(function (t) {
      var arr = state[t] || [];
      for (var i = 0; i < arr.length; i++) {
        var cid = (arr[i].customerId || '').trim();
        if (cid) ids[cid] = true;
      }
    });
    return Object.keys(ids);
  }

  function profileFromData(cid, state) {
    var p = {
      customerId: cid,
      checkingBal: 0, savingsBal: 0, cdBal: 0, loanBal: 0,
      totalDeposits: 0, totalLoans: 0,
      primaryChecking: false, directDeposit: false,
      hasLoan: false, hasSavingsOrCD: false,
      tenureYearsMax: null, income: null
    };

    function tenure(acct) {
      if (acct.openedAt instanceof Date && !isNaN(acct.openedAt.getTime())) {
        var y = (Date.now() - acct.openedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (p.tenureYearsMax == null || y > p.tenureYearsMax) p.tenureYearsMax = y;
      }
    }

    (state.checking || []).forEach(function (a) {
      if (a.customerId !== cid) return;
      p.checkingBal += a.balance;
      p.totalDeposits += a.balance;
      if (a.isPrimary) p.primaryChecking = true;
      var loader = global.CSVLoader;
      if (loader && loader.hasDirectDeposit && loader.hasDirectDeposit(a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) ? a.raw : {})) p.directDeposit = true;
      if (a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) && a.raw.directDeposit !== undefined) {
        if (loader && loader.detectBoolean ? loader.detectBoolean(a.raw.directDeposit) : false) p.directDeposit = true;
      }
      tenure(a);
      var inc = loader && loader.getIncome ? loader.getIncome(a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) ? a.raw : {}) : null;
      if (inc != null) p.income = inc;
    });

    (state.savings || []).forEach(function (a) {
      if (a.customerId !== cid) return;
      p.savingsBal += a.balance;
      p.totalDeposits += a.balance;
      p.hasSavingsOrCD = true;
      tenure(a);
    });

    (state.cd || []).forEach(function (a) {
      if (a.customerId !== cid) return;
      p.cdBal += a.balance;
      p.totalDeposits += a.balance;
      p.hasSavingsOrCD = true;
      tenure(a);
    });

    (state.loans || []).forEach(function (a) {
      if (a.customerId !== cid) return;
      p.loanBal += a.balance;
      p.totalLoans += a.balance;
      p.hasLoan = true;
      tenure(a);
      var loader2 = global.CSVLoader;
      var inc2 = loader2 && loader2.getIncome ? loader2.getIncome(a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) ? a.raw : {}) : null;
      if (inc2 != null) p.income = inc2;
    });

    (state.mortgages || []).forEach(function (a) {
      if (a.customerId !== cid) return;
      p.loanBal += a.balance;
      p.totalLoans += a.balance;
      p.hasLoan = true;
      tenure(a);
      var loader3 = global.CSVLoader;
      var inc3 = loader3 && loader3.getIncome ? loader3.getIncome(a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) ? a.raw : {}) : null;
      if (inc3 != null) p.income = inc3;
    });

    return p;
  }

  function depthScore(p) {
    var skill = LA.Skills.get('banking.relationship-depth');
    var a = skill ? skill.assumptions : {};
    var max = a.maxScore || 100;
    var s = 0;
    if (p.primaryChecking) s += (a.primaryChecking || 30);
    if (p.directDeposit) s += (a.directDeposit || 20);
    if (p.hasLoan) s += (a.loanRelationship || 20);
    if (p.hasSavingsOrCD) s += (a.savingsOrCD || 15);
    s += (a.digitalEngagement || 5);
    if (p.tenureYearsMax != null && p.tenureYearsMax >= 5) s += (a.tenureOver5 || 10);
    return Math.min(s, max);
  }

  /** Income from CSV rows, or local.market.assumptions.averageHouseholdIncome (see context/local-market.js header). */
  function incomeForWalletShare(p) {
    if (p.income != null && p.income > 0) return { amount: p.income, assumed: false };
    var market = LA.Skills.get('local.market');
    var a = market && market.assumptions;
    var def = a && a.averageHouseholdIncome;
    if (def != null && def > 0) return { amount: def, assumed: true };
    return null;
  }

  function walletSharePct(p, mult) {
    var inc = incomeForWalletShare(p);
    if (!inc || mult <= 0) return null;
    var est = inc.amount * mult;
    if (est <= 0) return null;
    return {
      pct: Math.min(100, (p.totalDeposits / est) * 100),
      incomeAssumed: inc.assumed,
      incomeUsed: inc.amount
    };
  }

  var agent = LA.Agent({
    id: 'share-of-wallet',
    name: 'Share of Wallet',
    description: 'Shows how much of each customer\'s banking likely sits with you versus competitors. Produces a 0–100 Share of Wallet score per customer by combining relationship depth (products held, tenure, primacy signals) with how much of estimated household income their deposits represent. Assigns a relationship segment so you can prioritize growth, retention, and cross-sell. Assumptions and blend weights live in Skills.',
    requiredDataTypes: ['checking', 'savings', 'cd', 'loans'],
    run: function () {
      var check = LA.Data.ensureIngested(['checking', 'savings', 'cd', 'loans']);
      if (!check.ok) {
        return { needsData: true, missingTypes: check.missingTypes || [], error: check.error || 'Missing data' };
      }

      var state = LA.Data.getState();
      var ids = allCustomerIds(state);
      var customers = [];
      var minS = null;
      var maxS = null;

      for (var i = 0; i < ids.length; i++) {
        var p = profileFromData(ids[i], state);
        var ds = depthScore(p);
        p.depthScore = ds;
        p.totalDepositBalance = p.totalDeposits;

        var seg = LA.AI.inferSegment(p);
        var mult = LA.AI.inferIncomeMultiplier(p, seg);
        var wspResult = walletSharePct(p, mult);
        var wsp = wspResult ? wspResult.pct : null;
        var sow = LA.AI.computeShareOfWallet(ds, wsp != null ? wsp : 0);

        if (minS == null || sow < minS) minS = sow;
        if (maxS == null || sow > maxS) maxS = sow;

        var row = {
          customerId: ids[i],
          shareOfWallet: Math.round(sow * 100) / 100,
          segment: seg ? seg.label : null,
          depthScore: ds,
          totalDeposits: Math.round(p.totalDeposits * 100) / 100,
          totalLoans: Math.round(p.totalLoans * 100) / 100
        };
        if (wspResult) {
          row.incomeUsedForSow = Math.round(wspResult.incomeUsed * 100) / 100;
          row.incomeAssumed = wspResult.incomeAssumed;
        }
        customers.push(row);
      }

      var depthSkill = LA.Skills.get('banking.relationship-depth');
      var segSkill = LA.Skills.get('banking.segmentation');
      var sowSkill = LA.Skills.get('banking.share-of-wallet');

      var summary = ids.length + ' customer' + (ids.length !== 1 ? 's' : '') +
        (minS != null && maxS != null ? ' · SOW range ' + minS + ' – ' + maxS : '');

      return {
        shareOfWallet: customers,
        customerCount: ids.length,
        summary: summary,
        queryContext: {
          rowsKey: 'shareOfWallet',
          skillId: 'banking.query-context',
          entityLabel: 'Customer',
          entityPlural: 'customers',
          idFields: ['customerId', 'customer_id'],
          insightsPrimaryKey: 'shareOfWallet',
          fieldCatalog: [
            { key: 'shareOfWallet', labels: ['sow', 'composite score', 'wallet score'], fmt: 'score' },
            { key: 'depthScore', labels: ['depth', 'relationship depth'], fmt: 'score' },
            { key: 'totalDeposits', labels: ['balance', 'balances', 'deposits', 'deposit balance', 'total deposits'], fmt: 'dollar' },
            { key: 'totalLoans', labels: ['loans', 'loan balance', 'outstanding loans'], fmt: 'dollar' }
          ]
        },
        skills: {
          relationshipDepth: depthSkill ? depthSkill.assumptions : null,
          segmentation: segSkill ? segSkill.assumptions : null,
          sowWeights: sowSkill ? sowSkill.assumptions : null
        },
        ingestedFiles: (state.meta && state.meta.files || []).map(function (f) {
          return { name: f.name, type: f.type, rows: f.rowCount };
        })
      };
    }
  });

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
