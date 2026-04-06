/**
 * Fiserv Small Business Index (FSBI) — BankersIQ JSON API.
 *
 * State-wide trend (one call): /api/FSBI/?inflationAdjusted=0&state=VT → many rows (ALL/ALL), meta.count.
 * Slice: add period + subSector for a single industry month, e.g. inflationAdjusted=1&state=VT&period=20260301&subSector=...
 * City-level series are uncommon.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var DEFAULT_FSBI_BASE = 'https://bankersiq.com/api/FSBI/';

  function fsbiBaseUrl() {
    var u = LA.FSBI && LA.FSBI.baseUrl;
    return (u != null && String(u).trim()) ? String(u).trim().replace(/[?&]+$/, '') : DEFAULT_FSBI_BASE;
  }

  /** Normalize period to YYYYMMDD (digits only, 8 chars). */
  function normalizePeriod(period) {
    if (period == null) return '';
    var d = String(period).replace(/\D/g, '');
    if (d.length >= 8) return d.slice(0, 8);
    return '';
  }

  function parseFsbiRow(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    var out = {};
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      var v = raw[k];
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
        out[k] = parseFloat(v, 10);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Prefer ALL/ALL statewide rows when present; else return full data sorted by period.
   */
  function sortAndFilterStatewideSeries(rows) {
    if (!rows || !rows.length) return [];
    var all = rows.filter(function (r) {
      return String((r && r.subSectorName) || '').toUpperCase() === 'ALL' &&
        String((r && r.sectorName) || '').toUpperCase() === 'ALL';
    });
    var use = all.length ? all : rows.slice();
    return use.sort(function (a, b) {
      return String(a.period || '').localeCompare(String(b.period || ''));
    });
  }

  /**
   * @param {object} opts
   * @param {string} opts.state — 2-letter state (required)
   * @param {string} [opts.period] — omit for full state time series
   * @param {string} [opts.subSector] — omit with period for statewide ALL series
   * @param {boolean} [opts.inflationAdjusted]
   * @param {string} [opts.city] — rarely available in source data
   * @param {string} [opts.sector]
   * @param {string} [opts.apiKey] — optional api_key query param (same BankersIQ key as trates)
   */
  function buildFsbiUrl(opts) {
    var base = fsbiBaseUrl();
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    var q = [];
    q.push('inflationAdjusted=' + (opts.inflationAdjusted ? '1' : '0'));
    if (opts.state) q.push('state=' + encodeURIComponent(String(opts.state).trim().toUpperCase()));
    if (opts.city && String(opts.city).trim()) {
      q.push('city=' + encodeURIComponent(String(opts.city).trim()));
    }
    var per = normalizePeriod(opts.period);
    if (per) q.push('period=' + encodeURIComponent(per));
    if (opts.sector && String(opts.sector).trim()) {
      q.push('sector=' + encodeURIComponent(String(opts.sector).trim()));
    }
    if (opts.subSector && String(opts.subSector).trim()) {
      q.push('subSector=' + encodeURIComponent(String(opts.subSector).trim()));
    }
    if (opts.apiKey && String(opts.apiKey).trim()) {
      q.push('api_key=' + encodeURIComponent(String(opts.apiKey).trim()));
    }
    return base + sep + q.join('&');
  }

  function fetchFsbi(opts) {
    if (!opts || !opts.state || !String(opts.state).trim()) {
      return Promise.reject(new Error('FSBI requires state'));
    }

    var url = buildFsbiUrl(opts);
    return fetch(url, { method: 'GET', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('FSBI HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var rows = (j.data || []).map(parseFsbiRow);
      return {
        meta: j.meta || {},
        data: rows,
        requestUrl: url.replace(/api_key=[^&]+/, 'api_key=(redacted)')
      };
    });
  }

  LA.FSBI = LA.FSBI || {};
  LA.FSBI.baseUrl = LA.FSBI.baseUrl || null;

  LA.tools = LA.tools || {};
  LA.tools.fsbi = {
    DEFAULT_FSBI_BASE: DEFAULT_FSBI_BASE,
    normalizePeriod: normalizePeriod,
    buildFsbiUrl: buildFsbiUrl,
    fetchFsbi: fetchFsbi,
    sortAndFilterStatewideSeries: sortAndFilterStatewideSeries
  };
})(typeof window !== 'undefined' ? window : this);
