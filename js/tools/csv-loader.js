/**
 * Central CSV loader — in-memory only, bank security edge.
 * Auto-detects delimiter (, ; \t |). Infers file type and column semantics.
 * Produces raw role-mapped rows; Copernicus.Data normalizes to canonical Account objects.
 */
(function (global) {
  'use strict';

  var FILE_TYPES = ['checking', 'savings', 'cd', 'loans', 'customers'];

  var COLUMN_ROLES = [
    'customerId', 'accountId', 'balance', 'dateOpened', 'maturityDate',
    'term', 'rate', 'typeCode', 'ownerCode',
    'directDeposit', 'primary', 'income', 'customerName'
  ];

  var FILE_TYPE_SIGNALS = {
    checking: [
      'checking', 'check', 'demand', 'dda', 'current account',
      'transaction', 'transact', 'chk', 'chkg'
    ],
    savings: [
      'savings', 'save', 'saving', 'mmkt', 'money market', 'mma',
      'sav', 'passbook', 'high yield'
    ],
    cd: [
      'cd', 'certificate', 'certificates', 'term deposit', 'time deposit',
      'fixed term', 'cod', 'share certificate'
    ],
    loans: [
      'loan', 'loans', 'lending', 'credit', 'mortgage', 'heloc', 'auto',
      'personal loan', 'line of credit', 'outstanding', 'principal',
      'note', 'consumer', 'commercial', 'installment'
    ],
    customers: [
      'customer directory', 'customer list', 'customer names', 'full names',
      'fullname', 'full name', 'demographics', 'party names', 'member directory',
      'names', 'cust lookup', 'customer lookup', 'household names', 'cif names'
    ]
  };

  var COLUMN_SIGNALS = {
    customerId: [
      'customer_id', 'customerid', 'cust_id', 'custid', 'client_id',
      'clientid', 'customer id', 'acct_holder', 'account_holder', 'holder',
      'cid', 'member_id', 'memberid', 'obligor', 'borrower_id', 'borrower',
      'ssn', 'tin', 'tax_id', 'party_id', 'partyid', 'customer number',
      'customer_number', 'cust_no', 'cust_num', 'client_no', 'client_num',
      'cif', 'cif_number', 'cif_id', 'relationship_id',
      /* Core / savings extracts — relationship key, not account number */
      'portfolio', 'portfolio_id', 'portfolio id', 'portfolio_no', 'portfolio number',
      'household_id', 'household id', 'relationship id'
    ],
    accountId: [
      'account_id', 'accountid', 'acct_id', 'acct_num', 'account number',
      'account_number', 'loan_number', 'contract_id', 'note_number',
      'acct_no', 'loan_id', 'loanid', 'reference', 'ref_number'
    ],
    balance: [
      'balance', 'bal', 'current_balance', 'current balance', 'avg_balance',
      'average_balance', 'average balance', 'ledger_bal', 'ledger_balance',
      'available_balance', 'amount', 'principal_balance', 'outstanding_balance',
      'book_balance', 'ending_balance', 'closing_balance', 'total_balance',
      'present_balance', 'acct_balance', 'account_balance'
    ],
    dateOpened: [
      'open_date', 'opened', 'date_opened', 'start_date', 'origination',
      'orig_date', 'open date', 'account_open', 'origination_date',
      'account_opened', 'acct_open_date', 'effective_date', 'issue_date',
      'open_dt', 'opened_date', 'created_date', 'created', 'inception_date'
    ],
    maturityDate: [
      'maturity_date', 'maturity', 'mat_date', 'matdate', 'end_date',
      'expiration', 'expiration_date', 'payoff_date', 'due_date',
      'renewal_date', 'term_end'
    ],
    term: [
      'term', 'term_months', 'tenor', 'duration', 'period', 'term_length',
      'loan_term', 'months', 'cd_term', 'term_mo'
    ],
    rate: [
      'rate', 'interest_rate', 'int_rate', 'apy', 'apr', 'annual_rate',
      'coupon', 'yield', 'note_rate', 'current_rate', 'fixed_rate',
      'variable_rate', 'rate_pct', 'interest'
    ],
    typeCode: [
      'account_type', 'type', 'product', 'product_type', 'account type',
      'product_code', 'acct_type', 'loan_type', 'product_name', 'category',
      'class', 'sub_type', 'subtype'
    ],
    ownerCode: [
      'owner_code', 'ownercode', 'owner', 'ownership', 'ownership_type',
      'joint', 'account_owner', 'owner_type', 'registration', 'title_type'
    ],
    directDeposit: [
      'direct_deposit', 'direct deposit', 'dd', 'payroll', 'ach_deposit',
      'recurring_deposit', 'has_dd', 'directdeposit', 'dd_flag', 'auto_deposit'
    ],
    primary: [
      'primary', 'main', 'primary_checking', 'primary account', 'is_primary',
      'primary_flag', 'main_account', 'primary_acct'
    ],
    income: [
      'income', 'household_income', 'annual_income', 'income_annual',
      'revenue', 'salary', 'reported_income', 'agi', 'gross_income',
      'hh_income', 'total_income'
    ],
    customerName: [
      'fullname', 'full_name', 'full name', 'customer_name', 'customer name',
      'cust_name', 'custname', 'name', 'display_name', 'display name',
      'legal_name', 'legal name', 'preferred_name', 'member_name', 'member name',
      'account_holder_name', 'holder_name', 'client_name', 'party_name',
      'primary_name', 'customer full name'
    ]
  };

  /* ── Text helpers ────────────────────────────────────────────────── */

  function norm(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.toLowerCase().replace(/[\s_\-\.]+/g, ' ').trim();
  }

  function tokenize(s) {
    return norm(s).split(/\s+/).filter(Boolean);
  }

  function stripBOM(text) {
    if (text && text.length > 0 && text.charCodeAt(0) === 0xFEFF) return text.slice(1);
    return text;
  }

  /* ── Delimiter detection ─────────────────────────────────────────── */

  function detectDelimiter(text) {
    var firstLines = text.slice(0, 4096).split(/\r?\n/).slice(0, 5);
    if (!firstLines.length) return ',';
    var delimiters = [',', '\t', ';', '|'];
    var best = ',';
    var bestConsistency = -1;

    for (var d = 0; d < delimiters.length; d++) {
      var sep = delimiters[d];
      var counts = [];
      for (var i = 0; i < firstLines.length; i++) {
        if (firstLines[i].trim() === '') continue;
        var n = 0;
        var inQ = false;
        for (var j = 0; j < firstLines[i].length; j++) {
          var ch = firstLines[i][j];
          if (ch === '"') inQ = !inQ;
          else if (!inQ && ch === sep) n++;
        }
        if (n > 0) counts.push(n);
      }
      if (counts.length < 2) continue;
      var allSame = counts.every(function (c) { return c === counts[0]; });
      var score = counts[0] * (allSame ? 10 : 3) + counts.length;
      if (score > bestConsistency) {
        bestConsistency = score;
        best = sep;
      }
    }
    return best;
  }

  /* ── CSV parser (supports any single-char delimiter) ─────────────── */

  function parseCSV(text, delimiter) {
    if (text == null || typeof text !== 'string') return { rows: [], delimiter: ',' };
    text = stripBOM(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!text.trim()) return { rows: [], delimiter: ',' };

    var sep = delimiter || detectDelimiter(text);
    var rows = [];
    var i = 0;
    var len = text.length;
    var row = [];
    var cell = '';
    var inQuotes = false;

    while (i < len) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else {
          cell += c;
        }
        i++;
        continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === sep) {
        row.push(cell.trim());
        cell = '';
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(cell.trim());
        if (row.length > 0) rows.push(row);
        row = [];
        cell = '';
        i++;
        continue;
      }
      cell += c;
      i++;
    }
    if (cell !== '' || row.length > 0) {
      row.push(cell.trim());
      rows.push(row);
    }
    return { rows: rows, delimiter: sep };
  }

  /* ── Signal 1: Header alias matching (legacy, still useful) ────────── */

  function scoreHeaderAlias(header, signals) {
    var h = norm(header);
    var best = 0;
    for (var i = 0; i < signals.length; i++) {
      var sig = signals[i];
      if (h === sig) return 10;
      if (h.indexOf(sig) !== -1 || sig.indexOf(h) !== -1) best = Math.max(best, 6);
      var tokH = tokenize(h);
      var tokS = tokenize(sig);
      for (var j = 0; j < tokS.length; j++) {
        for (var k = 0; k < tokH.length; k++) {
          if (tokH[k] === tokS[j]) best = Math.max(best, 4);
          if (tokH[k].length >= 3 && tokS[j].length >= 3) {
            if (tokH[k].indexOf(tokS[j]) !== -1 || tokS[j].indexOf(tokH[k]) !== -1)
              best = Math.max(best, 2);
          }
        }
      }
    }
    return best;
  }

  /* ── Signal 2: Semantic word understanding ──────────────────────────
   * Words that imply "a person who holds something" → customerId.
   * Words that imply quantities, dates, codes → other roles.
   * This is the layer that understands "Portfolio" means customerId. */

  var SEMANTIC_CONCEPTS = {
    customerId: [
      'portfolio', 'household', 'relationship', 'party', 'patron',
      'member', 'person', 'individual', 'entity', 'taxpayer',
      'applicant', 'co applicant', 'guarantor', 'depositor',
      'investor', 'shareholder', 'beneficiary', 'titleholder',
      'signatory', 'coreholder'
    ],
    accountId: [
      'account', 'acct', 'contract', 'note', 'reference',
      'instrument', 'facility', 'obligation', 'certificate'
    ],
    balance: [
      'balance', 'amount', 'value', 'worth', 'principal',
      'outstanding', 'ledger', 'available', 'collected'
    ],
    dateOpened: [
      'opened', 'origination', 'inception', 'created', 'effective',
      'established', 'booked'
    ],
    maturityDate: [
      'maturity', 'expiration', 'payoff', 'renewal', 'due'
    ],
    rate: [
      'rate', 'interest', 'yield', 'apy', 'apr', 'coupon'
    ],
    term: [
      'term', 'tenor', 'duration', 'period', 'months'
    ],
    typeCode: [
      'class', 'category', 'product', 'type', 'code', 'segment'
    ],
    customerName: [
      'name', 'full', 'display', 'legal', 'preferred', 'given', 'surname'
    ]
  };

  function scoreHeaderSemantic(header) {
    var h = norm(header);
    var tokens = tokenize(header);
    var scores = {};
    for (var role in SEMANTIC_CONCEPTS) {
      scores[role] = 0;
      var concepts = SEMANTIC_CONCEPTS[role];
      for (var c = 0; c < concepts.length; c++) {
        if (h === concepts[c]) { scores[role] = Math.max(scores[role], 8); continue; }
        if (h.indexOf(concepts[c]) !== -1) { scores[role] = Math.max(scores[role], 6); continue; }
        for (var t = 0; t < tokens.length; t++) {
          if (tokens[t] === concepts[c]) { scores[role] = Math.max(scores[role], 5); }
          else if (tokens[t].indexOf(concepts[c]) !== -1 || concepts[c].indexOf(tokens[t]) !== -1) {
            if (tokens[t].length >= 3 && concepts[c].length >= 3) scores[role] = Math.max(scores[role], 3);
          }
        }
      }
    }
    return scores;
  }

  /* ── Signal 3: Value pattern analysis ───────────────────────────────
   * Examines actual data to determine column role from value shapes:
   * - customerId: consistent format IDs, moderate cardinality, no decimals
   * - balance: wide-range floats with decimals, often currency
   * - rate: small floats 0–1 or 0–100
   * - date: date patterns
   * - term: small integers
   * - typeCode/ownerCode: low-cardinality codes */

  function analyzeColumnValues(colIndex, sampleRows) {
    var vals = [];
    for (var i = 0; i < sampleRows.length; i++) {
      var v = sampleRows[i][colIndex];
      if (v !== undefined && v !== null && String(v).trim() !== '') vals.push(String(v).trim());
    }
    if (!vals.length) return { type: 'empty', count: 0, total: 0 };

    var total = vals.length;
    var unique = {};
    var numericCount = 0;
    var integerCount = 0;
    var floatWithDecimal = 0;
    var dateCount = 0;
    var smallFloat = 0;
    var smallInt = 0;
    var hasCurrency = 0;
    var lengths = [];
    var allAlphaNum = true;
    var formatSigs = {};
    var sumLen = 0;
    var maxAbsInteger = 0;
    var shortLenCount = 0;

    for (var j = 0; j < vals.length; j++) {
      var raw = vals[j];
      unique[raw] = (unique[raw] || 0) + 1;
      lengths.push(raw.length);
      sumLen += raw.length;
      if (raw.length <= 3) shortLenCount++;

      var cleaned = raw.replace(/[$,€£¥\s]/g, '');
      if (/[$€£¥]/.test(raw)) hasCurrency++;
      var num = parseFloat(cleaned);
      var isNum = !isNaN(num) && /^[\-\+]?[\d,.\s$€£¥()]+$/.test(raw);

      if (isNum) {
        numericCount++;
        if (raw.indexOf('.') !== -1) floatWithDecimal++;
        else {
          integerCount++;
          var ai = Math.abs(Math.floor(num));
          if (ai > maxAbsInteger) maxAbsInteger = ai;
        }
        if (num === Math.floor(num) && Math.abs(num) < 200) smallInt++;
        if (Math.abs(num) <= 1) smallFloat++;
        else if (Math.abs(num) <= 100 && raw.indexOf('.') !== -1) smallFloat++;
      }

      for (var k = 0; k < DATE_PATTERNS.length; k++) {
        if (DATE_PATTERNS[k].test(raw)) { dateCount++; break; }
      }

      if (!/^[\w\-.\s]+$/.test(raw)) allAlphaNum = false;

      var sig = raw.replace(/[A-Za-z]/g, 'A').replace(/[0-9]/g, '9').replace(/[\s_\-]/g, '-');
      formatSigs[sig] = (formatSigs[sig] || 0) + 1;
    }

    var uniqueKeys = Object.keys(unique);
    var uniqueCount = uniqueKeys.length;
    var cardinalityRatio = uniqueCount / total;

    var minLen = Math.min.apply(null, lengths);
    var maxLen = Math.max.apply(null, lengths);
    var lenRange = maxLen - minLen;

    var topFormatCount = 0;
    var topFormat = '';
    for (var f in formatSigs) {
      if (formatSigs[f] > topFormatCount) { topFormatCount = formatSigs[f]; topFormat = f; }
    }
    var formatConsistency = topFormatCount / total;

    var isMonotonic = true;
    if (numericCount === total && total >= 3) {
      var increasing = true;
      var decreasing = true;
      for (var m = 1; m < vals.length; m++) {
        var a = parseFloat(vals[m - 1].replace(/[,$\s]/g, ''));
        var b = parseFloat(vals[m].replace(/[,$\s]/g, ''));
        if (b <= a) increasing = false;
        if (b >= a) decreasing = false;
      }
      isMonotonic = increasing || decreasing;
    } else {
      isMonotonic = false;
    }

    return {
      total: total,
      uniqueCount: uniqueCount,
      cardinalityRatio: cardinalityRatio,
      numericCount: numericCount,
      integerCount: integerCount,
      floatWithDecimal: floatWithDecimal,
      dateCount: dateCount,
      smallFloat: smallFloat,
      smallInt: smallInt,
      hasCurrency: hasCurrency,
      minLen: minLen,
      maxLen: maxLen,
      lenRange: lenRange,
      formatConsistency: formatConsistency,
      topFormat: topFormat,
      isMonotonic: isMonotonic,
      allAlphaNum: allAlphaNum,
      avgLen: sumLen / total,
      maxAbsInteger: maxAbsInteger,
      shortLenRatio: shortLenCount / total
    };
  }

  function scoreValuePattern(stats) {
    var scores = {};
    var t = stats.total || 1;

    if (!stats.total || stats.type === 'empty') {
      scores.customerId = 0;
      scores.accountId = 0;
      scores.balance = 0;
      scores.rate = 0;
      scores.term = 0;
      scores.dateOpened = 0;
      scores.maturityDate = 0;
      scores.typeCode = 0;
      scores.ownerCode = 0;
      scores.customerName = 0;
      return scores;
    }

    var avgLen = stats.avgLen != null ? stats.avgLen : 0;
    var maxLen = stats.maxLen != null ? stats.maxLen : 0;
    var maxAbsInt = stats.maxAbsInteger != null ? stats.maxAbsInteger : 0;
    var shortLenRatio = stats.shortLenRatio != null ? stats.shortLenRatio : 0;

    /* customerId: consistent format, moderate cardinality, integer or alphanum IDs, not monotonic */
    scores.customerId = 0;
    if (stats.cardinalityRatio >= 0.05 && stats.cardinalityRatio <= 0.95) scores.customerId += 3;
    if (stats.formatConsistency >= 0.5) scores.customerId += 2;
    /* Uniform length helps IDs, but short uniform strings are usually counts/codes — require id-like length */
    if (stats.lenRange <= 3 && (maxLen >= 4 || avgLen >= 3.5)) scores.customerId += 2;
    if (stats.integerCount === t && stats.floatWithDecimal === 0) scores.customerId += 2;
    if (stats.allAlphaNum && stats.floatWithDecimal === 0) scores.customerId += 1;
    if (!stats.isMonotonic) scores.customerId += 1;
    if (stats.hasCurrency > 0) scores.customerId -= 5;
    if (stats.dateCount > t * 0.5) scores.customerId -= 5;

    /* Transaction counts: short cell text + small integers — not relationship IDs */
    var allIntegers = stats.integerCount === t && stats.floatWithDecimal === 0;
    if (allIntegers && maxLen <= 4 && avgLen <= 3.25 && maxAbsInt <= 999) {
      scores.customerId -= 5;
    } else if (allIntegers && shortLenRatio >= 0.7 && maxAbsInt <= 999 && avgLen <= 4) {
      scores.customerId -= 3;
    }
    /* Longer values favor customer/account-style identifiers */
    if (allIntegers && stats.dateCount < t * 0.3 && stats.hasCurrency === 0) {
      if (avgLen >= 4.5 || maxLen >= 6) scores.customerId += 2;
      else if (maxLen >= 5) scores.customerId += 1;
    }
    if (!allIntegers && stats.floatWithDecimal === 0 && stats.allAlphaNum && (avgLen >= 5 || maxLen >= 6)) {
      scores.customerId += 2;
    }

    /* accountId: higher cardinality than customerId, consistent format */
    scores.accountId = 0;
    if (stats.cardinalityRatio >= 0.8) scores.accountId += 3;
    if (stats.formatConsistency >= 0.7) scores.accountId += 2;
    if (stats.integerCount === t && stats.floatWithDecimal === 0) scores.accountId += 1;
    if (stats.hasCurrency > 0) scores.accountId -= 5;
    if (stats.dateCount > t * 0.5) scores.accountId -= 5;

    /* balance: numeric with decimals, wide range, often has currency */
    scores.balance = 0;
    if (stats.numericCount >= t * 0.9) scores.balance += 2;
    if (stats.floatWithDecimal >= t * 0.5) scores.balance += 3;
    if (stats.hasCurrency > 0) scores.balance += 3;
    if (stats.numericCount === t && stats.smallFloat < t * 0.5 && stats.floatWithDecimal > 0) scores.balance += 2;

    /* rate: small numbers, decimals, 0–1 or 0–100 */
    scores.rate = 0;
    if (stats.numericCount >= t * 0.9 && stats.smallFloat >= t * 0.7) scores.rate += 4;
    if (stats.floatWithDecimal >= t * 0.5 && stats.smallFloat >= t * 0.5) scores.rate += 3;
    if (stats.hasCurrency > 0) scores.rate -= 5;

    /* term: small integers */
    scores.term = 0;
    if (stats.integerCount >= t * 0.8 && stats.smallInt >= t * 0.7) scores.term += 4;
    if (stats.floatWithDecimal === 0 && stats.smallInt >= t * 0.5) scores.term += 2;

    /* dateOpened / maturityDate: date patterns */
    scores.dateOpened = 0;
    scores.maturityDate = 0;
    if (stats.dateCount >= t * 0.7) {
      scores.dateOpened += 5;
      scores.maturityDate += 5;
    }

    /* typeCode / ownerCode: very low cardinality codes */
    scores.typeCode = 0;
    scores.ownerCode = 0;
    if (stats.uniqueCount <= 10 && stats.cardinalityRatio < 0.15) {
      scores.typeCode += 3;
      scores.ownerCode += 2;
    }
    if (stats.uniqueCount <= 5 && stats.cardinalityRatio < 0.1) {
      scores.typeCode += 2;
      scores.ownerCode += 2;
    }

    /* customerName: free text, not mostly numeric */
    scores.customerName = 0;
    if (stats.numericCount < t * 0.5 && stats.uniqueCount > 1) scores.customerName += 3;
    if (stats.avgLen >= 5) scores.customerName += 2;
    if (stats.dateCount > t * 0.3) scores.customerName -= 4;
    if (stats.hasCurrency > 0) scores.customerName -= 4;

    return scores;
  }

  /* ── Multi-signal fusion engine ─────────────────────────────────────
   * Two-phase assignment: non-ID roles first (balance, rate, term, etc.),
   * then ID roles (customerId, accountId) from remaining columns.
   * This prevents ambiguous columns like Branch_Number from stealing
   * the customerId slot — they get claimed by typeCode/term first. */

  var WEIGHT_ALIAS = 0.25;
  var WEIGHT_SEMANTIC = 0.30;
  var WEIGHT_VALUE = 0.45;

  var ID_ROLES_SET = { customerId: true, accountId: true };

  /**
   * Activity / count columns often look like IDs to value heuristics — never use them as customerId.
   * (Relationship keys are detected via COLUMN_SIGNALS + semantics: customer_id, relationship_id, etc.)
   */
  function isMisleadingCustomerIdHeader(header) {
    var h = norm(header);
    var u = String(header || '').toLowerCase().replace(/\s+/g, '_');
    if (/\bnumber\s+of\b/.test(h) || /number_of_/.test(u) || /^num_/.test(u) || /_count$/.test(u) || /\bcount$/.test(h)) {
      return true;
    }
    if (/(credit|debit|deposit|check|nsf|item|transaction|pmtd)/.test(u) && /(number|num|count|qty|quantity|pmtd)/.test(u)) {
      return true;
    }
    return false;
  }

  function customerIdHeaderScoreAdjust(header) {
    return isMisleadingCustomerIdHeader(header) ? -18 : 0;
  }

  function buildScoreGrid(headers, sampleRows) {
    var colCount = headers.length;
    var colStats = [];
    for (var c = 0; c < colCount; c++) {
      colStats.push(analyzeColumnValues(c, sampleRows));
    }
    var grid = [];
    for (var ci = 0; ci < colCount; ci++) {
      var row = {};
      var semanticScores = scoreHeaderSemantic(headers[ci]);
      var valueScores = scoreValuePattern(colStats[ci]);
      COLUMN_ROLES.forEach(function (role) {
        var aliasS = COLUMN_SIGNALS[role] ? scoreHeaderAlias(headers[ci], COLUMN_SIGNALS[role]) : 0;
        var semanticS = semanticScores[role] || 0;
        var valueS = valueScores[role] || 0;
        row[role] = (aliasS * WEIGHT_ALIAS) + (semanticS * WEIGHT_SEMANTIC) + (valueS * WEIGHT_VALUE);
      });
      var cidAdj = customerIdHeaderScoreAdjust(headers[ci]);
      if (cidAdj) row.customerId = Math.max(0, row.customerId + cidAdj);
      grid.push(row);
    }
    return grid;
  }

  function greedyAssign(grid, roles, mapping, usedCols, usedRoles, headers) {
    var colCount = grid.length;
    var maxPasses = colCount * roles.length;
    for (var pass = 0; pass < maxPasses; pass++) {
      var bestScore = 0;
      var bestCol = -1;
      var bestRole = '';
      for (var ci = 0; ci < colCount; ci++) {
        if (usedCols[ci]) continue;
        for (var ri = 0; ri < roles.length; ri++) {
          var role = roles[ri];
          if (usedRoles[role]) continue;
          var s = grid[ci][role] || 0;
          if (s > bestScore) { bestScore = s; bestCol = ci; bestRole = role; }
        }
      }
      if (bestCol === -1 || bestScore <= 0) break;
      mapping[bestRole] = { index: bestCol, header: headers[bestCol], confidence: Math.round(bestScore * 100) / 100 };
      usedCols[bestCol] = true;
      usedRoles[bestRole] = true;
    }
  }

  function inferColumnRoles(headers, sampleRows) {
    var grid = buildScoreGrid(headers, sampleRows);
    var mapping = {};
    var usedCols = {};
    var usedRoles = {};

    var phase1 = COLUMN_ROLES.filter(function (r) { return !ID_ROLES_SET[r]; });
    greedyAssign(grid, phase1, mapping, usedCols, usedRoles, headers);

    /* customerId before accountId so a relationship-key column wins over a pure high-cardinality account #. */
    greedyAssign(grid, ['customerId'], mapping, usedCols, usedRoles, headers);
    greedyAssign(grid, ['accountId'], mapping, usedCols, usedRoles, headers);

    if (!mapping.customerId && headers.length > 0) {
      var bestFallback = -1;
      var bestFallbackScore = -1;
      for (var fi = 0; fi < headers.length; fi++) {
        if (usedCols[fi]) continue;
        var s = grid[fi].customerId || 0;
        if (s > bestFallbackScore) { bestFallbackScore = s; bestFallback = fi; }
      }
      if (bestFallback === -1) bestFallback = 0;
      mapping.customerId = { index: bestFallback, header: headers[bestFallback], confidence: 0.5 };
    }

    return mapping;
  }

  /* ── AI-engine column verification ────────────────────────────────────
   * Uses Copernicus.AI.classifyColumns (from ai-engine.js) to verify
   * and improve low-confidence heuristic mappings. Synchronous, zero
   * external dependencies. */

  var AI_CONFIDENCE_THRESHOLD = 4.0;

  function verifyWithAIEngine(headers, mapping, sampleRows) {
    if (global.Copernicus && global.Copernicus.AI && global.Copernicus.AI.classifyColumns) {
      return global.Copernicus.AI.classifyColumns(headers, sampleRows, mapping);
    }
    return mapping;
  }

  /* ── File type inference ────────────────────────────────────────────── */

  function looksLikeCustomerDirectory(headers) {
    if (!headers || !headers.length) return false;
    var hasCid = false;
    var hasName = false;
    var hasStrongBal = false;
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (COLUMN_SIGNALS.customerId && scoreHeaderAlias(h, COLUMN_SIGNALS.customerId) >= 6) hasCid = true;
      /* Require strong name header (e.g. fullname, customer name) — weak "name" substring avoids "Branch Name". */
      if (COLUMN_SIGNALS.customerName && scoreHeaderAlias(h, COLUMN_SIGNALS.customerName) >= 8) hasName = true;
      if (COLUMN_SIGNALS.balance && scoreHeaderAlias(h, COLUMN_SIGNALS.balance) >= 8) hasStrongBal = true;
    }
    return hasCid && hasName && !hasStrongBal;
  }

  function inferFileType(filename, headers) {
    var name = norm(filename);
    var headerLine = headers.join(' ');
    var combined = name + ' ' + norm(headerLine);
    var scores = {};
    FILE_TYPES.forEach(function (ft) {
      scores[ft] = 0;
      FILE_TYPE_SIGNALS[ft].forEach(function (sig) {
        if (combined.indexOf(sig) !== -1) scores[ft] += 3;
        if (name.indexOf(sig) !== -1) scores[ft] += 2;
      });
    });
    if (headers && headers.length && looksLikeCustomerDirectory(headers)) {
      scores.customers = (scores.customers || 0) + 12;
    }
    var best = null;
    var bestScore = 0;
    for (var ft in scores) {
      if (scores[ft] > bestScore) { bestScore = scores[ft]; best = ft; }
    }
    if (best) {
      /* Prefer customer directory when headers match id + name and score ties (e.g. filename says "checking"). */
      if (headers && headers.length && looksLikeCustomerDirectory(headers) &&
          scores.customers === bestScore && best !== 'customers') {
        return 'customers';
      }
      return best;
    }
    if (headers && headers.length && looksLikeCustomerDirectory(headers)) return 'customers';
    return 'unknown';
  }

  /* ── Value helpers ────────────────────────────────────────────────── */

  function inferNumeric(value) {
    if (value == null || value === '') return null;
    var s = String(value).replace(/[$,€£¥%\s()]/g, '');
    if (s.charAt(0) === '(' || s.charAt(s.length - 1) === ')') {
      s = '-' + s.replace(/[()]/g, '');
    }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  var DATE_PATTERNS = [
    /^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/,
    /^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/,
    /^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2})$/
  ];

  function inferDate(value) {
    if (value == null || value === '') return null;
    var s = String(value).trim();

    var m = DATE_PATTERNS[0].exec(s);
    if (m) { var d = new Date(+m[1], +m[2] - 1, +m[3]); if (!isNaN(d.getTime())) return d; }

    m = DATE_PATTERNS[1].exec(s);
    if (m) { var d2 = new Date(+m[3], +m[1] - 1, +m[2]); if (!isNaN(d2.getTime())) return d2; }

    m = DATE_PATTERNS[2].exec(s);
    if (m) {
      var yr = +m[3]; yr += yr < 50 ? 2000 : 1900;
      var d3 = new Date(yr, +m[1] - 1, +m[2]);
      if (!isNaN(d3.getTime())) return d3;
    }

    var fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function detectBoolean(value) {
    if (value == null || value === '') return false;
    var v = String(value).toLowerCase().trim();
    return v === 'true' || v === 'yes' || v === 'y' || v === '1' || v === 'x' || v === 't';
  }

  /* ── Row → role-mapped object ─────────────────────────────────────── */

  function rowToObject(row, columnMap, sourceFileName) {
    var obj = {};
    for (var role in columnMap) {
      var idx = columnMap[role].index;
      var val = row[idx];
      if (val !== undefined && val !== '') obj[role] = val;
    }
    obj._raw = row;
    if (sourceFileName) obj._sourceFile = sourceFileName;
    return obj;
  }

  /* ── Column mapping memory (agents get smarter) ─────────────────────
   * After each successful load, store the mapping keyed by header
   * fingerprint. On subsequent loads with the same headers, reuse the
   * stored mapping instantly — no inference needed. Persists across
   * page loads via Copernicus.Store when localStorage is available. */

  var learnedMappings = {};

  function getHeaderFingerprint(headers) {
    return headers.map(function (h) { return h.toLowerCase().trim(); }).sort().join('|');
  }

  function validateStoredMapping(stored, headers) {
    if (!stored || !stored.mapping) return false;
    var m = stored.mapping;
    for (var role in m) {
      if (m[role].index >= headers.length) return false;
      if (m[role].header !== headers[m[role].index]) return false;
    }
    return true;
  }

  function rememberMapping(headers, mapping) {
    var fp = getHeaderFingerprint(headers);
    var entry = { mapping: mapping, headers: headers.slice(), timestamp: Date.now() };
    learnedMappings[fp] = entry;
    try {
      var LA = global.Copernicus;
      if (LA && LA.Store && LA.Store.set) LA.Store.set('colmap_' + fp, entry);
    } catch (e) { /* persist failed, in-memory still works */ }
  }

  function recallMapping(headers) {
    var fp = getHeaderFingerprint(headers);
    var mem = learnedMappings[fp];
    if (mem && validateStoredMapping(mem, headers)) return mem.mapping;
    try {
      var LA = global.Copernicus;
      if (LA && LA.Store && LA.Store.get) {
        var stored = LA.Store.get('colmap_' + fp);
        if (stored && validateStoredMapping(stored, headers)) {
          learnedMappings[fp] = stored;
          return stored.mapping;
        }
      }
    } catch (e) { /* recall failed */ }
    return null;
  }

  function cloneColumnMap(mapping) {
    var o = {};
    for (var k in mapping) {
      if (!mapping[k] || typeof mapping[k] !== 'object') continue;
      var e = mapping[k];
      o[k] = { index: e.index, header: e.header, confidence: e.confidence };
      if (e.source) o[k].source = e.source;
    }
    return o;
  }

  /**
   * Recalled maps skip re-inference and can keep customerId on a misleading column (e.g. Number_of_Credits).
   * If the mapped header is misleading, re-pick customerId = best grid score among non-misleading columns
   * (same signals as infer: customer_id, relationship_id, portfolio aliases, value shape, etc.).
   */
  function repairCustomerIdMappingIfNeeded(headers, sampleData, mapping) {
    if (!mapping || !headers.length || !mapping.customerId) return { mapping: mapping, changed: false };
    var curIdx = mapping.customerId.index;
    if (curIdx < 0 || curIdx >= headers.length) return { mapping: mapping, changed: false };

    if (!isMisleadingCustomerIdHeader(headers[curIdx])) return { mapping: mapping, changed: false };

    var grid = buildScoreGrid(headers, sampleData);
    var bestIdx = -1;
    var bestScore = -1;
    for (var ci = 0; ci < headers.length; ci++) {
      if (isMisleadingCustomerIdHeader(headers[ci])) continue;
      var s = grid[ci].customerId || 0;
      if (s > bestScore) {
        bestScore = s;
        bestIdx = ci;
      }
    }
    if (bestIdx < 0 || bestIdx === curIdx) return { mapping: mapping, changed: false };

    var newMap = cloneColumnMap(mapping);
    newMap.customerId = {
      index: bestIdx,
      header: headers[bestIdx],
      confidence: Math.max(6, Math.round(bestScore * 100) / 100),
      source: 'repaired-misleading-customerId'
    };

    if (newMap.accountId && newMap.accountId.index === bestIdx) {
      delete newMap.accountId;
    }

    if (!newMap.accountId) {
      var usedCols = {};
      var usedRoles = {};
      for (var role in newMap) {
        if (!newMap[role] || newMap[role].index == null || newMap[role].index < 0) continue;
        usedCols[newMap[role].index] = true;
        usedRoles[role] = true;
      }
      usedRoles.accountId = false;
      greedyAssign(grid, ['accountId'], newMap, usedCols, usedRoles, headers);
    }

    try {
      if (typeof console !== 'undefined' && console.info) {
        console.info(
          '[Copernicus CSVLoader] customerId repaired:',
          headers[curIdx],
          '→',
          headers[bestIdx]
        );
      }
    } catch (logErr) { /* ignore */ }

    return { mapping: newMap, changed: true };
  }

  /* ── In-memory store ──────────────────────────────────────────────── */

  var inMemoryStore = null;

  function freshStore() {
    return {
      files: [],
      byType: { checking: [], savings: [], cd: [], loans: [], customers: [] },
      columnMaps: {},
      customerIndex: null
    };
  }

  function getInMemoryStore() {
    if (!inMemoryStore) inMemoryStore = freshStore();
    return inMemoryStore;
  }

  function clearInMemoryStore() { inMemoryStore = null; }

  /* ── File reading ─────────────────────────────────────────────────── */

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result;
        resolve(typeof result === 'string' ? result : String(result || ''));
      };
      reader.onerror = function () {
        reject(new Error('Failed to read file: ' + (file && file.name)));
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  /* ── Main load pipeline ───────────────────────────────────────────── */

  function loadFiles(fileList) {
    if (!fileList || !fileList.length) {
      return Promise.resolve({ loaded: [], error: 'No files provided' });
    }

    var store = getInMemoryStore();

    var promises = [];
    for (var i = 0; i < fileList.length; i++) {
      (function (file) {
        promises.push(
          readFileAsText(file).then(function (text) {
            var parsed = parseCSV(text);
            var rows = parsed.rows;
            if (!rows.length) {
              return {
                file: file,
                type: inferFileType(file.name, []),
                headers: [],
                columnMap: {},
                objects: [],
                delimiter: parsed.delimiter,
                emptyReason: (!text || !text.trim()) ? 'empty' : 'no-rows'
              };
            }
            var headers = rows[0];
            var dataRows = rows.slice(1);
            var fileType = inferFileType(file.name, headers);
            var sampleData = dataRows.slice(0, 20);

            var columnMap;
            var recalled = recallMapping(headers);
            if (recalled) {
              columnMap = recalled;
            } else {
              columnMap = inferColumnRoles(headers, sampleData);
              /* No balance column on customer directories — skip AI remap (would fight heuristics). */
              if (fileType !== 'customers') {
                columnMap = verifyWithAIEngine(headers, columnMap, sampleData);
              }
            }

            var cidRepair = repairCustomerIdMappingIfNeeded(headers, sampleData, columnMap);
            if (cidRepair.changed) columnMap = cidRepair.mapping;
            if (!recalled || cidRepair.changed) rememberMapping(headers, columnMap);

            var objects = [];
            for (var r = 0; r < dataRows.length; r++) {
              objects.push(rowToObject(dataRows[r], columnMap, file.name));
            }
            return {
              file: file,
              type: fileType,
              headers: headers,
              columnMap: columnMap,
              objects: objects,
              delimiter: parsed.delimiter,
              source: recalled && !cidRepair.changed ? 'memory' : (recalled ? 'memory+corrected' : 'inferred')
            };
          })
        );
      })(fileList[i]);
    }

    return Promise.all(promises).then(function (results) {
      store.customerIndex = null;

      function stripFileContribution(fname) {
        FILE_TYPES.forEach(function (t) {
          var arr = store.byType[t];
          if (!arr || !arr.length) return;
          var kept = [];
          for (var i = 0; i < arr.length; i++) {
            if (arr[i]._sourceFile !== fname) kept.push(arr[i]);
          }
          store.byType[t] = kept;
        });
        store.files = store.files.filter(function (f) {
          return f.name !== fname;
        });
        delete store.columnMaps[fname];
      }

      results.forEach(function (r) {
        var fname = r.file.name;
        stripFileContribution(fname);
        store.files.push({
          name: fname,
          type: r.type,
          rowCount: r.objects ? r.objects.length : 0,
          headers: r.headers,
          columnMap: r.columnMap,
          delimiter: r.delimiter,
          emptyReason: r.emptyReason
        });
        if (r.type && store.byType[r.type]) {
          store.byType[r.type] = store.byType[r.type].concat(r.objects || []);
        }
        store.columnMaps[fname] = r.columnMap;
      });

      if (global.Copernicus && global.Copernicus.Data) {
        global.Copernicus.Data._normalizeFromLoader();
      }

      return {
        loaded: store.files,
        byType: store.byType,
        columnMaps: store.columnMaps,
        inMemory: true
      };
    });
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  var CSVLoader = {
    loadFiles: loadFiles,
    getInMemoryStore: getInMemoryStore,
    clearInMemoryStore: clearInMemoryStore,
    parseCSV: parseCSV,
    detectDelimiter: detectDelimiter,
    inferFileType: inferFileType,
    inferColumnRoles: inferColumnRoles,
    verifyWithAIEngine: verifyWithAIEngine,
    buildScoreGrid: buildScoreGrid,
    analyzeColumnValues: analyzeColumnValues,
    scoreValuePattern: scoreValuePattern,
    scoreHeaderSemantic: scoreHeaderSemantic,
    scoreHeaderAlias: scoreHeaderAlias,
    rememberMapping: rememberMapping,
    recallMapping: recallMapping,
    getHeaderFingerprint: getHeaderFingerprint,
    inferNumeric: inferNumeric,
    inferDate: inferDate,
    detectBoolean: detectBoolean,
    getNormalizedCustomerId: function (val) { return val == null ? '' : String(val).trim(); },
    getBalance: function (obj) { var n = inferNumeric(obj && obj.balance); return n != null ? n : 0; },
    isPrimary: function (obj) { return detectBoolean(obj && obj.primary); },
    hasDirectDeposit: function (obj) { return detectBoolean(obj && obj.directDeposit); },
    getIncome: function (obj) { return inferNumeric(obj && obj.income); },
    FILE_TYPES: FILE_TYPES,
    COLUMN_ROLES: COLUMN_ROLES,
    SEMANTIC_CONCEPTS: SEMANTIC_CONCEPTS,
    AI_CONFIDENCE_THRESHOLD: AI_CONFIDENCE_THRESHOLD
  };

  if (global.Copernicus) {
    global.Copernicus.tools = global.Copernicus.tools || {};
    global.Copernicus.tools.CSVLoader = CSVLoader;
  }
  global.CSVLoader = CSVLoader;
})(typeof window !== 'undefined' ? window : this);
