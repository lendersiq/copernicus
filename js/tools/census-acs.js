/**
 * Census ACS 5-year CBSA profile — via BankersIQ Copernicus proxy.
 *
 * Proxy URL pattern (set by BankersIQ):
 *   https://bankersiq.com/api/copernicus/proxy/
 *     ?_key=KEY&service=census&dataset=2023/acs/acs5
 *     &get=NAME,B01003_001E,...
 *     &for=metropolitan+statistical+area/micropolitan+statistical+area:15540
 *
 * ACS year read from banking.market-vitality.assumptions.censusAcsYear (default '2023').
 * Works on file:// via the proxy; no direct browser calls to api.census.gov.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var PROXY_BASE = 'https://bankersiq.com/api/copernicus/proxy/';

  /**
   * ACS variables fetched for each CBSA:
   *   B01003_001E — Total population
   *   B19013_001E — Median household income ($)
   *   B23025_003E — Civilian labor force (for unemployment rate denominator)
   *   B23025_005E — Unemployed
   *   B25077_001E — Median home value ($)
   */
  var ACS_VARS = 'NAME,B01003_001E,B19013_001E,B23025_003E,B23025_005E,B25077_001E';
  var CBSA_GEO = 'metropolitan+statistical+area/micropolitan+statistical+area';

  var DEFAULT_ACS_YEAR = '2023';

  function getAcsYear() {
    var sk = LA.Skills && LA.Skills.get ? LA.Skills.get('banking.market-vitality') : null;
    var a = sk && sk.assumptions;
    var y = a && a.censusAcsYear;
    return (y && String(y).trim()) ? String(y).trim() : DEFAULT_ACS_YEAR;
  }

  function buildCensusAcsUrl(cbsaCode, apiKey) {
    var year = getAcsYear();
    var sep = PROXY_BASE.indexOf('?') >= 0 ? '&' : '?';
    /*
     * Only the API key is percent-encoded (may contain special chars).
     * dataset, get, and for are passed raw so the proxy receives them
     * in the same format as the Census API expects:
     *   dataset: 2023/acs/acs5  (slashes literal)
     *   get:     NAME,B01003_001E,...  (commas literal)
     *   for:     metropolitan+statistical+area/...:15540  (+  = space)
     */
    return PROXY_BASE + sep +
      '_key=' + encodeURIComponent(String(apiKey).trim()) +
      '&service=census' +
      '&dataset=' + year + '/acs/acs5' +
      '&get=' + ACS_VARS +
      '&for=' + CBSA_GEO + ':' + String(cbsaCode).trim();
  }

  /**
   * Parse Census API array response, with proxy-envelope unwrapping.
   *
   * The BankersIQ proxy may wrap the Census native array in an object.
   * Tried in order:
   *   1. Raw Census array:  [ [headers], [values] ]
   *   2. Wrapped in .data:  { data: [ [headers], [values] ] }
   *   3. Wrapped in .result / .response / .rows (other common shapes)
   *
   * Returns a profile object; nulls for any field that fails to parse.
   */
  function parseCensusAcsResponse(json, acsYear) {
    var rows = json;
    if (!Array.isArray(rows)) {
      /* Try common proxy envelope keys */
      var envKeys = ['data', 'result', 'response', 'rows', 'body'];
      for (var ei = 0; ei < envKeys.length; ei++) {
        if (json && Array.isArray(json[envKeys[ei]])) {
          rows = json[envKeys[ei]];
          break;
        }
      }
    }
    if (!Array.isArray(rows) || rows.length < 2) {
      /* Surface the raw value for easier debugging */
      var raw = '';
      try { raw = JSON.stringify(json).slice(0, 200); } catch (e2) {}
      throw new Error('Unexpected Census ACS proxy response shape — received: ' + raw);
    }
    var headers = rows[0];
    var values  = rows[1];
    if (!Array.isArray(headers) || !Array.isArray(values)) {
      throw new Error('Census ACS response rows are not arrays');
    }

    function getField(name) {
      var idx = headers.indexOf(name);
      if (idx < 0) return null;
      var v = values[idx];
      if (v == null || v === '' || v === '-666666666' || v === '-999999999') return null;
      var n = Number(v);
      return isFinite(n) ? n : null;
    }

    function getStr(name) {
      var idx = headers.indexOf(name);
      if (idx < 0) return null;
      var v = values[idx];
      return (v != null && String(v).trim()) ? String(v).trim() : null;
    }

    var laborForce = getField('B23025_003E');
    var unemployed = getField('B23025_005E');
    var unemploymentRate = (laborForce > 0 && unemployed != null)
      ? Math.round((unemployed / laborForce) * 10000) / 100
      : null;

    return {
      acsYear: acsYear,
      cbsaName: getStr('NAME'),
      population: getField('B01003_001E'),
      medianHouseholdIncome: getField('B19013_001E'),
      laborForce: laborForce,
      unemployed: unemployed,
      unemploymentRate: unemploymentRate,
      medianHomeValue: getField('B25077_001E')
    };
  }

  /**
   * Fetch ACS 5-year profile for a single CBSA code.
   * @param {string} cbsaCode   5-digit CBSA code
   * @param {string} apiKey     BankersIQ API key
   * @returns {Promise<object>} Resolved profile or rejected with Error
   */
  function fetchCbsaAcsProfile(cbsaCode, apiKey) {
    if (!cbsaCode || !String(cbsaCode).trim()) {
      return Promise.reject(new Error('fetchCbsaAcsProfile: cbsaCode required'));
    }
    if (!apiKey || !String(apiKey).trim()) {
      return Promise.reject(new Error('fetchCbsaAcsProfile: BankersIQ API key required'));
    }
    var acsYear = getAcsYear();
    var url = buildCensusAcsUrl(cbsaCode, apiKey);
    return fetch(url, { method: 'GET', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('Census ACS proxy HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      var profile = parseCensusAcsResponse(json, acsYear);
      profile.requestUrl = url.replace(/_key=[^&]+/, '_key=(redacted)');
      return profile;
    });
  }

  LA.tools = LA.tools || {};
  LA.tools.censusAcs = {
    PROXY_BASE: PROXY_BASE,
    ACS_VARS: ACS_VARS,
    getAcsYear: getAcsYear,
    buildCensusAcsUrl: buildCensusAcsUrl,
    fetchCbsaAcsProfile: fetchCbsaAcsProfile
  };
})(typeof window !== 'undefined' ? window : this);
