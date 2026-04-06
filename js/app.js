/**
 * Copernicus app — UI controller (file:// only).
 * Dropdown agent selector, collapsible JSON tree, central data modal,
 * AI Insights panel with query input.
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  var CSVLoader = global.CSVLoader;
  if (!LA) return;

  var currentAgentId = '';
  var pendingRunAfterIngest = false;
  var lastResult = null;
  var lastAgentName = '';
  var aiReady = false;

  function el(id) { return document.getElementById(id); }
  function qs(s, root) { return (root || document).querySelector(s); }
  function qsAll(s, root) { return (root || document).querySelectorAll(s); }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* ── Agent dropdown ─────────────────────────────────────────────────── */

  function renderAgentDropdown() {
    var listEl = el('agent-select-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    LA.registry.forEach(function (agent) {
      var item = document.createElement('div');
      item.className = 'agent-dropdown-item';
      item.dataset.agentId = agent.id;
      item.innerHTML =
        '<div class="dd-name">' + escapeHtml(agent.name) + '</div>' +
        '<div class="dd-desc">' + escapeHtml(agent.description) + '</div>';
      item.addEventListener('click', function () {
        selectAgent(agent.id);
        closeDropdown();
      });
      listEl.appendChild(item);
    });
  }

  function openDropdown() {
    var dd = el('agent-select');
    if (dd) dd.classList.add('open');
  }

  function closeDropdown() {
    var dd = el('agent-select');
    if (dd) dd.classList.remove('open');
  }

  function toggleDropdown() {
    var dd = el('agent-select');
    if (dd) dd.classList.toggle('open');
  }

  function selectAgent(agentId) {
    var agent = LA.getAgent(agentId);
    if (!agent) return;
    currentAgentId = agentId;

    var label = el('agent-select-label');
    if (label) label.textContent = agent.name;

    var listEl = el('agent-select-list');
    if (listEl) {
      qsAll('.agent-dropdown-item', listEl).forEach(function (item) {
        item.classList.toggle('active', item.dataset.agentId === agentId);
      });
    }

    var titleEl = el('agent-title');
    var descEl = el('agent-description');
    var panelEl = el('panel-inputs');
    var bodyEl = el('agent-body');
    if (titleEl) titleEl.textContent = agent.name;
    if (descEl) descEl.textContent = agent.description;
    if (panelEl) panelEl.style.display = 'block';
    var resultPanel = el('panel-result');
    if (resultPanel) resultPanel.style.display = 'none';
    var aiPanel = el('panel-ai');
    if (aiPanel) aiPanel.style.display = 'none';

    if (bodyEl) {
      bodyEl.innerHTML =
        '<div class="agent-section">' +
          '<div class="agent-section-title">Source data (in-memory only)</div>' +
          '<div id="source-data-files" class="source-data-list"></div>' +
        '</div>' +
        '<div id="market-vitality-section" class="agent-section" style="display:none;">' +
          '<div class="agent-section-title">Market geography</div>' +
          '<p style="font-size:.82rem;color:var(--muted);margin:0 0 .75rem 0;line-height:1.45;">' +
          '<strong>ZIP</strong> (<code style="font-size:.78rem;">ZIPBR</code> only for SOD), <strong>state</strong> (for city mode <code style="font-size:.78rem;">STALP</code> + FSBI), and <strong>city</strong> (<code style="font-size:.78rem;">CITYBR</code>). If ZIP is filled, FDIC uses that ZIP alone. For U.S. ZIPs, <strong>state is inferred</strong> for FSBI when blank (e.g. 05401 → VT).</p>' +
          '<div style="display:grid;gap:.5rem;grid-template-columns:1fr 1fr;max-width:420px;">' +
          '<label style="font-size:.78rem;color:var(--muted);">ZIP<input type="text" id="mv-zip-input" class="ai-input" maxlength="10" placeholder="78701" autocomplete="postal-code" style="display:block;margin-top:.25rem;width:100%;" /></label>' +
          '<label style="font-size:.78rem;color:var(--muted);">State (2 letters)<input type="text" id="mv-state-input" class="ai-input" maxlength="2" placeholder="TX" autocomplete="address-level1" style="display:block;margin-top:.25rem;width:100%;text-transform:uppercase;" /></label>' +
          '</div>' +
          '<label style="font-size:.78rem;color:var(--muted);display:block;margin-top:.65rem;">City<input type="text" id="mv-city-input" class="ai-input" placeholder="Austin" autocomplete="address-level2" style="display:block;margin-top:.25rem;max-width:420px;width:100%;" /></label>' +
          '<p style="font-size:.78rem;color:var(--muted);margin:.75rem 0 0 0;line-height:1.45;">' +
          'Fiserv Small Business Index (FSBI) is inflation-adjusted by default</p>' +
        '</div>' +
        '<div id="loan-treasury-section" class="agent-section" style="display:none;">' +
          '<div class="agent-section-title">Treasury rates (BankersIQ)</div>' +
          '<p style="font-size:.82rem;color:var(--muted);margin:0 0 .75rem 0;line-height:1.45;">' +
          'Loan spread uses the <strong>BankersIQ</strong> Treasury trates endpoint (<a href="https://bankersiq.com/api/luci/trates/" target="_blank" rel="noopener" style="color:var(--accent);">trates</a>) with your <strong>api_key</strong> (stored only in this browser).' +
          '</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;">' +
          '<input type="password" id="bankersiq-trates-api-key-input" class="ai-input" style="max-width:280px;" placeholder="BankersIQ API key" autocomplete="off" />' +
          '<button type="button" id="bankersiq-trates-api-key-save" class="btn btn-primary">Save key</button>' +
          '</div>' +
          '<div id="bankersiq-trates-key-status" style="font-size:.78rem;margin-top:.3rem;color:var(--muted);"></div>' +
        '</div>' +
        '<div class="agent-actions">' +
          '<button type="button" id="run-btn" class="btn btn-primary">Run research</button>' +
        '</div>';
      var mvSection = el('market-vitality-section');
      if (mvSection) {
        mvSection.style.display = agent.id === 'market-vitality' ? 'block' : 'none';
      }
      var loanTreasury = el('loan-treasury-section');
      if (loanTreasury) {
        loanTreasury.style.display = agent.id === 'loan-profitability' ? 'block' : 'none';
      }
      if (agent.id === 'loan-profitability' && LA.KeyRing && LA.KeyRingIds) {
        LA.KeyRing.get(LA.KeyRingIds.BANKERSIQ_TRATES_API).then(function (k) {
          var st = el('bankersiq-trates-key-status');
          if (st) st.textContent = k ? 'BankersIQ key on file (hidden).' : 'BankersIQ API key required to fetch Treasury rates.';
        });
        var biqSave = el('bankersiq-trates-api-key-save');
        if (biqSave) {
          biqSave.addEventListener('click', function () {
            var inp = el('bankersiq-trates-api-key-input');
            var st = el('bankersiq-trates-key-status');
            var v = inp && inp.value ? inp.value.trim() : '';
            if (!v) {
              if (st) st.textContent = 'Paste your BankersIQ API key to save.';
              return;
            }
            LA.KeyRing.set(LA.KeyRingIds.BANKERSIQ_TRATES_API, v).then(function () {
              if (st) st.textContent = 'Saved.';
              if (inp) inp.value = '';
            });
          });
        }
      }
      updateSourceDataDisplay();
      var runBtn = el('run-btn');
      if (runBtn) runBtn.addEventListener('click', function () { runAgent(); });
    }
  }

  /* ── Run agent ────────────────────────────────────────────────────── */

  function runAgent() {
    var agent = LA.getAgent(currentAgentId);
    if (!agent) return;

    var runBtn = el('run-btn');
    var resultText = el('result-text');
    var resultPanel = el('panel-result');
    if (runBtn) runBtn.disabled = true;
    if (resultText) resultText.textContent = 'Running…';
    if (resultPanel) resultPanel.style.display = 'block';

    var aiPanel = el('panel-ai');
    if (aiPanel) aiPanel.style.display = 'none';

    var outcome = LA.run(agent, {}, {});

    function finish(out) {
      if (runBtn) runBtn.disabled = false;
      if (!out) return;
      if (out.ok) {
        var r = out.result;
        if (r && r.needsData) {
          showDataModal(r.missingTypes || [], agent);
          pendingRunAfterIngest = true;
          if (resultText) resultText.textContent = '';
          if (resultPanel) resultPanel.style.display = 'none';
          return;
        }
        if (r && r.needsBankersIqKey) {
          if (resultPanel) resultPanel.style.display = 'block';
        }
        showResult(r, null);
        lastResult = r;
        lastAgentName = agent.name;
        triggerAIExplain(r, agent.name);
      } else {
        showResult(null, out.error || 'Unknown error');
      }
    }

    if (outcome && typeof outcome.then === 'function') {
      outcome.then(finish).catch(function (e) {
        showResult(null, 'Error: ' + (e && e.message || e));
        if (runBtn) runBtn.disabled = false;
      });
    } else {
      finish(outcome);
    }
  }

  /* ── Result display ───────────────────────────────────────────────── */

  function showResult(result, error) {
    var elResult = el('result-text');
    var elJson = el('result-json');
    if (error) {
      if (elResult) { elResult.textContent = error; elResult.className = 'result-error'; }
      if (elJson) elJson.innerHTML = '';
      return;
    }
    if (elResult) elResult.className = '';
    if (result && result.needsBankersIqKey && result.error) {
      if (elResult) {
        var bq = result.error;
        if (result.riskDisclaimer) bq += '\n\n' + result.riskDisclaimer;
        elResult.textContent = bq;
        elResult.className = '';
      }
    } else if (result && result.error) {
      if (elResult) {
        var errTxt = result.error;
        if (result.disclaimer) errTxt += '\n\n' + result.disclaimer;
        elResult.textContent = errTxt;
        elResult.className = 'result-error';
      }
    } else if (result && result.summary) {
      if (elResult) {
        var head = result.summary;
        if (result.riskDisclaimer) head += '\n\n' + result.riskDisclaimer;
        if (result.disclaimer) head += '\n\n' + result.disclaimer;
        elResult.textContent = head;
      }
    } else if (result && result.customerCount != null) {
      if (elResult) elResult.textContent = 'Processed ' + result.customerCount + ' customers.';
    } else {
      if (elResult) elResult.textContent = 'Done.';
    }
    if (elJson) {
      elJson.innerHTML = '';
      elJson.appendChild(buildJsonTree(result, null, true));
    }
  }

  /* ── JSON tree viewer ────────────────────────────────────────────── */

  var LARGE_ARRAY_THRESHOLD = 5;

  function buildJsonTree(value, key, isRoot) {
    var node = document.createElement('div');
    node.className = 'jt-node' + (isRoot ? ' jt-root' : '');

    if (value === null || value === undefined) {
      node.innerHTML = renderLeafRow(key, '<span class="jt-null">null</span>');
      return node;
    }

    if (Array.isArray(value)) {
      return buildArrayNode(value, key, isRoot, node);
    }

    if (typeof value === 'object') {
      return buildObjectNode(value, key, isRoot, node);
    }

    node.innerHTML = renderLeafRow(key, formatScalar(value));
    return node;
  }

  function buildObjectNode(obj, key, isRoot, node) {
    var keys = Object.keys(obj);
    var collapsed = !isRoot && keys.length > 12;
    node.className += collapsed ? ' jt-collapsed' : ' jt-expanded';

    var row = document.createElement('div');
    row.className = 'jt-row';
    var toggle = '<span class="jt-toggle"></span>';
    var keyHtml = key != null ? '<span class="jt-key">' + escapeHtml(String(key)) + '</span>: ' : '';
    var preview = '<span class="jt-preview" title="Expand to see each field">{ ' + keys.length + ' propert' + (keys.length !== 1 ? 'ies' : 'y') + ' }</span>';
    row.innerHTML = toggle + keyHtml + preview;
    row.querySelector('.jt-toggle').addEventListener('click', function () {
      node.classList.toggle('jt-collapsed');
      node.classList.toggle('jt-expanded');
    });
    node.appendChild(row);

    var children = document.createElement('div');
    children.className = 'jt-children';
    for (var i = 0; i < keys.length; i++) {
      children.appendChild(buildJsonTree(obj[keys[i]], keys[i], false));
    }
    node.appendChild(children);
    return node;
  }

  function buildArrayNode(arr, key, isRoot, node) {
    var collapsed = !isRoot && arr.length > LARGE_ARRAY_THRESHOLD;
    node.className += collapsed ? ' jt-collapsed' : ' jt-expanded';

    var row = document.createElement('div');
    row.className = 'jt-row';
    var toggle = '<span class="jt-toggle"></span>';
    var keyHtml = key != null ? '<span class="jt-key">' + escapeHtml(String(key)) + '</span>: ' : '';
    var preview = '<span class="jt-preview">[ ' + arr.length + ' item' + (arr.length !== 1 ? 's' : '') + ' ]</span>';
    row.innerHTML = toggle + keyHtml + preview;
    row.querySelector('.jt-toggle').addEventListener('click', function () {
      node.classList.toggle('jt-collapsed');
      node.classList.toggle('jt-expanded');
    });
    node.appendChild(row);

    var children = document.createElement('div');
    children.className = 'jt-children';
    for (var i = 0; i < arr.length; i++) {
      var itemLabel = '[' + i + ']';
      var row = arr[i];
      if (row && typeof row === 'object' && row.customerId != null) {
        var cn = row.customerName != null ? String(row.customerName).trim() : '';
        if (cn) {
          itemLabel += ' ' + cn;
          if (row.reference != null && String(row.reference).trim() !== '') {
            itemLabel += ' · ' + String(row.reference).trim();
          }
        } else if (row.reference != null && String(row.reference).trim() !== '') {
          itemLabel += ' ' + String(row.reference).trim();
        } else {
          itemLabel += ' customer ' + row.customerId;
        }
      }
      children.appendChild(buildJsonTree(arr[i], itemLabel, false));
    }
    node.appendChild(children);
    return node;
  }

  function renderLeafRow(key, valueHtml) {
    var indent = '<span class="jt-toggle" style="visibility:hidden"></span>';
    var keyHtml = key != null ? '<span class="jt-key">' + escapeHtml(String(key)) + '</span>: ' : '';
    return '<div class="jt-row">' + indent + keyHtml + valueHtml + '</div>';
  }

  function formatScalar(val) {
    if (typeof val === 'string') return '<span class="jt-string">"' + escapeHtml(val) + '"</span>';
    if (typeof val === 'number') return '<span class="jt-number">' + val + '</span>';
    if (typeof val === 'boolean') return '<span class="jt-bool">' + val + '</span>';
    return '<span class="jt-null">' + escapeHtml(String(val)) + '</span>';
  }

  /* ── AI Insights ─────────────────────────────────────────────────── */

  function checkAIStatus() {
    var badge = el('ai-status');
    LA.AI.getStatus().then(function (status) {
      if (!badge) return;
      if (status.available && status.ready) {
        badge.textContent = status.engine || 'AI Engine ready';
        badge.className = 'ai-badge ready';
        aiReady = true;
      } else {
        badge.textContent = 'unavailable';
        badge.className = 'ai-badge unavailable';
        aiReady = false;
      }
    });
  }

  function triggerAIExplain(result, agentName) {
    var panel = el('panel-ai');
    var explainEl = el('ai-explain');
    var queryInput = el('ai-query-input');
    var queryBtn = el('ai-query-btn');
    var queryResp = el('ai-query-response');
    var noteEl = el('ai-note');

    if (!panel) return;
    panel.style.display = 'block';

    if (queryResp) { queryResp.textContent = ''; queryResp.className = 'ai-content'; }

    if (!aiReady) {
      if (explainEl) { explainEl.textContent = ''; explainEl.className = 'ai-content'; }
      if (noteEl) noteEl.textContent = 'AI Engine not available.';
      if (queryInput) queryInput.disabled = true;
      if (queryBtn) queryBtn.disabled = true;
      return;
    }

    if (explainEl) {
      explainEl.textContent = 'Analyzing results…';
      explainEl.className = 'ai-content loading';
    }
    if (queryInput) queryInput.disabled = true;
    if (queryBtn) queryBtn.disabled = true;
    if (noteEl) noteEl.textContent = 'Powered by Copernicus AI — local agents, local data; processing stays on your device.';

    LA.AI.explain(result, agentName, function onChunk(text) {
      if (explainEl) {
        explainEl.textContent = text;
        explainEl.className = 'ai-content';
      }
    }).then(function (finalText) {
      if (explainEl && finalText) {
        explainEl.textContent = finalText;
        explainEl.className = 'ai-content';
      } else if (explainEl && !finalText) {
        explainEl.textContent = 'AI analysis could not be generated.';
        explainEl.className = 'ai-content loading';
      }
      if (queryInput) queryInput.disabled = false;
      if (queryBtn) queryBtn.disabled = false;
      if (queryInput) queryInput.focus();
    });
  }

  function handleAIQuery() {
    var input = el('ai-query-input');
    var responseEl = el('ai-query-response');
    var queryBtn = el('ai-query-btn');
    if (!input || !responseEl) return;

    var question = input.value.trim();
    if (!question || !lastResult) return;

    input.disabled = true;
    if (queryBtn) queryBtn.disabled = true;
    responseEl.textContent = 'Thinking…';
    responseEl.className = 'ai-content loading';

    LA.AI.ask(question, lastResult, function onChunk(text) {
      responseEl.textContent = text;
      responseEl.className = 'ai-content';
    }).then(function (finalText) {
      if (finalText) {
        responseEl.textContent = finalText;
        responseEl.className = 'ai-content';
      } else {
        responseEl.textContent = 'Could not generate a response.';
        responseEl.className = 'ai-content loading';
      }
      input.disabled = false;
      if (queryBtn) queryBtn.disabled = false;
      input.value = '';
      input.focus();
    });
  }

  /* ── Source data display (files required by current agent) ────────── */

  function sourceDataTypeLabel(t) {
    if (!t) return '—';
    if (t === '__any_csv__') return 'Any CSV';
    if (t === 'cd') return 'CD';
    if (t === 'customers') return 'Customer information';
    if (t === 'mortgages') return 'Mortgage loans';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function updateSourceDataDisplay() {
    var container = el('source-data-files');
    if (!container) return;
    if (!CSVLoader || !CSVLoader.getInMemoryStore) {
      container.innerHTML =
        '<div>No source data in memory. Choose <strong>Run research</strong> to select files.</div>';
      return;
    }
    var mem = CSVLoader.getInMemoryStore();
    if (!mem.files || !mem.files.length) {
      container.innerHTML =
        '<div>No source data in memory. Choose <strong>Run research</strong> to select files.</div>';
      return;
    }

    var agent = LA.getAgent(currentAgentId);
    var required = agent && agent.requiredDataTypes && agent.requiredDataTypes.length
      ? agent.requiredDataTypes
      : null;
    var optional = agent && agent.optionalDataTypes && agent.optionalDataTypes.length
      ? agent.optionalDataTypes
      : [];
    var showTypes = null;
    if (required && required.length) {
      showTypes = required.slice();
      for (var si = 0; si < optional.length; si++) {
        if (showTypes.indexOf(optional[si]) === -1) showTypes.push(optional[si]);
      }
    }

    var files = mem.files.slice();
    if (showTypes) {
      files = files.filter(function (f) {
        return f.type && showTypes.indexOf(f.type) !== -1;
      });
      files.sort(function (a, b) {
        return showTypes.indexOf(a.type) - showTypes.indexOf(b.type);
      });
    }

    if (!files.length) {
      var need = showTypes && showTypes.length
        ? showTypes.map(function (t) {
          var lab = sourceDataTypeLabel(t);
          return optional.indexOf(t) !== -1 ? lab + ' (optional)' : lab;
        }).join(', ')
        : 'this agent’s required sources';
      container.innerHTML =
        '<div>Nothing ingested for <strong>' + escapeHtml(need) + '</strong> yet. ' +
        'Choose <strong>Run research</strong> to add files. (Other files may be in memory but are not shown here.)</div>';
      return;
    }

    var html = '';
    files.forEach(function (f) {
      var status = f.rowCount > 0
        ? '<span style="color:var(--success);">' + f.rowCount + ' rows</span>'
        : '<span style="color:var(--error);">0 rows</span>';
      html += '<div><strong>' + escapeHtml(f.name) + '</strong> — ' +
        escapeHtml(sourceDataTypeLabel(f.type)) + ' · ' + status + '</div>';
    });
    container.innerHTML = html;
  }

  /* ── Data modal ───────────────────────────────────────────────────── */

  var OPTIONAL_SOURCE_HINTS = {
    mortgages: 'Adds mortgage rows to spread results when present.',
    customers: 'Joins names from your directory when relationship ids match loan rows (or any matching cell).',
    savings: 'Optional for some workflows.',
    cd: 'Optional for some workflows.',
    checking: 'Optional for some workflows.'
  };

  function showDataModal(missingTypes, agent) {
    var modal = el('data-modal');
    var typesList = el('modal-types');
    var optBlock = el('modal-optional-block');
    var optList = el('modal-optional-types');
    if (!modal || !typesList) return;

    typesList.innerHTML = '';
    if (optList) optList.innerHTML = '';
    if (optBlock) optBlock.style.display = 'none';
    var msgEl = el('modal-message');

    if (missingTypes.length === 1 && missingTypes[0] === '__any_csv__') {
      var liAny = document.createElement('li');
      liAny.textContent = 'One or more banking CSVs (checking, loans, customers, …)';
      typesList.appendChild(liAny);
      if (msgEl) {
        msgEl.textContent = 'Select one or more CSV files. Any supported type is fine — data stays in memory only. Then the run will continue automatically.';
      }
      modal.classList.add('open');
      return;
    }

    var allTypes = ['checking', 'savings', 'cd', 'loans', 'mortgages', 'customers'];
    var mem = CSVLoader ? CSVLoader.getInMemoryStore() : null;
    var ingestedTypes = {};
    if (mem && mem.files) {
      mem.files.forEach(function (f) { if (f.type) ingestedTypes[f.type] = true; });
    }

    allTypes.forEach(function (t) {
      var isMissing = missingTypes.indexOf(t) !== -1;
      var isIngested = ingestedTypes[t];
      if (!isMissing && !isIngested) return;
      var li = document.createElement('li');
      li.textContent = sourceDataTypeLabel(t) + (isMissing ? '' : ' ✓');
      if (!isMissing) li.className = 'loaded';
      typesList.appendChild(li);
    });

    if (msgEl) {
      msgEl.textContent = missingTypes.length === 1
        ? 'The agent needs ' + sourceDataTypeLabel(missingTypes[0]) + ' data. Select a CSV file below — data stays in memory only.'
        : 'The agent needs banking data that hasn\'t been ingested yet. Select CSV files below — data stays in memory only.';
    }

    var optionalTypes = agent && agent.optionalDataTypes && agent.optionalDataTypes.length
      ? agent.optionalDataTypes
      : [];
    if (optBlock && optList && optionalTypes.length) {
      optBlock.style.display = 'block';
      for (var oi = 0; oi < optionalTypes.length; oi++) {
        var ot = optionalTypes[oi];
        if (missingTypes.indexOf(ot) !== -1) continue;
        var oli = document.createElement('li');
        var lab = sourceDataTypeLabel(ot);
        var hint = OPTIONAL_SOURCE_HINTS[ot] || 'You may add this file to enrich results.';
        oli.innerHTML = '<strong>' + escapeHtml(lab) + '</strong> <span class="modal-optional-tag">optional</span> — ' +
          escapeHtml(hint);
        if (ingestedTypes[ot]) {
          oli.className = 'loaded';
          oli.innerHTML += ' <span class="modal-ingested">(ingested)</span>';
        }
        optList.appendChild(oli);
      }
      if (!optList.children.length) optBlock.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function hideDataModal() {
    var modal = el('data-modal');
    if (modal) modal.classList.remove('open');
    pendingRunAfterIngest = false;
  }

  function onModalSelectFiles() {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values';
    input.onchange = function () {
      var files = input.files;
      if (!files || !files.length) return;
      if (!CSVLoader || !CSVLoader.ingestFiles) return;

      CSVLoader.ingestFiles(files).then(function () {
        hideDataModal();
        updateSourceDataDisplay();
        if (pendingRunAfterIngest) {
          pendingRunAfterIngest = false;
          runAgent();
        }
      }).catch(function (e) {
        alert('Ingestion failed: ' + (e && e.message || e));
      });
    };
    input.click();
  }

  /* ── Init ──────────────────────────────────────────────────────────── */

  function init() {
    renderAgentDropdown();

    var toggleBtn = el('agent-select-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleDropdown);

    if (LA.registry.length > 0) {
      selectAgent(LA.registry[0].id);
    }

    var selectBtn = el('modal-select-btn');
    var cancelBtn = el('modal-cancel-btn');
    if (selectBtn) selectBtn.addEventListener('click', onModalSelectFiles);
    if (cancelBtn) cancelBtn.addEventListener('click', hideDataModal);

    var queryBtn = el('ai-query-btn');
    var queryInput = el('ai-query-input');
    if (queryBtn) queryBtn.addEventListener('click', handleAIQuery);
    if (queryInput) queryInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAIQuery(); }
    });

    if (LA.Soul && typeof LA.Soul.load === 'function') {
      LA.Soul.load();
    }

    checkAIStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
