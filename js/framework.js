/**
 * Copernicus — local-first (file://) JS framework for intelligent agents. Local agents, local data.
 * No servers, no Node; runs entirely in the browser.
 * Your data. Your center.
 */
(function (global) {
  'use strict';

  var Copernicus = {
    version: '0.1.0',

    /** In-memory store with optional localStorage (safe for file:// and iframes) */
    Store: (function () {
      var _mem = {};
      var _ls = false;
      try { _ls = typeof localStorage !== 'undefined' && localStorage !== null; localStorage.setItem('__copernicus_test', '1'); localStorage.removeItem('__copernicus_test'); } catch (e) { _ls = false; }
      var prefix = 'copernicus_';
      return {
        prefix: prefix,
        get: function (key) {
          if (_mem[key] !== undefined) { try { return JSON.parse(JSON.stringify(_mem[key])); } catch (e) { return _mem[key]; } }
          if (!_ls) return null;
          try { var raw = localStorage.getItem(prefix + key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
        },
        set: function (key, value) {
          _mem[key] = value;
          if (!_ls) return true;
          try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch (e) { return true; }
        },
        remove: function (key) {
          delete _mem[key];
          if (!_ls) return true;
          try { localStorage.removeItem(prefix + key); return true; } catch (e) { return true; }
        },
        keys: function () {
          var out = Object.keys(_mem);
          if (!_ls) return out;
          try {
            for (var i = 0; i < localStorage.length; i++) {
              var k = localStorage.key(i);
              if (k && k.indexOf(prefix) === 0) {
                var short = k.slice(prefix.length);
                if (out.indexOf(short) === -1) out.push(short);
              }
            }
          } catch (e) { /* ignore */ }
          return out;
        }
      };
    })(),

    /**
     * Base Agent: id, name, description, run(inputs) -> result.
     * Optional requiredDataTypes / optionalDataTypes — UI and ensureIngested (see AGENTS.md).
     */
    Agent: function (spec) {
      var agent = {
        id: spec.id,
        name: spec.name,
        description: spec.description || '',
        run: spec.run || function () { return { error: 'Agent has no run()' }; }
      };
      if (spec.requiredDataTypes && spec.requiredDataTypes.length) {
        agent.requiredDataTypes = spec.requiredDataTypes.slice();
      }
      if (spec.optionalDataTypes && spec.optionalDataTypes.length) {
        agent.optionalDataTypes = spec.optionalDataTypes.slice();
      }
      return agent;
    },

    /**
     * Runner: executes an agent with inputs and optional research context.
     * researchContext = { store: Copernicus.Store, ... } for agents that need data.
     */
    run: function (agent, inputs, researchContext) {
      researchContext = researchContext || {};
      var start = Date.now();
      try {
        var result = agent.run(inputs, researchContext);
        if (result && typeof result.then === 'function') {
          return result.then(function (r) {
            return { ok: true, result: r, durationMs: Date.now() - start };
          }).catch(function (err) {
            return { ok: false, error: String(err && err.message || err), durationMs: Date.now() - start };
          });
        }
        return { ok: true, result: result, durationMs: Date.now() - start };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err), durationMs: Date.now() - start };
      }
    },

    /** Register agents so the app can list and run them */
    registry: [],
    register: function (agent) {
      if (!agent) {
        try { console.error('[Copernicus] register() called with null/undefined agent'); } catch (e) {}
        return this;
      }
      if (!agent.id || typeof agent.id !== 'string') {
        try { console.error('[Copernicus] register(): agent missing string id —', agent); } catch (e) {}
        return this;
      }
      if (!agent.name) {
        try { console.warn('[Copernicus] register(): agent "' + agent.id + '" has no name'); } catch (e) {}
      }
      if (typeof agent.run !== 'function') {
        try { console.error('[Copernicus] register(): agent "' + agent.id + '" has no run() function'); } catch (e) {}
        return this;
      }
      for (var i = 0; i < this.registry.length; i++) {
        if (this.registry[i].id === agent.id) {
          this.registry[i] = agent;
          return this;
        }
      }
      this.registry.push(agent);
      return this;
    },
    getAgent: function (id) {
      for (var i = 0; i < this.registry.length; i++) {
        if (this.registry[i].id === id) return this.registry[i];
      }
      return null;
    },

    /**
     * AI / Inference layer — advanced reasoning and inference (local, no network).
     * Agents use this for segment inference, confidence scoring, and composite metrics.
     */
    AI: {
      inferSegment: function (profile) {
        var seg = Copernicus.Skills.get('banking.segmentation');
        var a = seg ? seg.assumptions : {};
        var depth = profile.depthScore != null ? profile.depthScore : 0;
        var deposits = profile.totalDepositBalance != null ? profile.totalDepositBalance : 0;
        var tenure = profile.tenureYearsMax != null ? profile.tenureYearsMax : 0;
        if (depth >= (a.primaryDepthThreshold || 70) && deposits >= (a.primaryBalanceThreshold || 50000))
          return { segment: 'primary', label: 'Primary relationship', confidence: 0.9 };
        if (depth >= (a.growthDepthThreshold || 50) && (deposits >= (a.growthBalanceThreshold || 20000) || tenure >= (a.growthTenureThreshold || 3)))
          return { segment: 'growth', label: 'Growth', confidence: 0.85 };
        if (depth >= (a.developingDepthThreshold || 30))
          return { segment: 'developing', label: 'Developing', confidence: 0.8 };
        if (deposits > 0) return { segment: 'emerging', label: 'Emerging', confidence: 0.75 };
        return { segment: 'unknown', label: 'Unknown', confidence: 0.5 };
      },
      inferIncomeMultiplier: function (profile, segmentResult) {
        var seg = segmentResult && segmentResult.segment ? segmentResult.segment : 'unknown';
        var tenure = profile.tenureYearsMax != null ? profile.tenureYearsMax : 0;
        if (seg === 'primary' || tenure >= 7) return 1.2;
        if (seg === 'growth' || tenure >= 4) return 1.1;
        if (seg === 'developing') return 1.0;
        return 0.9;
      },
      computeShareOfWallet: function (depthScore, walletSharePct) {
        var sow = Copernicus.Skills.get('banking.share-of-wallet');
        var dw = sow ? (sow.assumptions.depthWeight || 0.5) : 0.5;
        var ww = sow ? (sow.assumptions.walletWeight || 0.5) : 0.5;
        var depthNorm = depthScore != null ? Math.min(100, Math.max(0, depthScore)) : 0;
        var shareNorm = walletSharePct != null ? Math.min(100, Math.max(0, walletSharePct)) : 0;
        return Math.round(((depthNorm * dw) + (shareNorm * ww)) * 100) / 100;
      }

      /* explain(), ask(), isAvailable(), getStatus(), classifyFields()
       * are provided by js/ai-engine.js which overrides these after load. */
    },

    /**
     * Centralized skill library — domain knowledge agents consume at runtime.
     * Skills hold assumptions (configurable), formulas, and AI context.
     * User overrides persist via Store so agents get smarter over time.
     */
    Skills: {
      _registry: {},

      register: function (skill) {
        if (!skill || !skill.id) return;
        this._registry[skill.id] = skill;
      },

      get: function (id) {
        var skill = this._registry[id];
        if (!skill) return null;
        var result = {
          id: skill.id, name: skill.name, domain: skill.domain,
          context: skill.context, sources: skill.sources,
          assumptions: {}, formulas: skill.formulas || {}
        };
        var defaults = skill.assumptions || {};
        for (var k in defaults) result.assumptions[k] = defaults[k];
        var overrides = Copernicus.Store.get('skill_' + id + '_overrides');
        if (overrides) {
          for (var k2 in overrides) result.assumptions[k2] = overrides[k2];
        }
        if (skill.queryContext) {
          result.queryContext = skill.queryContext;
        }
        if (skill.headerSignals) {
          result.headerSignals = skill.headerSignals;
        }
        if (skill.riskDisclaimer != null) {
          result.riskDisclaimer = skill.riskDisclaimer;
        }
        return result;
      },

      getAssumption: function (skillId, key) {
        var skill = this.get(skillId);
        return skill && skill.assumptions ? skill.assumptions[key] : undefined;
      },

      setAssumption: function (skillId, key, value) {
        var overrides = Copernicus.Store.get('skill_' + skillId + '_overrides') || {};
        overrides[key] = value;
        Copernicus.Store.set('skill_' + skillId + '_overrides', overrides);
      },

      resetAssumptions: function (skillId) {
        Copernicus.Store.remove('skill_' + skillId + '_overrides');
      },

      list: function () {
        var out = [];
        for (var id in this._registry) {
          var s = this._registry[id];
          out.push({ id: id, name: s.name, domain: s.domain });
        }
        return out;
      },

      getContext: function (skillIds) {
        var parts = [];
        for (var i = 0; i < skillIds.length; i++) {
          var skill = this.get(skillIds[i]);
          if (skill && skill.context) parts.push(skill.context);
        }
        return parts.join('\n\n');
      }
    },

    /**
     * Central banking data manager — normalized in-memory objects for any agent.
     * Uses CSVLoader (if present) to build canonical Account objects:
     * { customerId, accountId, balance, openedAt, isPrimary, openDate,
     *   maturityDate, maturityAt, term, payment, paymentFrequency, typeCode, ownerCode, rate, raw }.
     */
    Data: {
      state: {
        checking: [],
        savings: [],
        cd: [],
        loans: [],
        mortgages: [],
        customerDirectory: {},
        meta: { files: [] }
      },

      /** Normalize ingested rows into canonical Account objects. */
      _normalizeFromIngestion: function () {
        var loader = (global.CSVLoader || (global.Copernicus && global.Copernicus.tools && global.Copernicus.tools.CSVLoader));
        if (!loader || !loader.getInMemoryStore) return { ok: false, error: 'CSV ingestion path not available' };
        var mem = loader.getInMemoryStore();
        if (!mem || !mem.files || !mem.files.length) {
          this.state.checking = [];
          this.state.savings = [];
          this.state.cd = [];
          this.state.loans = [];
          this.state.mortgages = [];
          this.state.customerDirectory = {};
          this.state.meta = { files: [] };
          return { ok: false, error: 'No CSV data ingested' };
        }

        function customerIdMappedHeader(memStore, sourceFile) {
          if (!sourceFile || !memStore || !memStore.files) return null;
          for (var j = 0; j < memStore.files.length; j++) {
            var f = memStore.files[j];
            if (f.name === sourceFile && f.fieldMap && f.fieldMap.customerId) {
              return f.fieldMap.customerId.header || null;
            }
          }
          return null;
        }

        function rowCustomerIdLogContext(memStore, row, productType, rowIndex, acc) {
          var raw = row && row._raw;
          var cells = Array.isArray(raw)
            ? raw.slice(0, 10).map(function (c) {
              return c == null ? '' : String(c).slice(0, 48);
            })
            : null;
          var src = row && row._sourceFile ? row._sourceFile : null;
          return {
            productType: productType,
            rowIndexInProduct: rowIndex,
            sourceFile: src,
            fieldMappedAsCustomerId: customerIdMappedHeader(memStore, src),
            valueFromMappedField: row && row.customerId != null && String(row.customerId).trim() !== ''
              ? String(row.customerId)
              : '(empty / unmapped)',
            normalizedCustomerId: acc ? acc.customerId : null,
            accountId: acc && acc.accountId != null ? acc.accountId : null,
            balance: acc && typeof acc.balance === 'number' ? acc.balance : null,
            rawCellsPreview: cells
          };
        }

        function toAccount(row, productType) {
          if (!row) return null;
          var customerId = loader.getNormalizedCustomerId ? loader.getNormalizedCustomerId(row.customerId) : (row.customerId || '');
          var balance = loader.getBalance ? loader.getBalance(row) : (Number(row.balance) || 0);
          var openStr = row.dateOpened || row.openDate || '';
          var openedAt = loader.inferDate ? loader.inferDate(openStr) : (openStr ? new Date(openStr) : null);
          var maturityStr = row.maturityDate || row.maturity || '';
          var maturityAt = loader.inferDate ? loader.inferDate(maturityStr) : null;
          if (maturityAt && isNaN(maturityAt.getTime())) maturityAt = null;
          var term = row.term != null ? row.term : (row.tenor != null ? row.tenor : null);
          var typeCode = row.typeCode || row.accountType || row.product || row.product_type || null;
          var ownerCode = row.ownerCode || row.owner || null;
          var rateNum = loader.inferNumeric ? loader.inferNumeric(row.rate) : parseFloat(row.rate);
          var rate = isNaN(rateNum) || rateNum == null ? 0 : rateNum;
          var isPrimary = loader.isPrimary ? loader.isPrimary(row) : !!row.primary;
          var payRaw = row.payment != null ? row.payment : row.paymentAmount;
          var payNum = loader.inferNumeric ? loader.inferNumeric(payRaw) : parseFloat(String(payRaw || '').replace(/[$,]/g, ''));
          var payment = payRaw != null && payRaw !== '' && !isNaN(payNum) && isFinite(payNum) ? payNum : null;
          var payFreq = row.paymentFrequency != null && String(row.paymentFrequency).trim() !== ''
            ? String(row.paymentFrequency).trim()
            : null;

          return {
            customerId: String(customerId || '').trim(),
            accountId: row.accountId || row.account_id || row.loan_number || row.contract_id || undefined,
            balance: balance,
            openedAt: openedAt && !isNaN(openedAt.getTime()) ? openedAt : null,
            isPrimary: isPrimary,
            openDate: openStr || '',
            maturityDate: maturityStr || null,
            maturityAt: maturityAt,
            term: term,
            payment: payment,
            paymentFrequency: payFreq,
            typeCode: typeCode,
            ownerCode: ownerCode,
            rate: rate,
            productType: productType,
            raw: row._raw || row
          };
        }

        var byType = mem.byType || { checking: [], savings: [], cd: [], loans: [], mortgages: [], customers: [] };
        var out = { checking: [], savings: [], cd: [], loans: [], mortgages: [] };
        ['checking', 'savings', 'cd', 'loans', 'mortgages'].forEach(function (type) {
          var arr = byType[type] || [];
          for (var i = 0; i < arr.length; i++) {
            var row = arr[i];
            var acc = toAccount(row, type);
            if (!acc || isNaN(acc.balance)) continue;

            if (!acc.customerId) {
              console.warn(
                '[Copernicus.Data] Row skipped — no customerId after mapping (check CSV field → customerId)',
                rowCustomerIdLogContext(mem, row, type, i, acc)
              );
              continue;
            }

            if (acc.customerId === '0') {
              console.warn(
                '[Copernicus.Data] Weak customerId "0" — verify the correct field is mapped to customerId',
                rowCustomerIdLogContext(mem, row, type, i, acc)
              );
            }

            out[type].push(acc);
          }
        });

        this.state.checking = out.checking;
        this.state.savings = out.savings;
        this.state.cd = out.cd;
        this.state.loans = out.loans;
        this.state.mortgages = out.mortgages;

        var nameMap = {};
        var crows = byType.customers || [];
        for (var cn = 0; cn < crows.length; cn++) {
          var crow = crows[cn];
          var rawCid = loader.getNormalizedCustomerId
            ? loader.getNormalizedCustomerId(crow.customerId)
            : (crow.customerId || '');
          var cidKey = String(rawCid || '').trim();
          if (!cidKey) continue;
          var disp = crow.customerName != null ? String(crow.customerName).trim() : '';
          if (!disp) continue;
          if (!nameMap[cidKey]) nameMap[cidKey] = disp;
          var cidNum = Number(cidKey.replace(/,/g, ''));
          if (!isNaN(cidNum) && isFinite(cidNum) && Math.abs(cidNum) < 1e15) {
            var cidCanon = String(Math.round(cidNum));
            if (cidCanon !== cidKey && nameMap[cidCanon] == null) nameMap[cidCanon] = disp;
          }
        }
        this.state.customerDirectory = nameMap;

        var accountCustIds = {};
        ['checking', 'savings', 'cd', 'loans', 'mortgages'].forEach(function (t) {
          var arr = out[t] || [];
          for (var ai = 0; ai < arr.length; ai++) {
            var id = arr[ai].customerId;
            if (id) accountCustIds[id] = true;
          }
        });
        var acctKeys = Object.keys(accountCustIds);
        var matchedToDirectory = 0;
        for (var mi = 0; mi < acctKeys.length; mi++) {
          if (nameMap[acctKeys[mi]] != null) matchedToDirectory++;
        }
        var dirKeys = Object.keys(nameMap);
        var hasCustomerFile = (mem.files || []).some(function (f) { return f.type === 'customers'; });
        var joinHealth = {
          customerFileRowCount: crows.length,
          directoryEntries: dirKeys.length,
          distinctAccountCustomerIds: acctKeys.length,
          accountIdsMatchedInDirectory: matchedToDirectory,
          matchRate:
            acctKeys.length > 0 ? Math.round((matchedToDirectory / acctKeys.length) * 1000) / 1000 : null
        };

        this.state.meta = { files: (mem.files || []).slice(), customerDirectoryJoin: joinHealth };

        try {
          if (hasCustomerFile && crows.length > 0 && joinHealth.directoryEntries === 0) {
            console.warn(
              '[Copernicus.Data] Customer information file ingested but no directory entries (check customerId + name fields mapped).',
              joinHealth
            );
          } else if (
            hasCustomerFile &&
            joinHealth.directoryEntries > 0 &&
            joinHealth.distinctAccountCustomerIds > 0 &&
            joinHealth.matchRate !== null &&
            joinHealth.matchRate < 0.15
          ) {
            console.warn(
              '[Copernicus.Data] Very few account customerIds match the customer directory keys — IDs may use different fields, formatting, or the wrong file was classified as Customer information.',
              joinHealth
            );
          }
        } catch (eLog) { /* ignore */ }

        return { ok: true, state: this.state };
      },

      /**
       * Ensure data for requested types exists. Returns:
       * { ok: true, state, optionalDataPresent? } or { ok: false, missingTypes: [...], error? }.
       * options.optionalTypes — file types that may be absent; reported in optionalDataPresent.
       */
      ensureIngested: function (needs, options) {
        needs = needs && needs.length ? needs : ['checking', 'savings', 'cd', 'loans'];
        options = options || {};
        var optionalTypes = options.optionalTypes || [];
        var loader = (global.CSVLoader || (global.Copernicus && global.Copernicus.tools && global.Copernicus.tools.CSVLoader));
        if (!loader || !loader.getInMemoryStore) {
          return { ok: false, missingTypes: needs.slice(), error: 'CSV ingestion path not available' };
        }
        var mem = loader.getInMemoryStore();
        if (!mem || !mem.files || !mem.files.length) {
          return { ok: false, missingTypes: needs.slice(), error: 'No CSV data ingested' };
        }

        var missing = [];
        var byType = mem.byType || {};
        for (var i = 0; i < needs.length; i++) {
          var t = needs[i];
          var arr = byType[t] || [];
          if (!arr.length) missing.push(t);
        }
        if (missing.length) {
          return { ok: false, missingTypes: missing };
        }

        var optionalDataPresent = {};
        for (var oi = 0; oi < optionalTypes.length; oi++) {
          var ot = optionalTypes[oi];
          optionalDataPresent[ot] = ((byType[ot] || []).length > 0);
        }

        var norm = this._normalizeFromIngestion();
        if (!norm.ok) return norm;
        return { ok: true, state: this.state, optionalDataPresent: optionalDataPresent };
      },

      /** Get current normalized state (may be empty arrays). */
      getState: function () {
        return this.state;
      },

      /** Compact file list for agent results (name, type, row count). */
      summarizeIngestedFiles: function (stateOpt) {
        var s = stateOpt || this.state;
        var files = s && s.meta && s.meta.files;
        if (!Array.isArray(files)) return [];
        return files.map(function (f) {
          return { name: f.name, type: f.type, rows: f.rowCount };
        });
      },

      /** Aggregate view per customer from normalized accounts. */
      getCustomerProfile: function (customerId) {
        var cid = String(customerId || '').trim();
        if (!cid) return null;
        var s = this.state;
        var profile = {
          customerId: cid,
          checking: [],
          savings: [],
          cd: [],
          loans: [],
          totalDeposits: 0,
          totalLoans: 0,
          tenureYearsMax: null
        };
        function collect(arr, bucket, isLoan) {
          for (var i = 0; i < arr.length; i++) {
            var a = arr[i];
            if (String(a.customerId || '').trim() !== cid) continue;
            profile[bucket].push(a);
            if (isLoan) profile.totalLoans += a.balance;
            else profile.totalDeposits += a.balance;
            if (a.openedAt instanceof Date && !isNaN(a.openedAt.getTime())) {
              var years = (Date.now() - a.openedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
              if (profile.tenureYearsMax == null || years > profile.tenureYearsMax) {
                profile.tenureYearsMax = years;
              }
            }
          }
        }
        collect(s.checking, 'checking', false);
        collect(s.savings, 'savings', false);
        collect(s.cd, 'cd', false);
        collect(s.loans, 'loans', true);
        collect(s.mortgages || [], 'loans', true);
        if (!profile.checking.length && !profile.savings.length && !profile.cd.length && !profile.loans.length) {
          return null;
        }
        return profile;
      }
    }
  };

  global.Copernicus = Copernicus;
})(typeof window !== 'undefined' ? window : this);
