/**
 * CBSA (metro/micro) helpers: ZIP → CBSA code from static ZCTA5–CBSA data;
 * CBSA title from static `Copernicus.CbsaNameData` (built by scripts/build-zip5-cbsa.py
 * from Census ACS 5-year NAME). No browser calls to api.census.gov — works on file://.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  var ACS_YEAR = '2022';

  function normZip(z) {
    if (z == null) return '';
    var d = String(z).replace(/\D/g, '');
    if (d.length >= 5) return d.slice(0, 5);
    return '';
  }

  /**
   * 5-digit CBSA code from ZIP when `Copernicus.ZipCbsaData` is present
   * (load `js/data/zip5-to-cbsa.js` after `framework.js`).
   */
  function lookupCbsaCodeFromZip(zip) {
    var z = normZip(zip);
    if (z.length !== 5) return '';
    var map = LA.ZipCbsaData;
    if (!map || typeof map !== 'object') return '';
    var c = map[z];
    if (c == null || c === '') return '';
    var s = String(c).trim();
    return /^\d{5}$/.test(s) ? s : '';
  }

  /**
   * Metro/micro title when `Copernicus.CbsaNameData` is present
   * (load `js/data/cbsa-code-to-name.js`).
   */
  function lookupCbsaNameFromData(code) {
    if (!code) return '';
    var map = LA.CbsaNameData;
    if (!map || typeof map !== 'object') return '';
    var n = map[code];
    return n != null && String(n).trim() !== '' ? String(n).trim() : '';
  }

  /**
   * Reverse-lookup: given city + state, scan ZipCityData for matching ZIP codes,
   * then vote on the most common CBSA code among those ZIPs.
   * Returns the winning CBSA code string, or '' if none found.
   * Requires Copernicus.ZipCityData (js/data/zip5-to-city.js) to be loaded.
   */
  function lookupCbsaFromCityState(city, state) {
    var cityNorm  = String(city  || '').trim().toLowerCase();
    var stateNorm = String(state || '').trim().toUpperCase();
    if (!cityNorm || stateNorm.length !== 2) return '';
    var cityMap = LA.ZipCityData;
    if (!cityMap || typeof cityMap !== 'object') return '';

    var votes = {};
    var keys = Object.keys(cityMap);
    for (var i = 0; i < keys.length; i++) {
      var val = cityMap[keys[i]];           // "Austin,TX"
      var sep = val.lastIndexOf(',');
      if (sep < 0) continue;
      var c = val.slice(0, sep).toLowerCase();
      var s = val.slice(sep + 1).toUpperCase();
      if (c !== cityNorm || s !== stateNorm) continue;
      var cbsaCode = lookupCbsaCodeFromZip(keys[i]);
      if (cbsaCode) votes[cbsaCode] = (votes[cbsaCode] || 0) + 1;
    }

    var best = '', bestCount = 0;
    var codes = Object.keys(votes);
    for (var j = 0; j < codes.length; j++) {
      if (votes[codes[j]] > bestCount) { bestCount = votes[codes[j]]; best = codes[j]; }
    }
    return best;
  }

  /**
   * If `result.geo` is ZIP mode, set `result.cbsa` and extend `result.summary` when appropriate.
   * In city_state mode, tries the ZipCityData reverse lookup when available.
   */
  function enrichResultWithCbsa(result) {
    if (!result || !result.geo) return Promise.resolve(result);

    /* ── city+state mode: try reverse lookup via ZipCityData ─── */
    if (result.geo.mode !== 'zip' || !result.geo.zip) {
      var cityCode = '';
      if (result.geo.mode === 'city_state' && result.geo.city && result.geo.state) {
        cityCode = lookupCbsaFromCityState(result.geo.city, result.geo.state);
      }
      if (!cityCode) {
        var hasZipCityData = !!(LA.ZipCityData && typeof LA.ZipCityData === 'object');
        result.cbsa = {
          skipped: true,
          reason: result.geo.mode === 'city_state' && !hasZipCityData
            ? 'CBSA city+state lookup requires zip5-to-city.js to be loaded (run scripts/build-zip5-city.py).'
            : result.geo.mode === 'city_state'
              ? 'No CBSA match found for ' + (result.geo.city || '') + ', ' + (result.geo.state || '') + '. Try entering a 5-digit ZIP instead.'
              : 'CBSA lookup requires a ZIP code or city+state; enter a 5-digit ZIP to enable metro-area demographic data.'
        };
        return Promise.resolve(result);
      }
      /* city+state resolved to a CBSA — continue as if ZIP mode found it */
      var cityName = lookupCbsaNameFromData(cityCode);
      var hasMap   = !!(LA.CbsaNameData && typeof LA.CbsaNameData === 'object');
      result.cbsa = {
        code: cityCode,
        name: cityName || null,
        resolvedFrom: 'city_state',
        crosswalk: 'ZipCityData reverse lookup → ZCTA5–CBSA 2010 relationship file (dominant ZPOPPCT)',
        nameSource: cityName
          ? 'static CbsaNameData (ACS ' + ACS_YEAR + ' 5-year NAME, from build-zip5-cbsa.py)'
          : hasMap
            ? 'code not in CbsaNameData — re-run scripts/build-zip5-cbsa.py'
            : 'load js/data/cbsa-code-to-name.js (run scripts/build-zip5-cbsa.py)'
      };
      if (cityName && result.summary) {
        result.summary += ' \u00b7 CBSA ' + cityCode + ': ' + cityName;
      } else if (result.summary) {
        result.summary += ' \u00b7 CBSA code ' + cityCode + ' (title missing)';
      }
      return Promise.resolve(result);
    }

    /* ── ZIP mode ─────────────────────────────────────────────── */
    var code = lookupCbsaCodeFromZip(result.geo.zip);
    if (!code) {
      result.cbsa = {
        skipped: true,
        reason: 'No CBSA mapping for this ZIP (build/load zip5-to-cbsa.js from Census ZCTA5–CBSA 2010 rel file).'
      };
      return Promise.resolve(result);
    }
    var name = lookupCbsaNameFromData(code);
    var hasMap = !!(LA.CbsaNameData && typeof LA.CbsaNameData === 'object');
    result.cbsa = {
      code: code,
      name: name || null,
      acsYear: ACS_YEAR,
      crosswalk: 'U.S. Census Bureau ZCTA5–CBSA relationship file (2010); dominant ZPOPPCT per ZCTA5',
      nameSource: name
        ? 'static CbsaNameData (ACS ' + ACS_YEAR + ' 5-year NAME, from build-zip5-cbsa.py)'
        : hasMap
          ? 'code not in CbsaNameData — re-run scripts/build-zip5-cbsa.py'
          : 'load js/data/cbsa-code-to-name.js (run scripts/build-zip5-cbsa.py)'
    };
    if (name && result.summary) {
      result.summary += ' · CBSA ' + code + ': ' + name;
    } else if (result.summary) {
      result.summary += ' · CBSA code ' + code + ' (metro/micro title missing — load cbsa-code-to-name.js or rebuild)';
    }
    return Promise.resolve(result);
  }

  /**
   * Fetch and attach ACS 5-year demographic profile to result.cbsa.profile.
   * Requires result.cbsa.code (set by enrichResultWithCbsa) and a BankersIQ API key.
   * Gracefully skips when: CBSA code absent, key missing, censusAcs tool not loaded, fetch fails.
   * Never rejects — always resolves with result (profile.skipped or profile.error on failure).
   */
  function attachAcsProfile(result, biqKey) {
    var code = result && result.cbsa && result.cbsa.code;
    if (!code) return Promise.resolve(result);

    var key = biqKey && String(biqKey).trim() ? String(biqKey).trim() : null;
    if (!key) {
      result.cbsa.profile = { skipped: true, reason: 'BankersIQ API key required for Census ACS profile.' };
      return Promise.resolve(result);
    }

    var acsTool = LA.tools && LA.tools.censusAcs;
    if (!acsTool || typeof acsTool.fetchCbsaAcsProfile !== 'function') {
      result.cbsa.profile = { skipped: true, reason: 'census-acs.js not loaded.' };
      return Promise.resolve(result);
    }

    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[Copernicus census-cbsa] Fetching ACS profile for CBSA', code,
        '(key present:', !!key, ')');
    }
    return acsTool.fetchCbsaAcsProfile(code, key).then(function (profile) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Copernicus census-cbsa] ACS profile received for', code, profile);
      }
      result.cbsa.profile = profile;
      return result;
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[Copernicus census-cbsa] ACS profile fetch failed for CBSA', code, '—', msg);
      }
      result.cbsa.profile = {
        error: msg,
        skipped: false
      };
      return result;
    });
  }

  LA.tools = LA.tools || {};
  LA.tools.censusCbsa = {
    ACS_YEAR: ACS_YEAR,
    normZip: normZip,
    lookupCbsaCodeFromZip: lookupCbsaCodeFromZip,
    lookupCbsaNameFromData: lookupCbsaNameFromData,
    lookupCbsaFromCityState: lookupCbsaFromCityState,
    enrichResultWithCbsa: enrichResultWithCbsa,
    attachAcsProfile: attachAcsProfile
  };
})(typeof window !== 'undefined' ? window : this);
