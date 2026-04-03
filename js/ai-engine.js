/**
 * Copernicus AI Engine — NLP, statistical classifier, intent parser, insight generator.
 * Zero external dependencies. Works in any browser.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  /* ================================================================
   * Section 1: NLP Core — tokenizer, stemmer, lexicon
   * ================================================================ */

  var STOP_WORDS = {};
  'a an the is are was were be been being has have had do does did will would shall should may might can could of in to for on with at by from as into through during about between after before above below up down out off over under'.split(' ')
    .forEach(function (w) { STOP_WORDS[w] = true; });

  var SUFFIX_RULES = [
    ['ational', 'ate'], ['tional', 'tion'], ['encies', 'ence'], ['ances', 'ance'],
    ['izers', 'ize'], ['ously', 'ous'], ['ively', 'ive'], ['fully', 'ful'],
    ['ation', 'ate'], ['alism', 'al'], ['ities', 'ity'], ['ments', ''],
    ['ness', ''], ['ings', ''], ['ment', ''], ['ence', ''], ['ance', ''],
    ['able', ''], ['ible', ''], ['ting', 't'], ['ally', 'al'], ['ment', ''],
    ['ing', ''], ['ies', 'y'], ['ied', 'y'], ['ed', ''], ['ly', ''],
    ['er', ''], ['es', ''], ['s', '']
  ];

  function stem(word) {
    if (word.length < 4) return word;
    for (var i = 0; i < SUFFIX_RULES.length; i++) {
      var suf = SUFFIX_RULES[i][0];
      if (word.length > suf.length + 2 && word.slice(-suf.length) === suf) {
        return word.slice(0, -suf.length) + SUFFIX_RULES[i][1];
      }
    }
    return word;
  }

  function tokenize(text) {
    if (!text) return [];
    return String(text).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t.length > 0; });
  }

  function tokenizeStemmed(text) {
    return tokenize(text).map(stem);
  }

  function removeStopWords(tokens) {
    return tokens.filter(function (t) { return !STOP_WORDS[t]; });
  }

  var BANKING_SYNONYMS = {
    portfolio: 'customerid', cif: 'customerid', member: 'customerid',
    client: 'customerid', borrower: 'customerid', obligor: 'customerid',
    holder: 'customerid', ssn: 'customerid', tin: 'customerid',
    acct: 'account', cert: 'certificate', chk: 'checking', sav: 'savings',
    dep: 'deposit', bal: 'balance', prin: 'principal', amt: 'amount',
    int: 'interest', apr: 'rate', apy: 'rate', pct: 'percent',
    dt: 'date', orig: 'origination', mat: 'maturity', exp: 'expiration',
    mo: 'month', yr: 'year', num: 'number', qty: 'quantity',
    pmtd: 'periodtodate', ytd: 'yeartodate', nsf: 'nonsufficient',
    svc: 'service', chg: 'charge', maint: 'maintenance'
  };

  function expandSynonyms(tokens) {
    return tokens.map(function (t) { return BANKING_SYNONYMS[t] || t; });
  }

  function cosineSimilarity(vecA, vecB) {
    var dot = 0, magA = 0, magB = 0;
    var allKeys = {};
    var k;
    for (k in vecA) allKeys[k] = true;
    for (k in vecB) allKeys[k] = true;
    for (k in allKeys) {
      var a = vecA[k] || 0;
      var b = vecB[k] || 0;
      dot += a * b;
      magA += a * a;
      magB += b * b;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  function bagOfWords(tokens) {
    var bag = {};
    for (var i = 0; i < tokens.length; i++) {
      bag[tokens[i]] = (bag[tokens[i]] || 0) + 1;
    }
    return bag;
  }

  /* ================================================================
   * Section 2: Field Classifier — TF-IDF + value patterns
   * ================================================================ */

  var ROLE_TEMPLATES = {
    customerId: 'portfolio relationship household party cif member customer id client holder borrower obligor primary key identifier person owner taxpayer cust relationship_id',
    /* accountId is not header-classified here — CSVLoader only maps it on exact header-alias match. */
    balance: 'balance current principal outstanding ledger available collected amount total',
    rate: 'rate interest apr apy statement coupon yield percentage annual',
    term: 'term tenor months month mth mo period duration maturity length year years yrs',
    dateOpened: 'open date opened origination account start begin effective',
    maturityDate: 'maturity date expiration expire matures end payoff',
    typeCode: 'class code type account product category kind classification',
    ownerCode: 'owner code ownership title registration joint individual trust'
  };

  var roleTemplateVecs = {};
  (function () {
    for (var role in ROLE_TEMPLATES) {
      roleTemplateVecs[role] = bagOfWords(
        expandSynonyms(tokenizeStemmed(ROLE_TEMPLATES[role]))
      );
    }
  })();

  function classifyFieldHeader(header) {
    var tokens = expandSynonyms(tokenizeStemmed(header));
    var vec = bagOfWords(tokens);
    var scores = [];
    for (var role in roleTemplateVecs) {
      scores.push({ role: role, score: cosineSimilarity(vec, roleTemplateVecs[role]) });
    }
    scores.sort(function (a, b) { return b.score - a.score; });
    return scores;
  }

  /**
   * Headers that describe credit quality / buckets — never relationship customer identifiers.
   * Portfolio / CIF / member fields stay allowed (explicit positives elsewhere).
   */
  function isRiskOrRatingLikeCustomerIdHeader(header) {
    var s = String(header || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    if (!s) return false;
    if (s.indexOf('portfolio') !== -1 || s.indexOf('customer id') !== -1 || s.indexOf('customer number') !== -1) return false;
    if (s.indexOf('customer') !== -1 && (s.indexOf('id') !== -1 || s.indexOf('number') !== -1 || s.indexOf('no') !== -1)) return false;
    if (/\brisk\b/.test(s) && /\brating\b/.test(s)) return true;
    if (/\bcredit\s+rating\b/.test(s) || /\bloan\s+grade\b/.test(s) || /\brisk\s+grade\b/.test(s)) return true;
    if (/\bpass\s*fail\b/.test(s) || /\bpassfail\b/.test(s)) return true;
    if (/\b(pd|lgd)\b/.test(s) || /\bprobability\s+of\s+default\b/.test(s)) return true;
    if (/\bfico\b/.test(s) || s.indexOf('credit score') !== -1) return true;
    if (/\b(rating|grade)\b/.test(s) && s.indexOf('operating') === -1 && s.indexOf('interest') === -1 && s.indexOf('statement') === -1) return true;
    return false;
  }

  /** Values are mostly parsed numbers with real fractional parts — balances/rates, not stable string ids. */
  function valuesPredominantlyFractionalNumeric(values) {
    if (!values || !values.length) return false;
    var ne = values.filter(function (v) { return v != null && String(v).trim() !== ''; });
    if (ne.length < 2) return false;
    var numeric = 0;
    var frac = 0;
    for (var i = 0; i < ne.length; i++) {
      var raw = String(ne[i]).trim();
      if (/^\d{1,2}[\/\-]\d{1,2}/.test(raw) || /^\d{4}[\/\-]\d{1,2}/.test(raw)) continue;
      var s = raw.replace(/[$,€£¥%\s,]/g, '');
      if (!/^[\-+]?[\d.]+(?:e[+\-]?\d+)?$/i.test(s)) continue;
      var n = parseFloat(s);
      if (isNaN(n)) continue;
      numeric++;
      var intish = Math.abs(n - Math.round(n)) < 1e-9;
      if (raw.indexOf('.') !== -1 && !intish) frac++;
      else if (/e[+\-]?\d/i.test(s)) frac++;
    }
    if (numeric < Math.max(2, Math.ceil(ne.length * 0.65))) return false;
    return frac / numeric >= 0.4;
  }

  /** Values look like a small ordinal / letter grade bucket, not a stable customer key. */
  function isImplausibleCustomerIdValues(values) {
    if (!values || !values.length) return false;
    var nonEmpty = values.filter(function (v) { return v != null && String(v).trim() !== ''; });
    if (nonEmpty.length < 3) return false;
    if (valuesPredominantlyFractionalNumeric(nonEmpty)) return true;
    var uniqueVals = {};
    var short = 0;
    var n = nonEmpty.length;
    var sumLen = 0;
    for (var i = 0; i < n; i++) {
      var s = String(nonEmpty[i]).trim();
      uniqueVals[s] = true;
      sumLen += s.length;
      if (s.length <= 2) short++;
    }
    var uniq = Object.keys(uniqueVals).length;
    var avgLen = sumLen / n;
    if (short / n >= 0.85 && uniq <= 15 && avgLen <= 2.5) return true;
    if (uniq <= 8 && avgLen <= 2 && n >= 8) return true;
    return false;
  }

  /** Loan tenor in months: 1, or any multiple of 3 from 3 through 480 (matches csv-loader heuristic). */
  function isPlausibleLoanTermMonthHeuristic(n) {
    if (typeof n !== 'number' || isNaN(n) || n !== Math.floor(n)) return false;
    if (n < 1 || n > 480) return false;
    if (n === 1) return true;
    return n % 3 === 0;
  }

  function normHeaderForRole(h) {
    return String(h || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
  }

  /** Unambiguous banking headers — fixes greedy swaps when value patterns tie. */
  function isDefiniteOwnerCodeHeaderNorm(n) {
    if (!n) return false;
    if (!/\bcode\b/.test(n)) return false;
    if (!/\bowner\b/.test(n) && !/\bownership\b/.test(n)) return false;
    if (/\b(type|class|product|category)\s+code\b/.test(n)) return false;
    if (/\btype\b/.test(n) && !/\bowner\b/.test(n)) return false;
    return true;
  }

  function isDefiniteTypeCodeHeaderNorm(n) {
    if (!n) return false;
    if (!/\bcode\b/.test(n)) return false;
    if (/\bowner\b/.test(n) && !/\b(type|class|product|category|segment|subtype)\b/.test(n)) return false;
    if (/\btype\s+code\b/.test(n) || /\bclass\s+code\b/.test(n) || /\bproduct\s+code\b/.test(n) ||
        /\bcategory\s+code\b/.test(n) || /\bsegment\s+code\b/.test(n) || /\bsubtype\s+code\b/.test(n)) return true;
    if (/\btype\b/.test(n) && /\bcode\b/.test(n) && !/\bowner\b/.test(n)) return true;
    if (/\bclass\b/.test(n) && /\bcode\b/.test(n) && !/\bowner\b/.test(n)) return true;
    if ((/\bproduct\b/.test(n) || /\bcategory\b/.test(n) || /\bsegment\b/.test(n) || /\bsubtype\b/.test(n)) &&
        /\bcode\b/.test(n) && !/\bowner\b/.test(n)) return true;
    return false;
  }

  /**
   * After cosine/value fusion, pin typeCode and ownerCode to fields whose headers name them.
   */
  function reconcileTypeOwnerCodeMappings(headers, improved) {
    if (!headers || !headers.length || !improved) return;
    var typeIdx = -1;
    var ownerIdx = -1;
    for (var i = 0; i < headers.length; i++) {
      var n = normHeaderForRole(headers[i]);
      if (isDefiniteTypeCodeHeaderNorm(n) && typeIdx < 0) typeIdx = i;
      if (isDefiniteOwnerCodeHeaderNorm(n) && ownerIdx < 0) ownerIdx = i;
    }
    if (typeIdx < 0 && ownerIdx < 0) return;

    var PIN = 9.5;
    if (typeIdx >= 0 && ownerIdx >= 0 && typeIdx !== ownerIdx) {
      improved.typeCode = {
        index: typeIdx,
        header: headers[typeIdx],
        confidence: PIN,
        source: 'ai-engine'
      };
      improved.ownerCode = {
        index: ownerIdx,
        header: headers[ownerIdx],
        confidence: PIN,
        source: 'ai-engine'
      };
      return;
    }
    if (typeIdx >= 0) {
      var exT = improved.typeCode;
      improved.typeCode = {
        index: typeIdx,
        header: headers[typeIdx],
        confidence: Math.max(PIN, exT && exT.confidence != null ? exT.confidence : 0),
        source: 'ai-engine'
      };
    }
    if (ownerIdx >= 0) {
      var exO = improved.ownerCode;
      improved.ownerCode = {
        index: ownerIdx,
        header: headers[ownerIdx],
        confidence: Math.max(PIN, exO && exO.confidence != null ? exO.confidence : 0),
        source: 'ai-engine'
      };
    }
  }

  function classifyFieldValues(values, headerOpt) {
    if (!values || !values.length) return {};
    var nonEmpty = values.filter(function (v) { return v != null && String(v).trim() !== ''; });
    if (!nonEmpty.length) return {};

    var numCount = 0, dateCount = 0, shortCount = 0;
    var uniqueVals = {};
    var lengths = [];
    var sum = 0, numericVals = [];

    for (var i = 0; i < nonEmpty.length; i++) {
      var s = String(nonEmpty[i]).trim();
      uniqueVals[s] = true;
      lengths.push(s.length);
      var cleaned = s.replace(/[$,€£¥%\s]/g, '');
      var n = parseFloat(cleaned);
      if (!isNaN(n)) {
        numCount++;
        numericVals.push(n);
        sum += n;
      }
      if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(s)) {
        dateCount++;
      }
      if (s.length <= 4) shortCount++;
    }

    var n2 = nonEmpty.length;
    var uniqueCount = Object.keys(uniqueVals).length;
    var cardinality = uniqueCount / n2;
    var numericRatio = numCount / n2;
    var dateRatio = dateCount / n2;
    var shortRatio = shortCount / n2;
    var avgLen = lengths.reduce(function (a, b) { return a + b; }, 0) / n2;
    var lenVariance = 0;
    for (var j = 0; j < lengths.length; j++) {
      lenVariance += Math.pow(lengths[j] - avgLen, 2);
    }
    lenVariance = Math.sqrt(lenVariance / n2);
    var formatConsistency = 1 - (lenVariance / (avgLen || 1));

    var avg = numericVals.length ? sum / numericVals.length : 0;
    var max = numericVals.length ? Math.max.apply(null, numericVals) : 0;
    var min = numericVals.length ? Math.min.apply(null, numericVals) : 0;

    var plausibleTermNumeric = 0;
    for (var ti = 0; ti < numericVals.length; ti++) {
      var tv = numericVals[ti];
      if (tv >= 1 && tv === Math.floor(tv) && isPlausibleLoanTermMonthHeuristic(Math.floor(tv))) plausibleTermNumeric++;
    }
    var plausibleTermRatio = numericVals.length ? plausibleTermNumeric / numericVals.length : 0;

    var signals = {};

    if (numericRatio > 0.9 && avg > 0 && avg < 20 && max < 100) {
      signals.rate = 0.8;
    }
    if (numericRatio > 0.9 && max > 100 && avg > 50) {
      signals.balance = 0.7;
    }
    if (numericRatio > 0.8 && max <= 480 && min >= 1 && plausibleTermRatio >= 0.8) {
      signals.term = 0.55;
    } else if (numericRatio > 0.8 && max <= 480 && min >= 1 && plausibleTermRatio >= 0.65 && avg < 200) {
      signals.term = 0.45;
    }
    if (dateRatio > 0.5) {
      signals.dateOpened = 0.7;
      signals.maturityDate = 0.5;
    }
    if (cardinality > 0.3 && cardinality < 0.95 && formatConsistency > 0.5 && numericRatio > 0.8) {
      if (!isImplausibleCustomerIdValues(nonEmpty) && !valuesPredominantlyFractionalNumeric(nonEmpty)) {
        signals.customerId = 0.6;
      }
    }
    if (shortRatio > 0.8 && cardinality < 0.15) {
      signals.typeCode = 0.6;
      signals.ownerCode = 0.4;
    }

    var nh = headerOpt ? normHeaderForRole(headerOpt) : '';
    if (nh) {
      if (isDefiniteOwnerCodeHeaderNorm(nh)) {
        signals.ownerCode = Math.max(signals.ownerCode || 0, 0.9);
        signals.typeCode = Math.min(signals.typeCode || 0, 0.12);
      } else if (isDefiniteTypeCodeHeaderNorm(nh)) {
        signals.typeCode = Math.max(signals.typeCode || 0, 0.9);
        signals.ownerCode = Math.min(signals.ownerCode || 0, 0.12);
      }
    }

    if (headerOpt && isRiskOrRatingLikeCustomerIdHeader(headerOpt)) {
      signals.customerId = 0;
      signals.typeCode = Math.max(signals.typeCode || 0, 0.65);
    }
    if (isImplausibleCustomerIdValues(nonEmpty)) {
      signals.customerId = 0;
      signals.typeCode = Math.max(signals.typeCode || 0, 0.55);
    }

    return signals;
  }

  function isTransactionCountFieldHeader(header) {
    var u = String(header || '').toLowerCase().replace(/\s+/g, '_');
    if (/number_of_(credit|debit|deposit|check|item|nsf|transaction)/.test(u)) return true;
    if (/pmtd_number|num_credits|num_debits|num_deposits|num_checks|number_of_items/.test(u)) return true;
    if (/number_of_/.test(u) && /(credit|debit|deposit|check|nsf|item)/.test(u)) return true;
    return false;
  }

  function relationshipKeyHeaderBoost(header) {
    var s = String(header || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    if (!s) return 0;
    if (s.indexOf('portfolio') !== -1) return 0.45;
    if (s.indexOf('cif') !== -1) return 0.4;
    if (/\brelationship\b/.test(s) && s.indexOf('id') !== -1) return 0.38;
    if (/\bmember\b/.test(s) && s.indexOf('id') !== -1) return 0.35;
    if (s.indexOf('customer') !== -1 && (s.indexOf('id') !== -1 || s.indexOf('number') !== -1)) return 0.4;
    if (s.indexOf('borrower') !== -1 || s.indexOf('obligor') !== -1) return 0.32;
    if (s.indexOf('party') !== -1 && s.indexOf('id') !== -1) return 0.3;
    if (s.indexOf('household') !== -1) return 0.28;
    return 0;
  }

  function scoreLendingCustomerIdField(header, values) {
    if (isTransactionCountFieldHeader(header) || isRiskOrRatingLikeCustomerIdHeader(header)) return -99;
    if (valuesPredominantlyFractionalNumeric(values)) return -99;
    var hs = classifyFieldHeader(header);
    var hdr = 0;
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].role === 'customerId') {
        hdr = hs[i].score;
        break;
      }
    }
    var vs = classifyFieldValues(values, header);
    var val = vs.customerId || 0;
    return hdr * 5.5 + val * 5 + relationshipKeyHeaderBoost(header) * 6;
  }

  function fieldOccupiedByStrongRole(improved, colIndex, threshold) {
    var thr = threshold != null ? threshold : 4.0;
    for (var role in improved) {
      if (!improved[role] || improved[role].index !== colIndex) continue;
      if (improved[role].confidence >= thr && role !== 'customerId') return true;
    }
    return false;
  }

  function reconcileCustomerIdMapping(headers, fieldValues, improved, fileType) {
    var lend = fileType === 'loans' || fileType === 'mortgages';
    var cur = improved.customerId;
    var curIdx = cur && cur.index >= 0 ? cur.index : -1;
    var curBad =
      curIdx < 0 ||
      isRiskOrRatingLikeCustomerIdHeader(headers[curIdx]) ||
      isTransactionCountFieldHeader(headers[curIdx]) ||
      isImplausibleCustomerIdValues(fieldValues[curIdx]);
    if (!lend && !curBad) return;

    var bestIdx = -1;
    var bestScore = -999;
    for (var ci = 0; ci < headers.length; ci++) {
      if (fieldOccupiedByStrongRole(improved, ci, 4.5)) continue;
      var sc = scoreLendingCustomerIdField(headers[ci], fieldValues[ci]);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = ci;
      }
    }
    if (bestIdx < 0) return;

    var curScore = curIdx >= 0 ? scoreLendingCustomerIdField(headers[curIdx], fieldValues[curIdx]) : -999;
    if (curBad || bestScore >= curScore + 0.35) {
      improved.customerId = {
        index: bestIdx,
        header: headers[bestIdx],
        confidence: Math.max(5.5, Math.min(12, bestScore)),
        source: 'ai-engine-customerId'
      };
    }
  }

  function classifyFields(headers, sampleRows, existingMap, fileType) {
    var CONFIDENCE_BOOST_THRESHOLD = 4.0;
    if (!existingMap) return existingMap;

    var fieldValues = [];
    for (var c = 0; c < headers.length; c++) {
      var vals = [];
      for (var r = 0; r < Math.min(20, sampleRows.length); r++) {
        if (sampleRows[r] && sampleRows[r][c] != null) vals.push(sampleRows[r][c]);
      }
      fieldValues.push(vals);
    }

    var curIdxProbe = existingMap.customerId && existingMap.customerId.index >= 0 ? existingMap.customerId.index : -1;
    var curHeaderBad =
      curIdxProbe >= 0 &&
      (isRiskOrRatingLikeCustomerIdHeader(headers[curIdxProbe]) ||
        isImplausibleCustomerIdValues(fieldValues[curIdxProbe]));

    var needsHelp = false;
    if (!existingMap.customerId || existingMap.customerId.confidence < CONFIDENCE_BOOST_THRESHOLD) needsHelp = true;
    if (!existingMap.balance || existingMap.balance.confidence < CONFIDENCE_BOOST_THRESHOLD) needsHelp = true;
    if (curHeaderBad) needsHelp = true;
    if (fileType === 'loans' || fileType === 'mortgages') needsHelp = true;
    if (!needsHelp) return existingMap;

    var improved = {};
    for (var role in existingMap) improved[role] = existingMap[role];
    if (curHeaderBad) delete improved.customerId;

    for (var ci = 0; ci < headers.length; ci++) {
      var headerScores = classifyFieldHeader(headers[ci]);
      var valueSignals = classifyFieldValues(fieldValues[ci], headers[ci]);

      for (var si = 0; si < headerScores.length; si++) {
        var hs = headerScores[si];
        if (hs.score < 0.1) continue;
        if (hs.role === 'customerId' && isTransactionCountFieldHeader(headers[ci])) continue;
        if (hs.role === 'customerId' && isRiskOrRatingLikeCustomerIdHeader(headers[ci])) continue;
        if (hs.role === 'customerId' && isImplausibleCustomerIdValues(fieldValues[ci])) continue;
        var valBoost = valueSignals[hs.role] || 0;
        var combined = hs.score * 5 + valBoost * 5;

        var existing = improved[hs.role];
        if (existing && existing.confidence >= CONFIDENCE_BOOST_THRESHOLD) continue;

        if (!existing || existing.confidence < combined) {
          var conflict = false;
          for (var r2 in improved) {
            if (r2 !== hs.role && improved[r2] && improved[r2].index === ci &&
                improved[r2].confidence >= CONFIDENCE_BOOST_THRESHOLD) {
              conflict = true;
              break;
            }
          }
          if (!conflict && combined > (existing ? existing.confidence : 0)) {
            improved[hs.role] = {
              index: ci,
              header: headers[ci],
              confidence: Math.max(combined, existing ? existing.confidence : 0),
              source: 'ai-engine'
            };
          }
        }
      }
    }

    reconcileTypeOwnerCodeMappings(headers, improved);
    reconcileCustomerIdMapping(headers, fieldValues, improved, fileType);

    var L = global.CSVLoader;
    if (improved.accountId && improved.accountId.index != null) {
      var ax = improved.accountId.index;
      var strictOk = L && typeof L.isStrictAccountIdHeader === 'function' && ax >= 0 && ax < headers.length &&
        L.isStrictAccountIdHeader(headers[ax]);
      if (!strictOk) delete improved.accountId;
    }

    return improved;
  }

  /* ================================================================
   * Section 3: Intent Parser — query understanding
   * ================================================================ */

  /* Domain-specific metric maps live in agent result.queryContext + Skills (e.g. banking.query-context). */

  var INTENT_PATTERNS = [
    { re: /(?:top|best|highest|most\s+profitable|largest)\s+(\d+)/i, intent: 'rank', dir: 'desc' },
    { re: /(?:bottom|worst|lowest|least|smallest)\s+(\d+)/i, intent: 'rank', dir: 'asc' },
    { re: /(?:which|what|show|find|list|get)\s+(?:customers?|accounts?|patients?|subjects?|records?|rows?|entries?).*?(?:with|having|where|that|who)/i, intent: 'filter' },
    { re: /(?:unprofitable|losing|negative|loss)/i, intent: 'filter', preset: 'unprofitable' },
    { re: /(?:average|mean|median)\b/i, intent: 'aggregate', fn: 'avg' },
    { re: /(?:total|sum)\b/i, intent: 'aggregate', fn: 'sum' },
    { re: /(?:how many|count)\b/i, intent: 'aggregate', fn: 'count' },
    { re: /(?:why|what drives|what causes|explain|how is.*calculated|break\s*down)/i, intent: 'explain' },
    { re: /(?:compare|versus|vs\b|difference\s+between)/i, intent: 'compare' },
    { re: /(?:summarize|summary|overview|tell me about)/i, intent: 'summarize' }
  ];

  function extractThreshold(text) {
    var m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = text.match(/([\d,]+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1].replace(/,/g, '')) / 100;
    m = text.match(/(?:over|above|more than|greater than|exceeding|at least|>=?)\s*([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    return null;
  }

  function extractComparator(text) {
    if (/(?:over|above|more than|greater|higher|exceeding|at least|>=)/i.test(text)) return 'gt';
    if (/(?:under|below|less than|lower|fewer|<=)/i.test(text)) return 'lt';
    if (/(?:between)/i.test(text)) return 'between';
    return 'gt';
  }

  function extractCount(text) {
    var m = text.match(/(?:top|bottom|best|worst|first|last)\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function extractCustomerId(text) {
    var m = text.match(/(?:customer|cust|patient|subject|record)\s*#?\s*(\w+)/i);
    return m ? m[1] : null;
  }

  function mergeFieldCatalogs(a, b) {
    var map = {};
    for (var i = 0; i < a.length; i++) {
      var e = a[i];
      map[e.key] = { key: e.key, labels: (e.labels || []).slice(), fmt: e.fmt || 'num', displayLabel: e.displayLabel };
    }
    for (var j = 0; j < b.length; j++) {
      var f = b[j];
      if (!map[f.key]) {
        map[f.key] = { key: f.key, labels: (f.labels || []).slice(), fmt: f.fmt || 'num', displayLabel: f.displayLabel };
      } else {
        var labels = map[f.key].labels;
        var newL = f.labels || [];
        for (var n = 0; n < newL.length; n++) {
          if (labels.indexOf(newL[n]) === -1) labels.push(newL[n]);
        }
        if (f.fmt) map[f.key].fmt = f.fmt;
        if (f.displayLabel) map[f.key].displayLabel = f.displayLabel;
      }
    }
    var keys = Object.keys(map);
    var out = [];
    for (var k = 0; k < keys.length; k++) out.push(map[keys[k]]);
    return out;
  }

  /**
   * Merge agent result.queryContext with skill-defined catalogs (e.g. banking.query-context).
   * Medical or other domains register their own skill + agent rowsKey — no banking strings required in engine.
   */
  function mergeQueryContext(result) {
    var out = {
      rowsKey: null,
      entityLabel: 'Record',
      entityPlural: 'records',
      idFields: ['reference', 'customerName', 'customerId', 'customer_id', 'patientId', 'subjectId', 'recordId'],
      unprofitableMetricKey: null,
      fieldCatalog: []
    };
    var skillIds = [];
    if (result && result.queryContext && result.queryContext.skillIds) {
      for (var s = 0; s < result.queryContext.skillIds.length; s++) {
        skillIds.push(result.queryContext.skillIds[s]);
      }
    }
    if (result && result.queryContext && result.queryContext.skillId) {
      skillIds.push(result.queryContext.skillId);
    }
    for (var si = 0; si < skillIds.length; si++) {
      var sk = LA.Skills.get(skillIds[si]);
      if (!sk || !sk.queryContext) continue;
      var sq = sk.queryContext;
      if (sq.fieldCatalog) out.fieldCatalog = mergeFieldCatalogs(out.fieldCatalog, sq.fieldCatalog);
      if (sq.entityLabel) out.entityLabel = sq.entityLabel;
      if (sq.entityPlural) out.entityPlural = sq.entityPlural;
      if (sq.idFields && sq.idFields.length) out.idFields = sq.idFields.slice();
      if (sq.unprofitableMetricKey) out.unprofitableMetricKey = sq.unprofitableMetricKey;
    }
    if (result && result.queryContext) {
      var qc = result.queryContext;
      if (qc.rowsKey) out.rowsKey = qc.rowsKey;
      if (qc.entityLabel) out.entityLabel = qc.entityLabel;
      if (qc.entityPlural) out.entityPlural = qc.entityPlural;
      if (qc.idFields && qc.idFields.length) out.idFields = qc.idFields.slice();
      if (qc.unprofitableMetricKey) out.unprofitableMetricKey = qc.unprofitableMetricKey;
      if (qc.insightsPrimaryKey) out.insightsPrimaryKey = qc.insightsPrimaryKey;
      if (qc.fieldCatalog && qc.fieldCatalog.length) {
        out.fieldCatalog = mergeFieldCatalogs(out.fieldCatalog, qc.fieldCatalog);
      }
    }
    return out;
  }

  function extractMetricHint(question, qctx, available) {
    if (!available || !available.length || !qctx || !qctx.fieldCatalog || !qctx.fieldCatalog.length) {
      return null;
    }
    var tokens = expandSynonyms(removeStopWords(tokenize(question)));
    var bestKey = null;
    var bestHits = 0;
    var catalog = qctx.fieldCatalog;
    for (var c = 0; c < catalog.length; c++) {
      var entry = catalog[c];
      if (available.indexOf(entry.key) === -1) continue;
      var hits = 0;
      var labels = entry.labels || [];
      for (var li = 0; li < labels.length; li++) {
        var ltoks = tokenizeStemmed(labels[li]);
        for (var t = 0; t < tokens.length; t++) {
          for (var u = 0; u < ltoks.length; u++) {
            if (tokens[t] === ltoks[u] || stem(tokens[t]) === stem(ltoks[u])) hits++;
          }
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestKey = entry.key;
      }
    }
    return bestHits > 0 ? bestKey : null;
  }

  function stemBagForKey(key, qctx) {
    var bag = keyToStemBag(key);
    if (qctx && qctx.fieldCatalog) {
      for (var i = 0; i < qctx.fieldCatalog.length; i++) {
        if (qctx.fieldCatalog[i].key !== key) continue;
        var labels = qctx.fieldCatalog[i].labels || [];
        for (var j = 0; j < labels.length; j++) {
          var sub = bagOfWords(tokenizeStemmed(labels[j]));
          for (var k in sub) bag[k] = (bag[k] || 0) + sub[k];
        }
        break;
      }
    }
    return bag;
  }

  /** First array of row-like objects: honor queryContext.rowsKey, then heuristic discovery. */
  function getResultRowList(result, qctx) {
    if (!result || typeof result !== 'object') return [];
    if (qctx && qctx.rowsKey && Array.isArray(result[qctx.rowsKey]) && result[qctx.rowsKey].length) {
      return result[qctx.rowsKey];
    }
    if (Array.isArray(result.customers) && result.customers.length) return result.customers;
    if (Array.isArray(result.shareOfWallet) && result.shareOfWallet.length) return result.shareOfWallet;
    var keys = Object.keys(result);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'ingestedFiles' || k === 'skills' || k === 'meta') continue;
      var v = result[k];
      if (!Array.isArray(v) || !v.length) continue;
      var row = v[0];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      var nk = collectNumericKeys(v.slice(0, Math.min(10, v.length)));
      if (nk.length || row.customerId != null || row.customer_id != null) return v;
    }
    return [];
  }

  var SKIP_SCHEMA_KEYS = { customerId: true, customer_id: true, segment: true, raw: true };

  function collectNumericKeys(list) {
    if (!list || !list.length) return [];
    var keySet = {};
    var sample = list.slice(0, Math.min(25, list.length));
    for (var i = 0; i < sample.length; i++) {
      var row = sample[i];
      if (!row || typeof row !== 'object') continue;
      var keys = Object.keys(row);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        if (SKIP_SCHEMA_KEYS[key]) continue;
        var v = row[key];
        if (typeof v === 'number' && !isNaN(v)) keySet[key] = true;
        else if (typeof v === 'string' && v.length && /^-?[\d.,]+$/.test(v.replace(/,/g, ''))) {
          if (!isNaN(parseFloat(v.replace(/,/g, '')))) keySet[key] = true;
        }
      }
    }
    return Object.keys(keySet);
  }

  function keyAppearanceScore(list, key) {
    var nums = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i][key];
      if (typeof v === 'number' && !isNaN(v)) nums++;
      else if (typeof v === 'string' && !isNaN(parseFloat(String(v).replace(/,/g, '')))) nums++;
    }
    return nums / Math.max(list.length, 1);
  }

  function keyToStemBag(key) {
    var spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    return bagOfWords(expandSynonyms(tokenizeStemmed(spaced)));
  }

  /** Map user question + catalog hint to a field present on rows (source-grounded). */
  function resolveMetricField(question, list, hintedMetric, qctx) {
    var available = collectNumericKeys(list);
    if (!available.length) return hintedMetric || detectPrimaryMetric(list, qctx);

    if (hintedMetric && available.indexOf(hintedMetric) !== -1 && keyAppearanceScore(list, hintedMetric) > 0.2) {
      return hintedMetric;
    }

    var qBag = bagOfWords(expandSynonyms(tokenizeStemmed(question)));
    var bestKey = null;
    var bestScore = 0;
    for (var ai = 0; ai < available.length; ai++) {
      var key = available[ai];
      var kBag = stemBagForKey(key, qctx);
      var sim = cosineSimilarity(qBag, kBag);
      if (sim > bestScore) {
        bestScore = sim;
        bestKey = key;
      }
    }
    if (bestScore >= 0.12 && bestKey) return bestKey;

    if (hintedMetric && available.indexOf(hintedMetric) !== -1) return hintedMetric;
    return detectPrimaryMetric(list, qctx) || available[0];
  }

  /** Plural entity words — with a superlative and no explicit "top 5", return all rows tied at max/min. */
  function inferPluralRankEntities(q) {
    return /\b(customers|accounts|patients|subjects|records|rows|entries)\b/i.test(q);
  }

  /** Rank without explicit "top 5" — e.g. "highest balance", "who had the most deposits". */
  function inferSuperlativeRank(q, parsed) {
    if (parsed.intent === 'rank') return;
    var explicit = /\b(?:top|best|highest|largest|bottom|worst|lowest|smallest|least)\s+\d+\b/i.test(q);
    if (explicit) return;

    var qLow = q.toLowerCase();
    var supHigh =
      /\b(highest|largest|greatest|maximum|max|biggest)\b/i.test(q) ||
      /\bwho\b[\s\S]{0,52}\b(had|has|have)\b[\s\S]{0,32}\b(the\s+)?(highest|largest|greatest|max|biggest)\b/i.test(qLow) ||
      /\bwhat\b[\s\S]{0,48}\b(?:customer|customers|patient|patients|subject|subjects|record|records|row|rows|entry|entries|account|accounts)\b[\s\S]{0,52}\b(had|has|have)\b[\s\S]{0,32}\b(the\s+)?(highest|largest|greatest|max|biggest)\b/i.test(qLow) ||
      /\bwhich\b[\s\S]{0,52}\b(had|has|have)\b[\s\S]{0,32}\b(the\s+)?(highest|largest|greatest|max|biggest)\b/i.test(qLow) ||
      /(?:^|[\s,;])the\s+most\s+\w+/i.test(q) ||
      /\bmost\s+profitable\b/i.test(qLow);

    var supLow =
      /\b(lowest|smallest|minimum|min|tiniest)\b/i.test(q) ||
      /(?:^|[\s,;])the\s+least\s+\w+/i.test(q) ||
      /\bwho\b[\s\S]{0,52}\b(had|has|have)\b[\s\S]{0,32}\b(the\s+)?(lowest|smallest|minimum|min)\b/i.test(qLow) ||
      /\bwhich\b[\s\S]{0,52}\b(had|has|have)\b[\s\S]{0,32}\b(the\s+)?(lowest|smallest|minimum|min)\b/i.test(qLow);

    if (supHigh && !supLow) {
      parsed.intent = 'rank';
      parsed.dir = 'desc';
      if (inferPluralRankEntities(q)) {
        parsed.rankAllExtremeTies = true;
      } else {
        parsed.count = 1;
      }
      return;
    }
    if (supLow && !supHigh) {
      parsed.intent = 'rank';
      parsed.dir = 'asc';
      if (inferPluralRankEntities(q)) {
        parsed.rankAllExtremeTies = true;
      } else {
        parsed.count = 1;
      }
    }
  }

  function parseQuery(question) {
    var q = question.trim();
    var parsed = {
      intent: 'summarize',
      raw: q,
      metric: null,
      threshold: null,
      comparator: null,
      count: 10,
      customerId: null,
      rankAllExtremeTies: false
    };

    for (var i = 0; i < INTENT_PATTERNS.length; i++) {
      var p = INTENT_PATTERNS[i];
      var match = q.match(p.re);
      if (match) {
        parsed.intent = p.intent;
        if (p.dir) parsed.dir = p.dir;
        if (p.fn) parsed.fn = p.fn;
        if (p.preset) parsed.preset = p.preset;
        if (match[1] && /^\d+$/.test(match[1])) parsed.count = parseInt(match[1], 10);
        break;
      }
    }

    parsed.metric = null;
    parsed.threshold = extractThreshold(q);
    parsed.comparator = extractComparator(q);
    var ec = extractCount(q);
    if (ec != null) parsed.count = ec;
    parsed.customerId = extractCustomerId(q);

    inferSuperlativeRank(q, parsed);

    return parsed;
  }

  function rowNumeric(row, metric) {
    var v = row[metric];
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') {
      var n = parseFloat(String(v).replace(/,/g, ''));
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }

  /** Treat near-equal floats as ties (rounded scores, etc.). */
  function numericApproximatelyEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'number' || typeof b !== 'number' || isNaN(a) || isNaN(b)) return false;
    return Math.abs(a - b) < 1e-6;
  }

  function isFieldSignalGlossaryQuestion(qRaw) {
    var s = String(qRaw || '').toLowerCase();
    if (!s.trim()) return false;
    if (/^\s*how many\b/.test(s) && /\banomal/.test(s) && !/\bwhat\b/.test(s) && !/\bmean\b/.test(s)) return false;
    if (/\b(top|bottom)\s+\d+\b/.test(s) && !/\b(inferred|source|mapping|anomal|ai-engine|ai engine)\b/.test(s)) return false;
    if (/\b(average|mean|median|sum|total)\s+(of\s+)?(the\s+)?(row|file|anomal)/i.test(s) &&
        !/\b(what|explain|meanings?|does)\b/.test(s)) return false;

    return (
      /\b(inferred|ai[- ]?engine|source\b|mapping|mappings|anomal|severity|confidence)\b/.test(s) ||
      /\b(field|column)\s+signal\b/.test(s) ||
      (/\b(what|how|why|explain|difference|versus|vs\b|define|meaning|understand)\b/.test(s) &&
        /\b(inferred|ai[- ]?engine|mapping|anomal|severity|source|result|test|report|mappings?)\b/.test(s))
    );
  }

  function answerFieldSignalGlossaryQuestion(qRaw, result) {
    if (!result || !result.fieldSignalTest || !result.fieldSignalLexicon) return null;
    if (!isFieldSignalGlossaryQuestion(qRaw)) return null;

    var q = String(qRaw || '').toLowerCase();
    var chunks = [];

    var wantsSourceDiff = /\b(difference|versus|vs\b|between|compared|compare)\b/.test(q) &&
      /\b(inferred|ai[- ]?engine|source)\b/.test(q);
    if (wantsSourceDiff || (/\b(inferred|ai[- ]?engine)\b/.test(q) && /\b(what|explain|mean)\b/.test(q))) {
      chunks.push(
        '**inferred** — The CSV ingestion path’s heuristic grid (header aliases, semantic hints, and value-shape scores) assigned this field to the role first.\n' +
        '**ai-engine** — Copernicus.AI `classifyFields` then adjusted some slots when its rules fired (for example customerId repair, or pinning product type vs owner code). ' +
        'If the engine did not change that role, the row still shows **inferred**.'
      );
    }

    if (/\banomal/.test(q) ||
        (/\b(what|explain|mean)\b/.test(q) && /\b(anomal|flag|issue|warn|warning)\b/.test(q))) {
      chunks.push(
        '**Anomalies** are deterministic checks from the field-signal agent: they flag likely mis-mappings or gaps (missing customerId/balance, risk header used as id, low confidence, grid disagreement, etc.). ' +
        'They are not a separate generative model — read the `anomalies` array in the JSON for exact messages.'
      );
    }

    if (/\bseverity\b/.test(q)) {
      chunks.push(
        '**Severity** — **high**: likely wrong or harmful for downstream agents; **medium**: verify before trusting; **low**: informational (e.g. the score grid slightly prefers another role).'
      );
    }

    if (chunks.length) return chunks.join('\n\n');
    return result.fieldSignalLexicon;
  }

  function executeQuery(parsed, result) {
    var qctx = mergeQueryContext(result);
    if (result && result.fieldSignalTest) {
      var gloss = answerFieldSignalGlossaryQuestion(parsed.raw, result);
      if (gloss) return gloss;
    }
    var list = getResultRowList(result, qctx);
    if (!list.length) return 'No data available to query.';

    var available = collectNumericKeys(list);
    var hint = extractMetricHint(parsed.raw, qctx, available);
    var metric = resolveMetricField(parsed.raw, list, hint, qctx);
    if (!metric) metric = detectPrimaryMetric(list, qctx);

    if (parsed.intent === 'rank') {
      return executeRank(list, metric, parsed.count, parsed.dir || 'desc', qctx, parsed);
    }
    if (parsed.intent === 'filter') {
      return executeFilter(list, metric, parsed, qctx);
    }
    if (parsed.intent === 'aggregate') {
      return executeAggregate(list, metric, parsed.fn || 'avg', qctx);
    }
    if (parsed.intent === 'explain') {
      if (parsed.customerId) return explainCustomer(list, parsed.customerId, result, qctx);
      return explainDrivers(list, result);
    }
    if (parsed.intent === 'compare') {
      return executeCompare(list, metric, qctx);
    }
    return generateSummary(result, '');
  }

  function detectPrimaryMetric(list, qctx) {
    if (!list.length) return null;
    var avail = collectNumericKeys(list);
    if (qctx && qctx.fieldCatalog && qctx.fieldCatalog.length) {
      for (var i = 0; i < qctx.fieldCatalog.length; i++) {
        var k = qctx.fieldCatalog[i].key;
        if (avail.indexOf(k) !== -1) return k;
      }
    }
    return avail.length ? avail[0] : null;
  }

  /**
   * Human-facing row label for tables and NL answers. Prefers name/reference over raw IDs
   * (idFields order: reference, customerName, then ids). Skips empty strings.
   */
  function rowCustomerId(row, qctx) {
    if (!row) return '?';
    var fields = qctx && qctx.idFields && qctx.idFields.length ? qctx.idFields : ['customerId', 'customer_id'];
    for (var i = 0; i < fields.length; i++) {
      var v = row[fields[i]];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '?';
  }

  var TAB = '\t';

  /** Tab-separated header + rows for pasting into Excel / docs. */
  function formatMetricTable(headerEntityLabel, metricTitle, rows, rowLabelFn, valueFn) {
    var ent = headerEntityLabel || 'Name';
    var lines = [
      'Rank' + TAB + ent + TAB + metricTitle
    ];
    for (var i = 0; i < rows.length; i++) {
      lines.push((i + 1) + TAB + rowLabelFn(rows[i], i) + TAB + valueFn(rows[i], i));
    }
    return lines.join('\n');
  }

  function executeRank(list, metric, count, dir, qctx, parsed) {
    var info = getMetricInfo(metric, qctx);
    var superWord = dir === 'asc' ? 'Lowest' : 'Highest';
    var ent = qctx && qctx.entityLabel ? qctx.entityLabel : 'Record';
    var plural = qctx && qctx.entityPlural ? qctx.entityPlural : 'records';

    if (parsed && parsed.rankAllExtremeTies) {
      var values = list.map(function (r) { return rowNumeric(r, metric); });
      var extreme = dir === 'asc' ? Math.min.apply(null, values) : Math.max.apply(null, values);
      var tied = list.filter(function (r) {
        return numericApproximatelyEqual(rowNumeric(r, metric), extreme);
      });
      tied.sort(function (a, b) {
        var va = rowNumeric(a, metric);
        var vb = rowNumeric(b, metric);
        return dir === 'asc' ? va - vb : vb - va;
      });
      if (!tied.length) return 'No data available to query.';
      var colEnt = qctx && qctx.entityLabel ? qctx.entityLabel : 'Name';
      var tieCaption = tied.length === 1
        ? 'Only one ' + (qctx && qctx.entityLabel ? qctx.entityLabel.toLowerCase() : 'record') +
          ' has the ' + superWord.toLowerCase() + ' ' + info.label + ': ' + ent + ' ' +
          rowCustomerId(tied[0], qctx) + ' — ' + formatValue(extreme, info.fmt) + '.'
        : 'All ' + tied.length + ' ' + plural + ' tied for ' + superWord.toLowerCase() + ' ' + info.label +
          ' (' + formatValue(extreme, info.fmt) + '). Tab-separated (paste into a spreadsheet or report):';
      var tieTable = formatMetricTable(colEnt, info.label, tied,
        function (r) { return rowCustomerId(r, qctx); },
        function (r) { return formatValue(rowNumeric(r, metric), info.fmt); }
      );
      return tied.length === 1 ? tieCaption : tieCaption + '\n\n' + tieTable;
    }

    var sorted = list.slice().sort(function (a, b) {
      var va = rowNumeric(a, metric);
      var vb = rowNumeric(b, metric);
      return dir === 'asc' ? va - vb : vb - va;
    });
    var top = sorted.slice(0, count);

    var label = dir === 'asc' ? 'Bottom' : 'Top';
    var colEnt = qctx && qctx.entityLabel ? qctx.entityLabel : 'Name';
    var headline = count === 1 && top.length === 1
      ? superWord + ' ' + info.label + ': ' + ent + ' ' + rowCustomerId(top[0], qctx) +
        ' — ' + formatValue(rowNumeric(top[0], metric), info.fmt) + '.'
      : label + ' ' + top.length + ' ' + plural + ' by ' + info.label +
        '. Tab-separated (paste into Excel or another report):';
    var tableBlock = formatMetricTable(colEnt, info.label, top,
      function (r) { return rowCustomerId(r, qctx); },
      function (r) { return formatValue(rowNumeric(r, metric), info.fmt); }
    );
    var total = list.reduce(function (s, r) { return s + rowNumeric(r, metric); }, 0);
    var topTotal = top.reduce(function (s, r) { return s + rowNumeric(r, metric); }, 0);
    var pctNote = '';
    if (total > 0 && top.length > 1) {
      pctNote = '\n\nThese ' + top.length + ' represent ' +
        Math.round(topTotal / total * 100) + '% of total ' + info.label + '.';
    } else if (total > 0 && top.length === 1 && !(count === 1 && top.length === 1)) {
      pctNote = '\n\nThis row represents ' +
        Math.round(topTotal / total * 100) + '% of total ' + info.label + '.';
    }
    if (count === 1 && top.length === 1) {
      return headline;
    }
    return headline + '\n\n' + tableBlock + pctNote;
  }

  function executeFilter(list, metric, parsed, qctx) {
    var filtered;
    if (parsed.preset === 'unprofitable') {
      var defKey = qctx && qctx.unprofitableMetricKey ? qctx.unprofitableMetricKey : 'monthlyProfit';
      var m = resolveMetricField(parsed.raw, list, defKey, qctx);
      filtered = list.filter(function (r) { return rowNumeric(r, m) < 0; });
      metric = m;
    } else {
      var thresh = parsed.threshold;
      var comp = parsed.comparator;
      if (thresh == null) {
        var stats = computeStats(list.map(function (r) { return rowNumeric(r, metric); }));
        thresh = stats.mean;
        comp = 'gt';
      }
      filtered = list.filter(function (r) {
        var v = rowNumeric(r, metric);
        return comp === 'lt' ? v < thresh : v > thresh;
      });
    }

    var info = getMetricInfo(metric, qctx);
    if (!filtered.length) return 'No ' + (qctx && qctx.entityPlural ? qctx.entityPlural : 'records') + ' match that criteria.';

    var avgVal = filtered.reduce(function (s, r) { return s + rowNumeric(r, metric); }, 0) / filtered.length;
    var pct = Math.round(filtered.length / list.length * 100);
    var plural = qctx && qctx.entityPlural ? qctx.entityPlural : 'records';
    var result = filtered.length + ' ' + (filtered.length === 1 ? (qctx && qctx.entityLabel ? qctx.entityLabel.toLowerCase() : 'record') : plural) +
      ' (' + pct + '% of total) match. Average ' + info.label + ': ' + formatValue(avgVal, info.fmt) + '.';

    if (filtered.length <= 10) {
      filtered.sort(function (a, b) { return rowNumeric(b, metric) - rowNumeric(a, metric); });
      var colEnt = qctx && qctx.entityLabel ? qctx.entityLabel : 'Name';
      result += '\n\nTab-separated (paste into a spreadsheet or report):\n\n';
      result += formatMetricTable(colEnt, info.label, filtered,
        function (r) { return rowCustomerId(r, qctx); },
        function (r) { return formatValue(rowNumeric(r, metric), info.fmt); }
      );
    }
    return result;
  }

  function executeAggregate(list, metric, fn, qctx) {
    var values = list.map(function (r) { return rowNumeric(r, metric); });
    var info = getMetricInfo(metric, qctx);
    var stats = computeStats(values);
    var plural = qctx && qctx.entityPlural ? qctx.entityPlural : 'records';
    if (fn === 'count') {
      return list.length + ' ' + plural + ' total.';
    }
    if (fn === 'sum') {
      return 'Total ' + info.label + ': ' + formatValue(stats.sum, info.fmt) +
        ' across ' + list.length + ' ' + plural + '.';
    }
    return 'Average ' + info.label + ': ' + formatValue(stats.mean, info.fmt) +
      ' (median: ' + formatValue(stats.median, info.fmt) +
      ', range: ' + formatValue(stats.min, info.fmt) + ' to ' + formatValue(stats.max, info.fmt) + ').';
  }

  function explainCustomer(list, custId, result, qctx) {
    var cid = String(custId).trim();
    var cust = null;
    var idFields = qctx && qctx.idFields && qctx.idFields.length ? qctx.idFields : ['customerId', 'customer_id'];
    for (var i = 0; i < list.length; i++) {
      for (var fi = 0; fi < idFields.length; fi++) {
        var f = idFields[fi];
        if (String(list[i][f]).trim() === cid) {
          cust = list[i];
          break;
        }
      }
      if (cust) break;
    }
    var ent = qctx && qctx.entityLabel ? qctx.entityLabel : 'Record';
    if (!cust) return ent + ' ' + cid + ' not found in the results.';

    var who = (cust.reference || cust.customerName || '').trim();
    var lines = [who ? (ent + ' ' + who + ' — breakdown') : (ent + ' ' + cid + ' breakdown')];
    lines[0] += ':';
    var keys = Object.keys(cust);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (idFields.indexOf(key) !== -1) continue;
      var info = getMetricInfo(key, qctx);
      var val = cust[key];
      if (val != null && typeof val === 'number') {
        lines.push('  ' + info.label + ': ' + formatValue(val, info.fmt));
      }
    }

    if (cust.monthlyProfit != null) {
      if (cust.monthlyProfit < 0) {
        lines.push('');
        lines.push('This ' + (ent.toLowerCase()) + ' is unprofitable.');
        if (cust.totalBalance != null && cust.totalCost != null) {
          if (cust.totalBalance < 5000) lines.push('Primary cause: low balance generates insufficient credit for funding.');
          if (cust.numChecks > 20 || cust.numDeposits > 20) lines.push('Contributing factor: high transaction volume increases processing costs.');
          if (cust.numNSF > 0) lines.push('Note: ' + cust.numNSF + ' NSF items add $' + (cust.numNSF * 3).toFixed(2) + ' in processing cost.');
        }
      } else {
        lines.push('');
        lines.push('This ' + ent.toLowerCase() + ' is profitable at ' + formatValue(cust.monthlyProfit, 'dollar') + '/month.');
      }
    }
    return lines.join('\n');
  }

  function explainDrivers(list, result) {
    var lines = [];

    if (result && result.fieldSignalTest) {
      lines.push(
        'This agent audits **CSV field → role** mappings (not customer profitability). Each result row is one ingested file.'
      );
      for (var csi = 0; csi < list.length; csi++) {
        var cr = list[csi];
        var cfn = cr.fileName != null ? cr.fileName : '?';
        var cac = cr.anomalyCount != null ? cr.anomalyCount : 0;
        var cmc = cr.mappings && cr.mappings.length != null ? cr.mappings.length : 0;
        lines.push('• ' + cfn + ' — ' + cac + ' anomaly flag(s), ' + cmc + ' role mapping(s).');
      }
      if (result.fieldSignalLexicon) {
        lines.push('');
        lines.push(result.fieldSignalLexicon);
      }
      return lines.join('\n');
    }

    if (result.profitableCount != null) {
      lines.push(result.profitableCount + ' of ' + list.length + ' customers are profitable (' +
        Math.round(result.profitableCount / list.length * 100) + '%).');
    }

    var hasRevenue = list[0] && list[0].creditForFunding != null;
    if (hasRevenue) {
      var totalCFF = 0, totalFee = 0, totalIntPaid = 0, totalTxn = 0, totalMaint = 0;
      for (var i = 0; i < list.length; i++) {
        totalCFF += list[i].creditForFunding || 0;
        totalFee += list[i].netFeeRevenue || 0;
        totalIntPaid += list[i].interestPaid || 0;
        totalTxn += list[i].txnProcessingCost || 0;
        totalMaint += list[i].accountMaintCost || 0;
      }
      var totalRev = totalCFF + totalFee;
      if (totalRev > 0) {
        lines.push('Revenue composition: credit for funding ' + formatValue(totalCFF, 'dollar') +
          ' (' + Math.round(totalCFF / totalRev * 100) + '%), net fees ' +
          formatValue(totalFee, 'dollar') + ' (' + Math.round(totalFee / totalRev * 100) + '%).');
      }
      var totalCost = totalIntPaid + totalTxn + totalMaint;
      if (totalCost > 0) {
        lines.push('Cost composition: interest paid ' + formatValue(totalIntPaid, 'dollar') +
          ' (' + Math.round(totalIntPaid / totalCost * 100) + '%), processing ' +
          formatValue(totalTxn, 'dollar') + ' (' + Math.round(totalTxn / totalCost * 100) +
          '%), maintenance ' + formatValue(totalMaint, 'dollar') +
          ' (' + Math.round(totalMaint / totalCost * 100) + '%).');
      }
    }

    var balances = list.map(function (r) { return r.totalBalance || 0; });
    var profits = list.map(function (r) { return r.monthlyProfit || r.shareOfWallet || 0; });
    var corr = pearsonCorrelation(balances, profits);
    if (!isNaN(corr)) {
      var strength = Math.abs(corr) > 0.7 ? 'strong' : Math.abs(corr) > 0.4 ? 'moderate' : 'weak';
      lines.push('Balance-to-profitability correlation: ' + strength + ' (r=' + corr.toFixed(2) + ').');
    }

    if (!lines.length) lines.push('Run the agent with data to see driver analysis.');
    return lines.join('\n');
  }

  function executeCompare(list, metric, qctx) {
    var info = getMetricInfo(metric, qctx);
    var groupA = list.filter(function (r) { return rowNumeric(r, metric) > 0; });
    var groupB = list.filter(function (r) { return rowNumeric(r, metric) <= 0; });
    var plural = qctx && qctx.entityPlural ? qctx.entityPlural : 'records';

    if (!groupA.length || !groupB.length) {
      return 'All ' + plural + ' fall on the same side — no meaningful comparison.';
    }

    var avgA = groupA.reduce(function (s, r) { return s + rowNumeric(r, metric); }, 0) / groupA.length;
    var avgB = groupB.reduce(function (s, r) { return s + rowNumeric(r, metric); }, 0) / groupB.length;

    var balKey = null;
    if (qctx && qctx.fieldCatalog) {
      for (var ci = 0; ci < qctx.fieldCatalog.length; ci++) {
        if (qctx.fieldCatalog[ci].key === 'totalBalance' || qctx.fieldCatalog[ci].key === 'totalDeposits') {
          var bk = qctx.fieldCatalog[ci].key;
          if (list[0] && list[0][bk] != null) { balKey = bk; break; }
        }
      }
    }
    if (!balKey && list[0]) {
      if (list[0].totalBalance != null) balKey = 'totalBalance';
      else if (list[0].totalDeposits != null) balKey = 'totalDeposits';
    }
    var balA = 0, balB = 0;
    if (balKey) {
      balA = groupA.reduce(function (s, r) { return s + rowNumeric(r, balKey); }, 0) / groupA.length;
      balB = groupB.reduce(function (s, r) { return s + rowNumeric(r, balKey); }, 0) / groupB.length;
    }

    var lines = [
      'Positive ' + info.label + ' group: ' + groupA.length + ' ' + plural + ', avg ' + formatValue(avgA, info.fmt) +
        (balKey ? ', avg balance-like ' + formatValue(balA, 'dollar') : '') + '.',
      'Negative/zero group: ' + groupB.length + ' ' + plural + ', avg ' + formatValue(avgB, info.fmt) +
        (balKey ? ', avg balance-like ' + formatValue(balB, 'dollar') : '') + '.'
    ];

    if (balKey && balB > 0 && balA > balB * 1.5) {
      lines.push('The positive group has ' + (balA / balB).toFixed(1) + 'x higher average on that balance field.');
    }
    return lines.join('\n');
  }

  /* ================================================================
   * Section 4: Insight Engine — statistical analysis + templates
   * ================================================================ */

  var METRIC_INFO = {
    totalBalance: { label: 'balance', fmt: 'dollar' },
    monthlyProfit: { label: 'monthly profit', fmt: 'dollar' },
    creditForFunding: { label: 'credit for funding', fmt: 'dollar' },
    interestPaid: { label: 'interest paid', fmt: 'dollar' },
    netFeeRevenue: { label: 'net fee revenue', fmt: 'dollar' },
    totalRevenue: { label: 'total revenue', fmt: 'dollar' },
    txnProcessingCost: { label: 'processing cost', fmt: 'dollar' },
    accountMaintCost: { label: 'maintenance cost', fmt: 'dollar' },
    totalCost: { label: 'total cost', fmt: 'dollar' },
    numDeposits: { label: 'deposits', fmt: 'int' },
    numChecks: { label: 'checks', fmt: 'int' },
    numNSF: { label: 'NSF items', fmt: 'int' },
    avgRate: { label: 'avg rate', fmt: 'pct' },
    tenureYears: { label: 'tenure', fmt: 'years' },
    accountCount: { label: 'accounts', fmt: 'int' },
    shareOfWallet: { label: 'share of wallet', fmt: 'score' },
    depthScore: { label: 'depth score', fmt: 'score' },
    totalDeposits: { label: 'total deposits', fmt: 'dollar' },
    totalLoans: { label: 'total loans', fmt: 'dollar' }
  };

  function getMetricInfo(key, qctx) {
    if (qctx && qctx.fieldCatalog) {
      for (var i = 0; i < qctx.fieldCatalog.length; i++) {
        if (qctx.fieldCatalog[i].key === key) {
          var fe = qctx.fieldCatalog[i];
          var lbl = fe.displayLabel || (fe.labels && fe.labels[0]) || key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
          return { label: lbl, fmt: fe.fmt || 'num' };
        }
      }
    }
    return METRIC_INFO[key] || { label: key.replace(/([A-Z])/g, ' $1').toLowerCase().trim(), fmt: 'num' };
  }

  function formatValue(val, fmt) {
    if (val == null) return 'N/A';
    if (fmt === 'dollar') {
      var neg = val < 0;
      var abs = Math.abs(Math.round(val * 100) / 100);
      var parts = abs.toFixed(2).split('.');
      var integer = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (neg ? '-$' : '$') + integer + '.' + parts[1];
    }
    if (fmt === 'pct') return (val * 100).toFixed(2) + '%';
    if (fmt === 'years') return val != null ? val.toFixed(1) + ' yrs' : 'N/A';
    if (fmt === 'int') return Math.round(val).toLocaleString();
    if (fmt === 'score') return Math.round(val * 100) / 100 + '';
    if (fmt === 'text') return String(val);
    return String(Math.round(val * 100) / 100);
  }

  function computeStats(values) {
    if (!values.length) return { mean: 0, median: 0, min: 0, max: 0, stddev: 0, sum: 0, count: 0, cv: 0, p25: 0, p75: 0 };
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += sorted[i];
    var mean = sum / n;
    var variance = 0;
    for (var j = 0; j < n; j++) variance += Math.pow(sorted[j] - mean, 2);
    var stddev = Math.sqrt(variance / n);
    var median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    var p25 = sorted[Math.floor(n * 0.25)];
    var p75 = sorted[Math.floor(n * 0.75)];

    return {
      mean: mean, median: median, min: sorted[0], max: sorted[n - 1],
      stddev: stddev, sum: sum, count: n,
      cv: mean !== 0 ? stddev / Math.abs(mean) : 0,
      p25: p25, p75: p75, iqr: p75 - p25
    };
  }

  function pearsonCorrelation(xs, ys) {
    if (xs.length !== ys.length || xs.length < 3) return NaN;
    var n = xs.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += xs[i]; sumY += ys[i];
      sumXY += xs[i] * ys[i];
      sumX2 += xs[i] * xs[i]; sumY2 += ys[i] * ys[i];
    }
    var denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  /** Balance-like X vs outcome Y for insight correlation; never X === Y. */
  function pickCorrelationFields(avail, primary) {
    if (!avail || !avail.length || !primary) return null;
    var balanceKey = null;
    if (avail.indexOf('totalBalance') !== -1) balanceKey = 'totalBalance';
    else if (avail.indexOf('totalDeposits') !== -1) balanceKey = 'totalDeposits';
    if (!balanceKey) return null;
    var yKey = primary;
    if (yKey === balanceKey) {
      if (avail.indexOf('monthlyProfit') !== -1) yKey = 'monthlyProfit';
      else if (avail.indexOf('shareOfWallet') !== -1) yKey = 'shareOfWallet';
      else if (avail.indexOf('totalRevenue') !== -1) yKey = 'totalRevenue';
      else if (avail.indexOf('depthScore') !== -1) yKey = 'depthScore';
      else return null;
    }
    if (yKey === balanceKey) return null;
    return { xKey: balanceKey, yKey: yKey };
  }

  function generateInsights(result, agentName) {
    if (result && result.fieldSignalTestInsights && result.fieldSignalTest) {
      return result.fieldSignalTestInsights;
    }
    var qctxInsight = mergeQueryContext(result);
    var list = getResultRowList(result, qctxInsight);
    if (!list.length) return { summary: 'No data to analyze.', insights: [] };

    var avail = collectNumericKeys(list);
    var insights = [];
    var primary = null;
    if (qctxInsight.insightsPrimaryKey && avail.indexOf(qctxInsight.insightsPrimaryKey) !== -1) {
      primary = qctxInsight.insightsPrimaryKey;
    }
    if (!primary) primary = detectPrimaryMetric(list, qctxInsight);
    if (!primary) primary = avail[0];
    var values = list.map(function (r) { return rowNumeric(r, primary); });
    var stats = computeStats(values);
    var info = getMetricInfo(primary, qctxInsight);
    var pluralEnt = qctxInsight.entityPlural || 'records';

    insights.push({
      priority: 10,
      text: 'Across ' + list.length + ' ' + pluralEnt + ', ' + info.label + ' ranges from ' +
        formatValue(stats.min, info.fmt) + ' to ' + formatValue(stats.max, info.fmt) +
        ' (median: ' + formatValue(stats.median, info.fmt) +
        ', mean: ' + formatValue(stats.mean, info.fmt) + ').'
    });

    if (result.profitableCount != null) {
      var pctProf = Math.round(result.profitableCount / list.length * 100);
      insights.push({
        priority: 9,
        text: result.profitableCount + ' ' + pluralEnt + ' (' + pctProf + '%) are profitable, ' +
          result.unprofitableCount + ' (' + (100 - pctProf) + '%) are unprofitable.'
      });
    }

    if (stats.cv > 0.5) {
      insights.push({
        priority: 7,
        text: info.label.charAt(0).toUpperCase() + info.label.slice(1) +
          ' shows high variation (CV=' + stats.cv.toFixed(2) +
          '). The spread suggests distinct segments among these ' + pluralEnt + '.'
      });
    }

    var sorted = list.slice().sort(function (a, b) { return rowNumeric(b, primary) - rowNumeric(a, primary); });
    var top10pct = Math.max(1, Math.ceil(list.length * 0.1));
    var topSlice = sorted.slice(0, top10pct);
    var topSum = topSlice.reduce(function (s, r) { return s + rowNumeric(r, primary); }, 0);
    if (stats.sum > 0 && topSum > 0) {
      var concentration = Math.round(topSum / stats.sum * 100);
      if (concentration > 30) {
        insights.push({
          priority: 8,
          text: 'Concentration: the top ' + top10pct + ' ' + pluralEnt +
            ' (' + Math.round(top10pct / list.length * 100) +
            '%) account for ' + concentration + '% of total ' + info.label + '.'
        });
      }
    }

    if (list[0] && list[0].creditForFunding != null) {
      var totalCFF = 0, totalFee = 0;
      for (var i = 0; i < list.length; i++) {
        totalCFF += list[i].creditForFunding || 0;
        totalFee += list[i].netFeeRevenue || 0;
      }
      var totalRev = totalCFF + totalFee;
      if (totalRev > 0) {
        insights.push({
          priority: 8,
          text: 'Revenue drivers: credit for funding contributes ' +
            Math.round(totalCFF / totalRev * 100) + '% (' + formatValue(totalCFF, 'dollar') +
            '), net fee income contributes ' + Math.round(totalFee / totalRev * 100) +
            '% (' + formatValue(totalFee, 'dollar') + ').'
        });
      }
    }

    var corrPair = pickCorrelationFields(avail, primary);
    if (corrPair && list.length > 5) {
      var xs = list.map(function (r) { return rowNumeric(r, corrPair.xKey); });
      var ys = list.map(function (r) { return rowNumeric(r, corrPair.yKey); });
      var corr = pearsonCorrelation(xs, ys);
      if (!isNaN(corr) && Math.abs(corr) > 0.3) {
        var strength = Math.abs(corr) > 0.7 ? 'Strong' : 'Moderate';
        var infoX = getMetricInfo(corrPair.xKey, qctxInsight);
        var infoY = getMetricInfo(corrPair.yKey, qctxInsight);
        insights.push({
          priority: 6,
          text: strength + ' correlation between ' + infoX.label + ' and ' + infoY.label +
            ' (r=' + corr.toFixed(2) + '). ' +
            (corr > 0 ? 'Higher ' + infoX.label + ' tends to align with higher ' + infoY.label + '.' :
              'Higher ' + infoX.label + ' tends to align with lower ' + infoY.label + '.')
        });
      }
    }

    var outlierThresh = stats.p75 + 1.5 * stats.iqr;
    var outlierLow = stats.p25 - 1.5 * stats.iqr;
    var outliers = list.filter(function (r) {
      var v = rowNumeric(r, primary);
      return v > outlierThresh || v < outlierLow;
    });
    if (outliers.length > 0 && outliers.length < list.length * 0.2) {
      var entLab = qctxInsight.entityLabel || 'Record';
      insights.push({
        priority: 5,
        text: outliers.length + ' outlier' + (outliers.length !== 1 ? 's' : '') +
          ' on ' + info.label + ' beyond 1.5× IQR. Most extreme: ' + entLab + ' ' +
          rowCustomerId(sorted[0], qctxInsight) + ' at ' +
          formatValue(rowNumeric(sorted[0], primary), info.fmt) + '.'
      });
    }

    if (stats.median !== 0 && Math.abs(stats.mean - stats.median) / Math.abs(stats.median) > 0.3) {
      var skewDir = stats.mean > stats.median ? 'right' : 'left';
      insights.push({
        priority: 4,
        text: 'Distribution is ' + skewDir + '-skewed — mean (' + formatValue(stats.mean, info.fmt) +
          ') differs significantly from median (' + formatValue(stats.median, info.fmt) +
          '). A few extreme values pull the average ' +
          (skewDir === 'right' ? 'higher' : 'lower') + '.'
      });
    }

    insights.sort(function (a, b) { return b.priority - a.priority; });
    var topInsights = insights.slice(0, 6);
    var summary = topInsights.map(function (ins) { return ins.text; }).join(' ');

    return { summary: summary, insights: topInsights, statistics: stats };
  }

  function generateSummary(result, agentName) {
    var analysis = generateInsights(result, agentName);
    return analysis.summary || 'Analysis complete.';
  }

  /* ================================================================
   * Section 5: Public API — wire to Copernicus.AI
   * ================================================================ */

  LA.AI.isAvailable = function () { return true; };

  LA.AI.getStatus = function () {
    return Promise.resolve({ available: true, ready: true, engine: 'Copernicus AI Engine v1.0' });
  };

  function soulAddressingPrefix() {
    if (!LA.Soul || typeof LA.Soul.getAddressingPrefix !== 'function') return '';
    try {
      return LA.Soul.getAddressingPrefix();
    } catch (e) {
      return '';
    }
  }

  function prependSoulPrefix(body) {
    var pre = soulAddressingPrefix();
    if (!pre || !body) return body || '';
    return pre + String(body).replace(/^\s+/, '');
  }

  LA.AI.explain = function (result, agentName, onChunk) {
    var text = prependSoulPrefix(generateSummary(result, agentName));
    if (onChunk) onChunk(text);
    return Promise.resolve(text);
  };

  LA.AI.ask = function (question, resultContext, onChunk) {
    var parsed = parseQuery(question);
    var text;
    if (typeof resultContext === 'object' && resultContext !== null) {
      text = executeQuery(parsed, resultContext);
    } else {
      text = 'Please run an agent first to generate data for querying.';
    }
    text = prependSoulPrefix(text);
    if (onChunk) onChunk(text);
    return Promise.resolve(text);
  };

  LA.AI.classifyFields = classifyFields;
  LA.AI.isRiskOrRatingLikeCustomerIdHeader = isRiskOrRatingLikeCustomerIdHeader;
  LA.AI.isImplausibleCustomerIdValues = isImplausibleCustomerIdValues;
  LA.AI.valuesPredominantlyFractionalNumeric = valuesPredominantlyFractionalNumeric;
  LA.AI.parseQuery = parseQuery;
  LA.AI.getResultRowList = getResultRowList;
  LA.AI.mergeQueryContext = mergeQueryContext;
  LA.AI.resolveMetricField = resolveMetricField;
  LA.AI.computeStats = computeStats;
  LA.AI.generateInsights = generateInsights;
  LA.AI.tokenize = tokenize;
  LA.AI.stem = stem;

})(typeof window !== 'undefined' ? window : this);
