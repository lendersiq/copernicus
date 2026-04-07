/**
 * Loan-level spread vs matched-maturity Treasury (LA.tools curve + rate helpers).
 * Amortizes remaining contractual cash flows: remaining term from maturity date or (term − seasoning);
 * level monthly payment from file (converted to monthly) or inferred from principal, rate, remaining months.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var MAX_MONTHS = 360;

  function coerceAsOfDate(d) {
    if (d instanceof Date && !isNaN(d.getTime())) return new Date(d.getTime());
    var x = new Date();
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Whole calendar months from start (inclusive) to end (exclusive of partial last month adjustment). */
  function calendarMonthsBetween(start, end) {
    if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    if (end <= start) return 0;
    var y = end.getFullYear() - start.getFullYear();
    var m = end.getMonth() - start.getMonth();
    var day = end.getDate() - start.getDate();
    var n = y * 12 + m;
    if (day < 0) n -= 1;
    return n;
  }

  function clampMonths(n) {
    if (n == null || isNaN(n)) return null;
    var x = Math.round(Number(n));
    return Math.max(1, Math.min(MAX_MONTHS, x));
  }

  /** Original contractual term in months from mapped term/tenor (same cap as legacy). */
  function inferContractTermMonths(acc, defaultTerm) {
    var t = acc && acc.term;
    if (t != null && !isNaN(Number(t))) {
      return Math.max(1, Math.min(MAX_MONTHS, Math.round(Number(t))));
    }
    return Math.max(1, Math.min(MAX_MONTHS, defaultTerm));
  }

  /**
   * Remaining months: (1) maturity − as-of, else (2) original term − months since open, else (3) contractual term only.
   */
  function computeRemainingMonths(acc, asOf, defaultTerm) {
    var mat = acc && acc.maturityAt;
    if (mat instanceof Date && !isNaN(mat.getTime()) && mat > asOf) {
      var fromMat = calendarMonthsBetween(asOf, mat);
      var nMat = fromMat != null ? fromMat : null;
      if (nMat != null && nMat >= 1) return clampMonths(nMat);
    }
    var opened = acc && acc.openedAt;
    var orig = inferContractTermMonths(acc, defaultTerm);
    if (opened instanceof Date && !isNaN(opened.getTime())) {
      var elapsed = calendarMonthsBetween(opened, asOf);
      if (elapsed != null && elapsed >= 0) {
        var rem = orig - elapsed;
        return clampMonths(rem);
      }
    }
    return clampMonths(orig);
  }

  function paymentsPerYearFromFrequency(freqStr, typeCode) {
    var s = String(freqStr || '').toLowerCase();
    var tc = String(typeCode || '').toLowerCase();
    var blob = s + ' ' + tc;
    if (/bi\s*weekly|biweekly|bi-week/.test(blob)) return 26;
    if (/\bweekly\b/.test(blob)) return 52;
    if (/quarter|qrt/.test(blob)) return 4;
    if (/annual|yearly|per\s*year/.test(blob)) return 1;
    if (/semi|2\s*per\s*month/.test(blob)) return 24;
    return 12;
  }

  /** Convert periodic payment to approximate monthly equivalent for amortization schedule. */
  function toMonthlyPaymentAmount(pmt, paymentsPerYear) {
    if (pmt == null || isNaN(pmt) || pmt <= 0) return null;
    var py = paymentsPerYear || 12;
    if (py === 12) return pmt;
    return pmt * (py / 12);
  }

  /** Level fixed-rate monthly payment (principal + interest), annual rate in percent points. */
  function levelMonthlyPayment(principal, annualPctPoints, nMonths) {
    var P = Number(principal);
    var n = Math.max(1, Math.round(Number(nMonths)));
    if (!isFinite(P) || P <= 0) return null;
    var rAnnual = Number(annualPctPoints);
    if (!isFinite(rAnnual)) rAnnual = 0;
    var r = (rAnnual / 100) / 12;
    if (r <= 1e-12) return P / n;
    var pow = Math.pow(1 + r, n);
    if (!isFinite(pow) || pow <= 1) return P / n;
    return (P * r * pow) / (pow - 1);
  }

  function parseFilePayment(acc, loader) {
    var p = acc && acc.payment;
    if (p == null || p === '') return null;
    var n = loader && loader.inferNumeric ? loader.inferNumeric(p) : parseFloat(String(p).replace(/[$,]/g, ''));
    if (isNaN(n) || !isFinite(n) || n <= 0) return null;
    return n;
  }

  /**
   * Shape Treasury curve metadata for JSON / UI (matches prior loan-profitability result).
   */
  function summarizeTreasuryCurveForResult(curve) {
    if (!curve) {
      return {
        asOf: null,
        curveSource: null,
        treasuryServiceDescription: null,
        knotCount: 0,
        knots: []
      };
    }
    return {
      asOf: curve.asOf,
      curveSource: curve.curveSource,
      treasuryServiceDescription: curve.treasuryServiceDescription,
      knotCount: curve.knots ? curve.knots.length : 0,
      knots: (curve.knots || []).map(function (k) {
        return { series_id: k.series_id, months: k.months, annualPercent: k.annualPercent };
      })
    };
  }

  /**
   * @param {Array} rows — normalized loan/mortgage Account rows
   * @param {string} sourceLabel — e.g. 'loans' | 'mortgages'
   * @param {object} curve — buildMonthlyTreasuryCurve result
   * @param {object} assumptions — defaultTermMonths, annualServicingBps
   * @param {object} customerDirectory — id → name
   * @param {object} [options] — asOfDate: Date for remaining term / seasoning
   */
  function buildLoanTreasurySpreadRows(rows, sourceLabel, curve, assumptions, customerDirectory, options) {
    var out = [];
    var dir = customerDirectory || {};
    var tools = LA.tools || {};
    var loader = global.CSVLoader || {};
    var servicingBps = assumptions && assumptions.annualServicingBps != null ? assumptions.annualServicingBps : 25;
    var defaultTerm = assumptions && assumptions.defaultTermMonths != null ? assumptions.defaultTermMonths : 60;
    var asOf = coerceAsOfDate(options && options.asOfDate);
    var resolveName = typeof tools.resolveLoanCustomerNameFromDirectory === 'function'
      ? tools.resolveLoanCustomerNameFromDirectory
      : function () { return ''; };

    for (var i = 0; i < rows.length; i++) {
      var acc = rows[i];
      var remainingMonths = computeRemainingMonths(acc, asOf, defaultTerm);
      if (remainingMonths == null) remainingMonths = inferContractTermMonths(acc, defaultTerm);

      var rateRaw = acc.rate != null ? Number(acc.rate) : 0;
      var rate = typeof tools.annualRateToPercentPoints === 'function'
        ? tools.annualRateToPercentPoints(rateRaw)
        : rateRaw;
      if (!isFinite(rate)) rate = 0;

      var bal0 = acc.balance != null ? acc.balance : 0;
      if (bal0 <= 0) continue;

      var perYear = paymentsPerYearFromFrequency(acc.paymentFrequency, acc.typeCode);
      var filePmt = parseFilePayment(acc, loader);
      var fileMonthly = filePmt != null ? toMonthlyPaymentAmount(filePmt, perYear) : null;

      var inferredMonthly = levelMonthlyPayment(bal0, rate, remainingMonths);
      var rMonth = (rate / 100) / 12;
      var interestFirst = bal0 * rMonth;

      var monthlyPayment;
      var paymentSource;
      if (fileMonthly != null && fileMonthly + 1e-6 >= interestFirst) {
        monthlyPayment = fileMonthly;
        paymentSource = perYear === 12 ? 'file' : 'file (converted to monthly equivalent)';
      } else if (fileMonthly != null && fileMonthly + 1e-6 < interestFirst) {
        monthlyPayment = inferredMonthly != null ? inferredMonthly : fileMonthly;
        paymentSource = 'inferred (file payment below first-month interest)';
      } else {
        monthlyPayment = inferredMonthly;
        paymentSource = 'inferred';
      }

      if (monthlyPayment == null || monthlyPayment <= 0) continue;

      var contractTermMonths = inferContractTermMonths(acc, defaultTerm);

      var totalGross = 0;
      var totalServ = 0;
      var totalNet = 0;
      var bal = bal0;
      var firstGross = null;
      var firstServ = null;
      var firstNet = null;

      for (var k = 0; k < remainingMonths; k++) {
        var tenorLeft = Math.max(1, Math.min(MAX_MONTHS, remainingMonths - k));
        var treas = typeof tools.treasuryYieldForTermMonths === 'function'
          ? tools.treasuryYieldForTermMonths(curve, tenorLeft)
          : null;
        if (treas == null) {
          totalGross = null;
          break;
        }
        var spread = Math.round((rate - treas) * 10000) / 10000;
        var gross = bal * (spread / 100) / 12;
        var serv = bal * (servicingBps / 10000) / 12;
        var net = gross - serv;
        if (k === 0) {
          firstGross = gross;
          firstServ = serv;
          firstNet = net;
        }
        totalGross += gross;
        totalServ += serv;
        totalNet += net;

        var intPortion = bal * rMonth;
        var prinPortion = monthlyPayment - intPortion;
        if (prinPortion < 0) prinPortion = 0;
        bal = bal - prinPortion;
        if (bal < 0.005) bal = 0;
      }

      if (totalGross == null) continue;

      var treas0 = typeof tools.treasuryYieldForTermMonths === 'function'
        ? tools.treasuryYieldForTermMonths(curve, remainingMonths)
        : null;
      if (treas0 == null) continue;
      var spread0 = Math.round((rate - treas0) * 10000) / 10000;

      var cid = acc.customerId != null ? String(acc.customerId).trim() : '';
      var customerName = resolveName(acc, dir);
      out.push({
        customerId: cid,
        customerName: customerName,
        reference: acc.accountId || acc.customerId,
        accountId: acc.accountId,
        balance: Math.round(bal0 * 100) / 100,
        rateAnnualPct: Math.round(rate * 10000) / 10000,
        contractTermMonths: contractTermMonths,
        remainingMonths: remainingMonths,
        termMonths: remainingMonths,
        paymentMonthly: Math.round(monthlyPayment * 100) / 100,
        paymentSource: paymentSource,
        treasuryAnnualPct: Math.round(treas0 * 10000) / 10000,
        spreadAnnualPct: spread0,
        estGrossSpreadMonthly: Math.round(firstGross * 100) / 100,
        estServicingMonthly: Math.round(firstServ * 100) / 100,
        estNetSpreadMonthly: Math.round(firstNet * 100) / 100,
        estGrossSpreadRemaining: Math.round(totalGross * 100) / 100,
        estServicingRemaining: Math.round(totalServ * 100) / 100,
        estNetSpreadRemaining: Math.round(totalNet * 100) / 100,
        sourceFileType: sourceLabel
      });
    }
    return out;
  }

  LA.tools = LA.tools || {};
  LA.tools.inferLoanTermMonths = function (acc, defaultTerm) {
    return inferContractTermMonths(acc, defaultTerm);
  };
  LA.tools.computeLoanRemainingMonths = function (acc, defaultTerm, asOfDate) {
    return computeRemainingMonths(acc, coerceAsOfDate(asOfDate), defaultTerm);
  };
  LA.tools.summarizeTreasuryCurveForResult = summarizeTreasuryCurveForResult;
  LA.tools.buildLoanTreasurySpreadRows = buildLoanTreasurySpreadRows;
})(typeof window !== 'undefined' ? window : this);
