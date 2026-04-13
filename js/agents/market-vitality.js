/**
 * Market vitality — FDIC SOD by ZIP or city+state; FSBI statewide series (one API call per state).
 * Deposits summed in $ thousands (DEPSUMBR); YoY on consecutive filing years.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  var DISCLAIMER =
    'Illustrative only: FDIC SOD branch deposits (June 30) and optional Fiserv Small Business Index (FSBI) via BankersIQ. ' +
    'Not a market recommendation or regulatory view. ZIP = ZIPBR; city = CITYBR. FSBI is often **state-level**; city-level series are uncommon. ' +
    'When you enter a ZIP, CBSA is from the Census **2010** ZCTA5–CBSA relationship (dominant population share); metro/micro **title** from static **cbsa-code-to-name.js** (ACS 5-year NAME, built offline by `scripts/build-zip5-cbsa.py`). City+state without ZIP does not resolve to CBSA here. ' +
    'CORS: api.fdic.gov and bankersiq.com must be reachable from the browser for those APIs (use http(s) if file:// fails for them).';

  function formatBillionsFromThousands(thousands) {
    var b = Number(thousands) / 1000000;
    if (!isFinite(b)) return '0';
    var s = (Math.round(b * 1000) / 1000).toFixed(3);
    s = s.replace(/\.?0+$/, '');
    return s || '0';
  }

  function readLocationInputs() {
    var cityEl = global.document.getElementById('mv-city-input');
    var stateEl = global.document.getElementById('mv-state-input');
    var zipEl = global.document.getElementById('mv-zip-input');
    return {
      city: cityEl && cityEl.value ? cityEl.value.trim() : '',
      state: stateEl && stateEl.value ? stateEl.value.trim() : '',
      zip: zipEl && zipEl.value ? zipEl.value.trim() : ''
    };
  }

  /**
   * FSBI: one BankersIQ call per state (full ALL/ALL time series); AI engine picks inflationAdjusted only.
   */
  function attachFsbiTrend(baseResult, state2, geo, depositTrend, biqKey) {
    var fsbiTool = LA.tools && LA.tools.fsbi;
    if (!fsbiTool || typeof fsbiTool.fetchFsbi !== 'function') {
      baseResult.fsbi = { skipped: true, reason: 'fsbi-client not loaded' };
      return Promise.resolve(baseResult);
    }
    if (!state2) {
      baseResult.fsbi = {
        skipped: true,
        reason: 'Could not determine a 2-letter state for FSBI — enter state, use city + state, or use a U.S. ZIP (state is inferred from ZIP when zip5-to-state.js is loaded).'
      };
      return Promise.resolve(baseResult);
    }
    var planFn = LA.AI && typeof LA.AI.selectFsbiPlan === 'function' ? LA.AI.selectFsbiPlan : null;
    if (!planFn) {
      baseResult.fsbi = { skipped: true, reason: 'AI engine selectFsbiPlan not available' };
      return Promise.resolve(baseResult);
    }
    var plan = planFn(geo, depositTrend);
    return fsbiTool.fetchFsbi({
      state: state2,
      inflationAdjusted: !!plan.inflationAdjusted,
      apiKey: biqKey || undefined
    }).then(function (pack) {
      var rows = pack.data || [];
      var series = typeof fsbiTool.sortAndFilterStatewideSeries === 'function'
        ? fsbiTool.sortAndFilterStatewideSeries(rows)
        : rows;
      baseResult.fsbi = {
        plan: plan,
        meta: pack.meta || {},
        data: rows,
        series: series,
        requestSummary: pack.requestUrl
      };
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Copernicus market-vitality] FSBI:', {
          state: state2,
          inflationAdjusted: !!plan.inflationAdjusted,
          rowCount: rows.length,
          url: pack.requestUrl && pack.requestUrl.replace(/api_key=[^&]+/, 'api_key=(redacted)')
        });
      }
      if (!rows.length) {
        baseResult.fsbi.note = 'BankersIQ returned an empty data[] for this FSBI request.';
      }
      var newest = series.length ? series[series.length - 1] : null;
      if (newest && baseResult.summary) {
        var yoyS = newest.salesYoyPctSa != null ? newest.salesYoyPctSa : newest.salesYoyPctNsa;
        var yoyT = newest.transactionYoyPctSa != null ? newest.transactionYoyPctSa : newest.transactionYoyPctNsa;
        var scope = (newest.subSectorName === 'ALL' && newest.sectorName === 'ALL')
          ? 'statewide ALL'
          : String(newest.subSectorName || 'series');
        if (yoyS != null || yoyT != null) {
          baseResult.summary += ' · FSBI (' + scope + ', ' + state2 + '): ' + series.length + ' month(s), latest ' +
            newest.period + ' — sales YoY ' + (yoyS != null ? yoyS + '%' : 'n/a') +
            ', transactions YoY ' + (yoyT != null ? yoyT + '%' : 'n/a');
        } else {
          baseResult.summary += ' · FSBI: ' + series.length + ' month(s) in series (' + state2 + ').';
        }
      }
      return baseResult;
    }).catch(function (e) {
      baseResult.fsbi = {
        error: String(e && e.message || e),
        plan: plan,
        skipped: false
      };
      baseResult.summary += ' · FSBI request failed (see fsbi.error).';
      return baseResult;
    });
  }

  var agent = LA.Agent({
    id: 'market-vitality',
    name: 'Market vitality',
    description: 'Obervations powered by FDIC Summary of Deposits API plus **FSBI** API courtesy of [BankersIQ](https://bankersiq.com/api/FSBI/)',
    run: function () {
      var sod = LA.tools && LA.tools.fdicSod;
      if (!sod || typeof sod.buildSodGeoFilter !== 'function') {
        return { error: 'FDIC SOD tools not loaded (fdic-sod.js).' };
      }

      var loc = readLocationInputs();
      var st = sod.normState(loc.state);
      var zip = sod.normZip(loc.zip);
      var city = loc.city;
      var stateInferredFromZip = false;
      if (!st && zip && typeof sod.inferUsStateFromZip === 'function') {
        var inferred = sod.inferUsStateFromZip(zip);
        if (inferred) {
          st = inferred;
          stateInferredFromZip = true;
        }
      }

      if (!zip && (!city || !st)) {
        return {
          error: 'Enter a 5-digit ZIP, or city plus 2-letter state (e.g. Austin / TX). ZIP is used when both are provided.'
        };
      }

      var filter = sod.buildSodGeoFilter({ zip: zip, city: city, state: st });
      if (!filter) {
        return { error: 'Could not build a geographic filter — check city and state or ZIP.' };
      }

      var pBiq = LA.KeyRing && LA.KeyRingIds && LA.KeyRing.get
        ? LA.KeyRing.get(LA.KeyRingIds.BANKERSIQ_TRATES_API)
        : Promise.resolve(null);

      return pBiq.then(function (biqKey) {
        return sod.fetchSodByFilter(filter, null).then(function (pack) {
          var years = sod.aggregateSodByYear(pack.rows);
          var last = years.length ? years[years.length - 1] : null;
          var prev = years.length > 1 ? years[years.length - 2] : null;
          var geoLabel = zip
            ? 'ZIP ' + zip + (st ? ', ' + st : '')
            : city + ', ' + st;

          var summary = pack.rows.length === 0
            ? 'No SOD branch rows for ' + geoLabel + ' — try another spelling, state, or ZIP.'
            : years.length === 0
              ? 'Rows returned but no YEAR totals — check FDIC response.'
              : geoLabel + ' · ' + years.length + ' filing year(s) · latest ' + last.year +
                ': $' + formatBillionsFromThousands(last.depositsThousands) + 'B domestic deposits (branch sum, $000s) · ' +
                (last.yoyPct != null ? 'YoY vs ' + prev.year + ': ' + (last.yoyPct >= 0 ? '+' : '') + last.yoyPct + '%' : 'YoY n/a');

          if (pack.truncated) {
            summary += ' · (results capped at ' + pack.rows.length + ' rows — refine geography)';
          }

          var mvSkill = LA.Skills && LA.Skills.get ? LA.Skills.get('banking.market-vitality') : null;

          var out = {
            summary: summary,
            disclaimer: DISCLAIMER,
            skills: { marketVitality: mvSkill && mvSkill.assumptions ? mvSkill.assumptions : {} },
            geo: {
              label: geoLabel,
              mode: zip ? 'zip' : 'city_state',
              zip: zip || null,
              city: city || null,
              state: st || null,
              stateInferredFromZip: stateInferredFromZip || undefined,
              sodFilter: filter
            },
            fdic: {
              rowCount: pack.rows.length,
              totalMatchingReported: pack.totalReported,
              truncated: pack.truncated
            },
            depositTrend: years.map(function (y) {
              return {
                year: y.year,
                depositsThousands: Math.round(y.depositsThousands * 100) / 100,
                depositsBillions: Math.round((y.depositsThousands / 1000000) * 10000) / 10000,
                branchRows: y.branchRows,
                yoyPct: y.yoyPct
              };
            }),
            queryContext: {
              rowsKey: 'depositTrend',
              skillId: 'banking.query-context',
              entityLabel: 'Filing year',
              entityPlural: 'filing years',
              idFields: ['year'],
              insightsPrimaryKey: 'yoyPct',
              fieldCatalog: [
                { key: 'year', labels: ['year', 'filing', 'june 30'], fmt: 'int' },
                { key: 'depositsBillions', labels: ['deposits', 'b', 'billions', 'sod'], fmt: 'billions' },
                { key: 'yoyPct', labels: ['growth', 'yoy', 'change', 'percent'], fmt: 'pctPoints' },
                { key: 'salesIndexSa', labels: ['fsbi', 'sales index', 'small business sales'], fmt: 'score' },
                { key: 'salesYoyPctSa', labels: ['fsbi sales yoy', 'small business yoy'], fmt: 'pctPoints' },
                { key: 'transactionYoyPctSa', labels: ['fsbi transaction yoy', 'transaction yoy'], fmt: 'pctPoints' },
                { key: 'medianHouseholdIncome', labels: ['income', 'median income', 'household income', 'hhi'], fmt: 'dollar' },
                { key: 'population', labels: ['population', 'pop', 'residents'], fmt: 'int' },
                { key: 'unemploymentRate', labels: ['unemployment', 'jobless', 'unemployment rate'], fmt: 'pctPoints' },
                { key: 'medianHomeValue', labels: ['home value', 'median home', 'housing', 'home price'], fmt: 'dollar' }
              ]
            }
          };

          var cbsaP =
            LA.tools && LA.tools.censusCbsa && typeof LA.tools.censusCbsa.enrichResultWithCbsa === 'function'
              ? LA.tools.censusCbsa.enrichResultWithCbsa(out)
              : Promise.resolve(out);
          return cbsaP.then(function (withCbsa) {
            return attachFsbiTrend(withCbsa, st, withCbsa.geo, withCbsa.depositTrend, biqKey);
          }).then(function (withFsbi) {
            var cbsaTool = LA.tools && LA.tools.censusCbsa;
            return (cbsaTool && typeof cbsaTool.attachAcsProfile === 'function')
              ? cbsaTool.attachAcsProfile(withFsbi, biqKey)
              : withFsbi;
          });
        });
      }).catch(function (err) {
        var msg = String(err && err.message || err);
        if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
          msg += ' — If you opened this page as file://, try serving the site over http(s), or check browser network/CORS to api.fdic.gov and bankersiq.com.';
        }
        return { error: msg, disclaimer: DISCLAIMER };
      });
    }
  });

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
