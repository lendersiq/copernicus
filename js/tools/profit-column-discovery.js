/**
 * Stem-aware discovery of profitability fields from CSV headers.
 * Uses Copernicus.AI.stem (Porter-style suffix rules) + skill lexicon
 * banking.profit-column-signals.headerSignals.checkingProfitability
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  /* Minimal stem fallback if ai-engine loads later (should not happen with correct script order). */
  function stemFallback(word) {
    var w = String(word || '').toLowerCase();
    if (w.length < 4) return w;
    var rules = [
      ['ational', 'ate'], ['tional', 'tion'], ['ization', 'ize'], ['fulness', 'ful'],
      ['iveness', 'ive'], ['ation', 'ate'], ['ments', ''], ['ness', ''],
      ['ingly', ''], ['edly', ''], ['ing', ''], ['ies', 'y'], ['ied', 'y'],
      ['ed', ''], ['ly', ''], ['es', ''], ['s', '']
    ];
    for (var i = 0; i < rules.length; i++) {
      var suf = rules[i][0];
      if (w.length > suf.length + 2 && w.slice(-suf.length) === suf) {
        return w.slice(0, -suf.length) + rules[i][1];
      }
    }
    return w;
  }

  function getStemFn() {
    if (LA.AI && typeof LA.AI.stem === 'function') return LA.AI.stem;
    return stemFallback;
  }

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[\s\-\.]+/g, '_').trim();
  }

  function stemWord(stemFn, token) {
    var t = String(token || '').toLowerCase();
    if (!t) return '';
    return stemFn(t);
  }

  function underscoreStemPath(stemFn, underscored) {
    return underscored.split('_').filter(Boolean).map(function (t) {
      return stemWord(stemFn, t);
    }).join('_');
  }

  function stemTokenSet(stemFn, underscored) {
    var out = {};
    underscored.split('_').filter(Boolean).forEach(function (t) {
      var s = stemWord(stemFn, t);
      if (s) out[s] = true;
    });
    return out;
  }

  /**
   * Match header to signal: literal / substring, stemmed path, or stem token subset (multi-word).
   */
  function headerMatchesSignal(stemFn, rawHeader, signalPhrase) {
    var h = normHeader(rawHeader);
    var sig = normHeader(signalPhrase);
    if (!h || !sig) return false;

    if (h === sig) return true;
    if (h.indexOf(sig) !== -1) return true;
    if (sig.length >= 4 && h.length >= sig.length && sig.indexOf(h) !== -1) return true;

    var hPath = underscoreStemPath(stemFn, h);
    var sPath = underscoreStemPath(stemFn, sig);
    if (hPath === sPath) return true;
    if (sPath.length >= 4 && hPath.indexOf(sPath) !== -1) return true;
    if (hPath.length >= 4 && sPath.indexOf(hPath) !== -1) return true;

    var sigParts = sig.split('_').filter(Boolean);
    if (sigParts.length < 2) return false;

    var hSet = stemTokenSet(stemFn, h);
    for (var i = 0; i < sigParts.length; i++) {
      var st = stemWord(stemFn, sigParts[i]);
      if (!st || st.length < 2) continue;
      if (!hSet[st]) return false;
    }
    return true;
  }

  function getCheckingProfitSignals(LARef) {
    var skill = LARef.Skills.get('banking.profit-column-signals');
    var bundle = skill && skill.headerSignals && skill.headerSignals.checkingProfitability;
    return bundle || null;
  }

  /**
   * @param {string[]} headers
   * @param {object} LARef - Copernicus
   * @returns {object} role -> column index
   */
  function discoverCheckingProfitColumns(headers, LARef) {
    var map = {};
    var signals = getCheckingProfitSignals(LARef);
    if (!signals || !headers || !headers.length) return map;

    var stemFn = getStemFn();

    for (var role in signals) {
      var list = signals[role];
      if (!list || !list.length) continue;

      for (var i = 0; i < headers.length; i++) {
        var matched = false;
        for (var s = 0; s < list.length; s++) {
          if (headerMatchesSignal(stemFn, headers[i], list[s])) {
            map[role] = i;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
    return map;
  }

  LA.tools = LA.tools || {};
  LA.tools.discoverCheckingProfitColumns = discoverCheckingProfitColumns;
  LA.tools.headerMatchesProfitSignal = function (rawHeader, signalPhrase) {
    return headerMatchesSignal(getStemFn(), rawHeader, signalPhrase);
  };
})(typeof window !== 'undefined' ? window : this);
