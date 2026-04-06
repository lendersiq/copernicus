/**
 * FDIC Summary of Deposits (SOD) — BankFind Suite API client.
 * Base: https://api.fdic.gov/banks/sod — branch-level rows; deposits in $ thousands (DEPSUMBR preferred).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var SOD_BASE = 'https://api.fdic.gov/banks/sod';
  var PAGE_SIZE = 1000;
  var MAX_ROWS = 50000;

  function normState(s) {
    if (s == null) return '';
    var t = String(s).trim().toUpperCase();
    return t.length === 2 ? t : '';
  }

  function normZip(z) {
    if (z == null) return '';
    var d = String(z).replace(/\D/g, '');
    if (d.length >= 5) return d.slice(0, 5);
    return '';
  }

  /**
   * 2-letter US state from 5-digit ZIP when `Copernicus.ZipStateData` is present
   * (load `js/data/zip5-to-state.js` after `framework.js`).
   */
  function inferUsStateFromZip(zip) {
    var z = normZip(zip);
    if (z.length !== 5) return '';
    var map = LA.ZipStateData;
    if (!map || typeof map !== 'object') return '';
    var st = map[z];
    if (st == null || st === '') return '';
    var u = String(st).trim().toUpperCase();
    return u.length === 2 ? u : '';
  }

  /**
   * Escape double quotes inside a phrase for FDIC Elasticsearch-style filters.
   */
  function escapePhrase(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * Build SOD filter: ZIP mode (ZIPBR only) or city + state (CITYBR phrase + STALP).
   * Prefer ZIP when present. Do not AND STALP on ZIP: it can drop valid branch rows that match
   * the public SOD ZIP extract (STALP quirks vs branch location); 5-digit ZIP is already specific.
   */
  function buildSodGeoFilter(opts) {
    var st = normState(opts.state);
    var zip = normZip(opts.zip);
    var city = opts.city != null ? String(opts.city).trim() : '';
    if (zip) {
      return 'ZIPBR:' + zip;
    }
    if (city && st) {
      return 'CITYBR:"' + escapePhrase(city) + '" AND STALP:' + st;
    }
    return '';
  }

  function branchDepositsThousands(row) {
    var d = row && row.data ? row.data : row;
    if (!d) return 0;
    var br = Number(d.DEPSUMBR);
    if (isFinite(br) && br > 0) return br;
    var sm = Number(d.DEPSUM);
    if (isFinite(sm) && sm > 0) return sm;
    return 0;
  }

  function parseYear(row) {
    var d = row && row.data ? row.data : row;
    if (!d || d.YEAR == null) return NaN;
    var y = parseInt(d.YEAR, 10);
    return isNaN(y) ? NaN : y;
  }

  function buildSodUrl(filters, offset, limit, apiKey) {
    var q = 'limit=' + encodeURIComponent(String(limit)) + '&offset=' + encodeURIComponent(String(offset)) +
      '&filters=' + encodeURIComponent(filters);
    if (apiKey && String(apiKey).trim()) {
      q += '&api_key=' + encodeURIComponent(String(apiKey).trim());
    }
    return SOD_BASE + '?' + q;
  }

  /**
   * Fetch all SOD rows matching filter (paginated). Returns { rows, totalReported, truncated }.
   */
  function fetchSodByFilter(filters, apiKey) {
    if (!filters) {
      return Promise.reject(new Error('SOD filter is empty'));
    }
    var all = [];
    var totalReported = 0;
    var offset = 0;

    function nextPage() {
      var url = buildSodUrl(filters, offset, PAGE_SIZE, apiKey);
      return fetch(url, { method: 'GET', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('FDIC SOD HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var meta = j.meta || {};
        totalReported = meta.total != null ? Number(meta.total) : totalReported;
        var chunk = j.data || [];
        for (var i = 0; i < chunk.length; i++) {
          all.push(chunk[i]);
        }
        if (chunk.length < PAGE_SIZE) {
          return { rows: all, totalReported: totalReported, truncated: false };
        }
        offset += PAGE_SIZE;
        if (all.length >= MAX_ROWS) {
          return { rows: all, totalReported: totalReported, truncated: true };
        }
        return nextPage();
      });
    }

    return nextPage();
  }

  /**
   * Sum deposits (thousands) and branch row counts by YEAR.
   */
  function aggregateSodByYear(rows) {
    var byYear = {};
    for (var i = 0; i < rows.length; i++) {
      var y = parseYear(rows[i]);
      if (!isFinite(y)) continue;
      if (!byYear[y]) byYear[y] = { year: y, depositsThousands: 0, branchRows: 0 };
      byYear[y].depositsThousands += branchDepositsThousands(rows[i]);
      byYear[y].branchRows += 1;
    }
    var years = Object.keys(byYear).map(function (k) { return byYear[k]; });
    years.sort(function (a, b) { return a.year - b.year; });
    for (var j = 1; j < years.length; j++) {
      var prev = years[j - 1].depositsThousands;
      var cur = years[j].depositsThousands;
      if (prev > 0) {
        years[j].yoyPct = Math.round(((cur - prev) / prev) * 10000) / 100;
      } else {
        years[j].yoyPct = null;
      }
    }
    if (years.length) years[0].yoyPct = null;
    return years;
  }

  LA.tools = LA.tools || {};
  LA.tools.fdicSod = {
    SOD_BASE: SOD_BASE,
    buildSodGeoFilter: buildSodGeoFilter,
    fetchSodByFilter: fetchSodByFilter,
    aggregateSodByYear: aggregateSodByYear,
    branchDepositsThousands: branchDepositsThousands,
    normState: normState,
    normZip: normZip,
    inferUsStateFromZip: inferUsStateFromZip
  };
})(typeof window !== 'undefined' ? window : this);
