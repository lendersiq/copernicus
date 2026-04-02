/**
 * Checking Profitability agent — checking account data plus a customer directory CSV
 * (customerId → name) for display and references. Discovers profitability columns from
 * raw checking headers via Copernicus.Skills + stem-aware discovery (profit-column-discovery.js).
 * Assumptions from Copernicus.Skills.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  function discoverProfitColumns(headers) {
    if (LA.tools && typeof LA.tools.discoverCheckingProfitColumns === 'function') {
      return LA.tools.discoverCheckingProfitColumns(headers, LA);
    }
    return {};
  }

  function numFromRaw(raw, colIdx) {
    if (colIdx == null || !raw || raw[colIdx] == null) return 0;
    var v = String(raw[colIdx]).replace(/[$,€£¥%\s]/g, '');
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  var agent = LA.Agent({
    id: 'checking-profitability',
    name: 'Checking Profitability',
    description: 'Analyzes checking account profitability per customer using credit-for-funding, fee revenue, and processing costs — all driven by centralized Skills. Requires a customer directory file mapping customerId to name (e.g. Portfolio + fullname).',
    requiredDataTypes: ['checking', 'customers'],
    run: function () {
      var check = LA.Data.ensureIngested(['checking', 'customers']);
      if (!check.ok) {
        return {
          needsData: true,
          missingTypes: check.missingTypes || ['checking', 'customers'],
          error: check.error || 'Ingest checking account data and a customer directory CSV (customerId → name) to begin.'
        };
      }

      var fundingSkill = LA.Skills.get('banking.credit-for-funding') || { assumptions: {} };
      var costSkill = LA.Skills.get('banking.processing-costs') || { assumptions: {} };
      var fa = fundingSkill.assumptions;
      var ca = costSkill.assumptions;

      var ecrRate = fa.rate != null ? fa.rate : 0.03;
      var perDeposit = ca.perDeposit != null ? ca.perDeposit : 0.25;
      var perCheck = ca.perCheck != null ? ca.perCheck : 0.15;
      var perNSF = ca.perNSF != null ? ca.perNSF : 3.00;
      var acctMaint = ca.accountMaintenanceMonthly != null ? ca.accountMaintenanceMonthly : 8.00;

      var state = LA.Data.getState();
      var customerDirectory = state.customerDirectory || {};
      var loader = global.CSVLoader;
      if (!loader) return { error: 'CSV ingestion path not available' };
      var mem = loader.getInMemoryStore();

      var checkingHeaders = null;
      var checkingFieldMap = null;
      if (mem && mem.files) {
        for (var f = 0; f < mem.files.length; f++) {
          if (mem.files[f].type === 'checking' && mem.files[f].headers && mem.files[f].headers.length) {
            checkingHeaders = mem.files[f].headers;
            checkingFieldMap = mem.files[f].fieldMap;
            break;
          }
        }
      }

      var profitCols = checkingHeaders ? discoverProfitColumns(checkingHeaders) : {};
      var hasProfitData = Object.keys(profitCols).length > 0;

      var customers = {};
      var accounts = state.checking || [];

      for (var i = 0; i < accounts.length; i++) {
        var acct = accounts[i];
        var cid = acct.customerId;
        if (!cid) continue;

        if (!customers[cid]) {
          customers[cid] = {
            customerId: cid,
            accountCount: 0,
            totalBalance: 0,
            weightedRate: 0,
            interestPaid: 0,
            serviceCharges: 0,
            serviceChargesWaived: 0,
            otherCharges: 0,
            otherChargesWaived: 0,
            numDeposits: 0,
            numChecks: 0,
            numNSF: 0,
            oldestDate: null
          };
        }

        var c = customers[cid];
        c.accountCount++;
        var bal = acct.balance;

        if (hasProfitData && profitCols.avgBalance != null) {
          var avgBal = numFromRaw(acct.raw, profitCols.avgBalance);
          if (avgBal > 0) bal = avgBal;
        }

        c.totalBalance += bal;
        c.weightedRate += bal * acct.rate;

        var raw = acct.raw;
        if (raw && hasProfitData) {
          c.interestPaid += numFromRaw(raw, profitCols.interestEarned);
          c.serviceCharges += numFromRaw(raw, profitCols.serviceCharge);
          c.serviceChargesWaived += numFromRaw(raw, profitCols.serviceChargeWaived);
          c.otherCharges += numFromRaw(raw, profitCols.otherCharges);
          c.otherChargesWaived += numFromRaw(raw, profitCols.otherChargesWaived);
          c.numDeposits += numFromRaw(raw, profitCols.numDeposits);
          c.numChecks += numFromRaw(raw, profitCols.numChecks);
          c.numNSF += numFromRaw(raw, profitCols.numNSF);
        }

        if (acct.openedAt && (!c.oldestDate || acct.openedAt < c.oldestDate)) {
          c.oldestDate = acct.openedAt;
        }
      }

      var results = [];
      for (var id in customers) {
        var p = customers[id];
        p.avgRate = p.totalBalance > 0 ? p.weightedRate / p.totalBalance : 0;

        var creditForFunding = (p.totalBalance * ecrRate) / 12;
        var netFeeRevenue = (p.serviceCharges - p.serviceChargesWaived) +
                            (p.otherCharges - p.otherChargesWaived);
        var totalRevenue = creditForFunding + netFeeRevenue;

        var txnCost = (p.numDeposits * perDeposit) +
                      (p.numChecks * perCheck) +
                      (p.numNSF * perNSF);
        var maintCost = p.accountCount * acctMaint;
        var totalCost = p.interestPaid + txnCost + maintCost;

        var profit = totalRevenue - totalCost;

        p.tenureYears = p.oldestDate
          ? Math.round((Date.now() - p.oldestDate.getTime()) / (365.25 * 24 * 3600000) * 10) / 10
          : null;

        var displayName = customerDirectory[p.customerId] || '';
        results.push({
          customerId: p.customerId,
          customerName: displayName,
          reference: displayName
            ? displayName + ' (' + p.customerId + ')'
            : String(p.customerId),
          accountCount: p.accountCount,
          totalBalance: round2(p.totalBalance),
          avgRate: Math.round(p.avgRate * 10000) / 10000,
          creditForFunding: round2(creditForFunding),
          interestPaid: round2(p.interestPaid),
          netFeeRevenue: round2(netFeeRevenue),
          totalRevenue: round2(totalRevenue),
          txnProcessingCost: round2(txnCost),
          accountMaintCost: round2(maintCost),
          totalCost: round2(totalCost),
          monthlyProfit: round2(profit),
          numDeposits: p.numDeposits,
          numChecks: p.numChecks,
          numNSF: p.numNSF,
          tenureYears: p.tenureYears
        });
      }

      results.sort(function (a, b) { return b.monthlyProfit - a.monthlyProfit; });

      var totalProfit = results.reduce(function (s, r) { return s + r.monthlyProfit; }, 0);
      var totalBal = results.reduce(function (s, r) { return s + r.totalBalance; }, 0);
      var profitable = results.filter(function (r) { return r.monthlyProfit > 0; }).length;

      var discovered = [];
      for (var role in profitCols) {
        discovered.push(role + ' → ' + checkingHeaders[profitCols[role]]);
      }

      return {
        customers: results,
        queryContext: {
          rowsKey: 'customers',
          skillId: 'banking.query-context',
          entityLabel: 'Customer',
          entityPlural: 'customers',
          idFields: ['reference', 'customerName', 'customerId', 'customer_id'],
          unprofitableMetricKey: 'monthlyProfit',
          insightsPrimaryKey: 'monthlyProfit'
        },
        customerCount: results.length,
        profitableCount: profitable,
        unprofitableCount: results.length - profitable,
        totalMonthlyProfit: round2(totalProfit),
        totalBalance: round2(totalBal),
        discoveredProfitFields: discovered,
        fieldMapping: simplifyMap(checkingFieldMap),
        skills: {
          creditForFunding: { rate: (ecrRate * 100).toFixed(2) + '%', source: 'banking.credit-for-funding' },
          processingCosts: {
            perDeposit: '$' + perDeposit.toFixed(2),
            perCheck: '$' + perCheck.toFixed(2),
            perNSF: '$' + perNSF.toFixed(2),
            accountMaint: '$' + acctMaint.toFixed(2) + '/mo',
            source: 'banking.processing-costs'
          }
        },
        summary: results.length + ' customer' + (results.length !== 1 ? 's' : '') +
          ' (with customer information)' +
          ' · Balance: $' + formatNum(totalBal) +
          ' · Monthly Profit: $' + formatNum(totalProfit) +
          ' · Profitable: ' + profitable + '/' + results.length
      };
    }
  });

  function round2(n) { return Math.round(n * 100) / 100; }
  function formatNum(n) { return round2(n).toLocaleString(); }
  function simplifyMap(map) {
    if (!map) return {};
    var out = {};
    for (var r in map) out[r] = map[r].header + ' (confidence: ' + map[r].confidence + ')';
    return out;
  }

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
