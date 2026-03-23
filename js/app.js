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
  var pendingRunAfterLoad = false;
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
        '<div class="agent-actions">' +
          '<button type="button" id="run-btn" class="btn btn-primary">Run research</button>' +
        '</div>';
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
          showDataModal(r.missingTypes || []);
          pendingRunAfterLoad = true;
          if (resultText) resultText.textContent = '';
          if (resultPanel) resultPanel.style.display = 'none';
          return;
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
    if (result && result.error) {
      if (elResult) { elResult.textContent = result.error; elResult.className = 'result-error'; }
    } else if (result && result.summary) {
      if (elResult) elResult.textContent = result.summary;
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
    var preview = '<span class="jt-preview">{ ' + keys.length + ' key' + (keys.length !== 1 ? 's' : '') + ' }</span>';
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
      if (arr[i] && typeof arr[i] === 'object' && arr[i].customerId) {
        itemLabel += arr[i].reference
          ? ' ' + arr[i].reference
          : ' customer ' + arr[i].customerId;
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
      if (noteEl) noteEl.textContent = 'AI Engine not loaded.';
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
    if (noteEl) noteEl.textContent = 'Powered by Copernicus AI — zero dependencies, all processing on your device.';

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
    if (t === 'cd') return 'CD';
    if (t === 'customers') return 'Customer information';
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

    var files = mem.files.slice();
    if (required) {
      files = files.filter(function (f) {
        return f.type && required.indexOf(f.type) !== -1;
      });
      files.sort(function (a, b) {
        return required.indexOf(a.type) - required.indexOf(b.type);
      });
    }

    if (!files.length) {
      var need = required && required.length
        ? required.map(sourceDataTypeLabel).join(', ')
        : 'this agent’s required sources';
      container.innerHTML =
        '<div>Nothing loaded for <strong>' + escapeHtml(need) + '</strong> yet. ' +
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

  function showDataModal(missingTypes) {
    var modal = el('data-modal');
    var typesList = el('modal-types');
    if (!modal || !typesList) return;

    typesList.innerHTML = '';
    var allTypes = ['checking', 'savings', 'cd', 'loans', 'customers'];
    var mem = CSVLoader ? CSVLoader.getInMemoryStore() : null;
    var loadedTypes = {};
    if (mem && mem.files) {
      mem.files.forEach(function (f) { if (f.type) loadedTypes[f.type] = true; });
    }

    allTypes.forEach(function (t) {
      var isMissing = missingTypes.indexOf(t) !== -1;
      var isLoaded = loadedTypes[t];
      if (!isMissing && !isLoaded) return;
      var li = document.createElement('li');
      li.textContent = sourceDataTypeLabel(t) + (isMissing ? '' : ' ✓');
      if (!isMissing) li.className = 'loaded';
      typesList.appendChild(li);
    });

    var msgEl = el('modal-message');
    if (msgEl) {
      msgEl.textContent = missingTypes.length === 1
        ? 'The agent needs ' + missingTypes[0] + ' account data. Select a CSV file below — data stays in memory only.'
        : 'The agent needs banking data that hasn\'t been loaded yet. Select CSV files below — data stays in memory only.';
    }

    modal.classList.add('open');
  }

  function hideDataModal() {
    var modal = el('data-modal');
    if (modal) modal.classList.remove('open');
    pendingRunAfterLoad = false;
  }

  function onModalSelectFiles() {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values';
    input.onchange = function () {
      var files = input.files;
      if (!files || !files.length) return;
      if (!CSVLoader || !CSVLoader.loadFiles) return;

      CSVLoader.loadFiles(files).then(function () {
        hideDataModal();
        updateSourceDataDisplay();
        if (pendingRunAfterLoad) {
          pendingRunAfterLoad = false;
          runAgent();
        }
      }).catch(function (e) {
        alert('Load failed: ' + (e && e.message || e));
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

    checkAIStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
