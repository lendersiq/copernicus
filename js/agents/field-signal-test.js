/**
 * Field signal test — inspect Copernicus CSV field mapping + AI reconciliation per ingested file.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA || !LA.Agent) return;

  /**
   * Shipped with the agent result as `fieldSignalLexicon` so Ask / explain can answer
   * definitional questions (inferred vs ai-engine, anomalies, severity) instead of misfiring
   * on profitability-style drivers.
   */
  var FIELD_SIGNAL_LEXICON =
    '## Field signal test — reading the report\n\n' +
    '**Mappings** — Each line is one CSV field index linked to a role: **account/product** files use roles like customerId, balance, typeCode; **Customer information** (party / directory) files use party roles like customerId, customerName, postalCode, birthYear, genderCode. ' +
    'Open the result JSON `mappings` array for the full list per file.\n\n' +
    '**source: inferred vs ai-engine** — ' +
    '**inferred** means the CSV ingestion path assigned the role using header aliases, semantic tokens, and value-shape scores (greedy grid). ' +
    '**ai-engine** means Copernicus.AI `classifyFields` later adjusted that slot (e.g. repaired customerId, pinned type vs owner codes) when rules fired. ' +
    'If a row has no `source` field in stored data, the UI shows **inferred** as the default label.\n\n' +
    '**Anomalies** — Heuristic checks only (not a second “AI opinion”). Examples: missing customerId or balance, ' +
    'customerId on a risk/rating-style header, implausible id values, low mapping confidence, ' +
    'or the ingestion grid preferring a different role than the one assigned (**grid_disagree**).\n\n' +
    '**severity** — **high** = likely wrong or blocking for downstream agents; **medium** = worth verifying; **low** = informational / tie-break unease.\n\n' +
    '**This screen’s rows** — Each `fieldSignalReports` row is one ingested file: file name, inferred product type, row count, anomaly count, plus nested mappings and anomalies.';

  function fileTypeLabel(t) {
    if (!t || t === 'unknown') return 'unknown';
    if (t === 'cd') return 'CD';
    if (t === 'customers') return 'Customer information';
    if (t === 'mortgages') return 'Mortgage loans';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function sampleRowsForFile(mem, fileName, fileType, maxRows) {
    var cap = maxRows != null ? maxRows : 20;
    var arr = mem.byType && mem.byType[fileType] ? mem.byType[fileType] : [];
    var out = [];
    for (var i = 0; i < arr.length && out.length < cap; i++) {
      if (arr[i]._sourceFile === fileName && arr[i]._raw) out.push(arr[i]._raw);
    }
    return out;
  }

  function mappingRows(fieldMap) {
    var rows = [];
    if (!fieldMap) return rows;
    for (var role in fieldMap) {
      if (!fieldMap[role] || fieldMap[role].index == null) continue;
      var e = fieldMap[role];
      rows.push({
        role: role,
        header: e.header,
        fieldIndex: e.index,
        confidence: e.confidence != null ? e.confidence : null,
        source: e.source || 'inferred'
      });
    }
    rows.sort(function (a, b) { return a.fieldIndex - b.fieldIndex; });
    return rows;
  }

  function collectAnomalies(f, fieldMap, sampleData, loader, AI) {
    var anomalies = [];
    if (f.emptyReason) {
      anomalies.push({ severity: 'high', code: 'empty', text: 'File has no data rows (' + f.emptyReason + ').' });
      return anomalies;
    }
    if (!f.headers || !f.headers.length) {
      anomalies.push({ severity: 'high', code: 'no_headers', text: 'No header row detected.' });
      return anomalies;
    }
    if (f.type === 'unknown') {
      anomalies.push({ severity: 'medium', code: 'unknown_type', text: 'Inferred file type is **unknown** — filename/header signals did not match a known banking template.' });
    }
    if (!fieldMap || !fieldMap.customerId) {
      if (f.type !== 'customers') {
        anomalies.push({ severity: 'medium', code: 'no_customer_id', text: 'No field mapped to **customerId** — relationship joins and directory matching may fail.' });
      }
    } else {
      var h = fieldMap.customerId.header;
      if (AI && typeof AI.isRiskOrRatingLikeCustomerIdHeader === 'function' && AI.isRiskOrRatingLikeCustomerIdHeader(h)) {
        anomalies.push({ severity: 'high', code: 'risk_as_customer', text: '**customerId** is mapped to a risk/rating-style header (' + h + ') — likely wrong; expect Portfolio / CIF / relationship id.' });
      }
      var vals = [];
      for (var ri = 0; ri < sampleData.length; ri++) {
        var idx = fieldMap.customerId.index;
        if (sampleData[ri] && sampleData[ri][idx] != null) vals.push(sampleData[ri][idx]);
      }
      if (AI && typeof AI.isImplausibleCustomerIdValues === 'function' && AI.isImplausibleCustomerIdValues(vals)) {
        anomalies.push({ severity: 'high', code: 'implausible_cid_values', text: '**customerId** field values look like short grade/bucket codes (not stable relationship ids).' });
      }
      if (fieldMap.customerId.confidence != null && fieldMap.customerId.confidence < 4) {
        anomalies.push({ severity: 'low', code: 'low_conf_customer', text: '**customerId** mapping confidence is low (' + fieldMap.customerId.confidence + ').' });
      }
    }
    if (f.type !== 'customers' && fieldMap && fieldMap.balance) {
      if (fieldMap.balance.confidence != null && fieldMap.balance.confidence < 3) {
        anomalies.push({ severity: 'low', code: 'low_conf_balance', text: '**balance** mapping confidence is low (' + fieldMap.balance.confidence + ').' });
      }
    } else if (f.type !== 'customers' && (!fieldMap || !fieldMap.balance)) {
      anomalies.push({ severity: 'medium', code: 'no_balance', text: 'No **balance** field mapped — profitability-style agents may skip rows.' });
    }

    if (loader && typeof loader.buildScoreGrid === 'function' && sampleData.length) {
      try {
        var grid = loader.buildScoreGrid(f.headers, sampleData, f.type);
        for (var role in fieldMap) {
          if (!fieldMap[role] || fieldMap[role].index == null) continue;
          var ci = fieldMap[role].index;
          var assigned = grid[ci] && grid[ci][role] != null ? grid[ci][role] : 0;
          var bestRole = role;
          var best = assigned;
          var roles = (f.type === 'customers' && loader.PARTY_FIELD_ROLES && loader.PARTY_FIELD_ROLES.length)
            ? loader.PARTY_FIELD_ROLES
            : (loader.FIELD_ROLES || []);
          for (var rj = 0; rj < roles.length; rj++) {
            var rr = roles[rj];
            var sc = grid[ci] && grid[ci][rr] != null ? grid[ci][rr] : 0;
            if (sc > best + 0.75) {
              best = sc;
              bestRole = rr;
            }
          }
          if (bestRole !== role && best > assigned + 0.75) {
            anomalies.push({
              severity: 'low',
              code: 'grid_disagree',
              text: 'Field **' + fieldMap[role].header + '** mapped as **' + role + '** but the heuristic grid favors **' + bestRole + '** for that field.'
            });
          }
        }
      } catch (eg) { /* ignore grid diagnostics */ }
    }

    return anomalies;
  }

  function buildAiInsights(reports) {
    var insights = [];
    var high = 0;
    var med = 0;
    for (var i = 0; i < reports.length; i++) {
      var rep = reports[i];
      for (var j = 0; j < rep.anomalies.length; j++) {
        var a = rep.anomalies[j];
        if (a.severity === 'high') high++;
        else if (a.severity === 'medium') med++;
        insights.push({
          priority: a.severity === 'high' ? 9 : a.severity === 'medium' ? 6 : 3,
          text: '[' + rep.fileName + '] ' + a.text
        });
      }
    }
    insights.sort(function (a, b) { return b.priority - a.priority; });
    var top = insights.slice(0, 8);
    if (!top.length) {
      top.push({
        priority: 5,
        text: 'No heuristic anomalies flagged. Review **mappings** and **headers** in the result JSON; use Ask to query file names, types, or anomaly counts.'
      });
    }
    var summaryParts = [];
    summaryParts.push('Field signal audit over ' + reports.length + ' source file' + (reports.length !== 1 ? 's' : '') + '.');
    if (!high && !med) {
      summaryParts.push('No high- or medium-severity anomalies flagged by heuristics; review mappings below and use Ask for details.');
    } else {
      if (high) summaryParts.push(high + ' high-severity issue(s) need review.');
      if (med) summaryParts.push(med + ' medium-severity warning(s).');
    }
    var summary = summaryParts.join(' ');
    return { summary: summary, insights: top, statistics: null };
  }

  var agent = LA.Agent({
    id: 'field-signal-test',
    name: 'Field signal test',
    description: 'Uses **any** CSV already in memory (or prompts you to add files) and shows inferred **field → role** mappings plus Copernicus.AI **insights** (summary and anomalies). Use this to tune field detection for new extracts.',
    run: function () {
      var loader = global.CSVLoader || (LA.tools && LA.tools.CSVLoader);
      if (!loader || !loader.getInMemoryStore) {
        return { error: 'CSV ingestion path not available.' };
      }
      var mem = loader.getInMemoryStore();
      if (!mem || !mem.files || !mem.files.length) {
        return {
          needsData: true,
          missingTypes: ['__any_csv__'],
          error: 'Ingest at least one CSV file to test field mapping.'
        };
      }

      var AI = LA.AI;
      var reports = [];
      for (var fi = 0; fi < mem.files.length; fi++) {
        var f = mem.files[fi];
        var fieldMap = f.fieldMap || {};
        var sampleData = sampleRowsForFile(mem, f.name, f.type, 20);
        var anomalies = collectAnomalies(f, fieldMap, sampleData, loader, AI);
        reports.push({
          fileName: f.name,
          inferredType: f.type,
          inferredTypeLabel: fileTypeLabel(f.type),
          rowCount: f.rowCount,
          delimiter: f.delimiter,
          emptyReason: f.emptyReason || null,
          headers: (f.headers || []).slice(),
          mappings: mappingRows(fieldMap),
          anomalyCount: anomalies.length,
          anomalies: anomalies
        });
      }

      var line = reports.length + ' file' + (reports.length !== 1 ? 's' : '') + ' · ';
      line += reports.map(function (r) {
        return r.fileName + ' → ' + r.inferredTypeLabel + ' (' + r.mappings.length + ' roles)';
      }).join('; ');

      var aiBlock = buildAiInsights(reports);

      return {
        summary: line,
        fieldSignalTest: true,
        fieldSignalLexicon: FIELD_SIGNAL_LEXICON,
        fieldSignalReports: reports,
        fieldSignalTestInsights: aiBlock,
        queryContext: {
          rowsKey: 'fieldSignalReports',
          skillIds: ['banking.query-context', 'banking.field-inference'],
          entityLabel: 'Source file',
          entityPlural: 'source files',
          idFields: ['fileName'],
          insightsPrimaryKey: 'anomalyCount',
          fieldCatalog: [
            { key: 'fileName', labels: ['file', 'source', 'csv', 'name'], fmt: 'text' },
            { key: 'inferredTypeLabel', labels: ['type', 'file type', 'inferred'], fmt: 'text' },
            { key: 'rowCount', labels: ['rows', 'row count'], fmt: 'int' },
            { key: 'anomalyCount', labels: ['anomalies', 'issues', 'warnings'], fmt: 'int' },
            { key: 'emptyReason', labels: ['empty', 'reason'], fmt: 'text' }
          ]
        },
        skills: { fieldSignalTest: { engine: 'csv-loader + Copernicus.AI.classifyFields' } }
      };
    }
  });

  LA.register(agent);
})(typeof window !== 'undefined' ? window : this);
