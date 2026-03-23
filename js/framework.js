/**
 * Copernicus — local-first (file://) JS framework for intelligent agents.
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
      try { _ls = typeof localStorage !== 'undefined' && localStorage !== null; localStorage.setItem('__cn_test', '1'); localStorage.removeItem('__cn_test'); } catch (e) { _ls = false; }
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
     * Optional requiredDataTypes: e.g. ['checking'] — UI lists only matching loaded files.
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
      if (!agent || !agent.id) return this;
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

      /* explain(), ask(), isAvailable(), getStatus(), classifyColumns()
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
     *   maturityDate, term, typeCode, ownerCode, rate, raw }.
     */
    Data: {
      state: {
        checking: [],
        savings: [],
        cd: [],
        loans: [],
        customerDirectory: {},
        meta: { files: [] }
      },

      /** Normalize loader rows into canonical Account objects. */
      _normalizeFromLoader: function () {
        var loader = (global.CSVLoader || (global.Copernicus && global.Copernicus.tools && global.Copernicus.tools.CSVLoader));
        if (!loader || !loader.getInMemoryStore) return { ok: false, error: 'CSV loader not available' };
        var mem = loader.getInMemoryStore();
        if (!mem || !mem.files || !mem.files.length) {
          this.state.checking = [];
          this.state.savings = [];
          this.state.cd = [];
          this.state.loans = [];
          this.state.customerDirectory = {};
          this.state.meta = { files: [] };
          return { ok: false, error: 'No CSV data loaded' };
        }

        function customerIdMappedHeader(memStore, sourceFile) {
          if (!sourceFile || !memStore || !memStore.files) return null;
          for (var j = 0; j < memStore.files.length; j++) {
            var f = memStore.files[j];
            if (f.name === sourceFile && f.columnMap && f.columnMap.customerId) {
              return f.columnMap.customerId.header || null;
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
            columnMappedAsCustomerId: customerIdMappedHeader(memStore, src),
            valueFromMappedColumn: row && row.customerId != null && String(row.customerId).trim() !== ''
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
          var term = row.term != null ? row.term : (row.tenor != null ? row.tenor : null);
          var typeCode = row.typeCode || row.accountType || row.product || row.product_type || null;
          var ownerCode = row.ownerCode || row.owner || null;
          var rateNum = loader.inferNumeric ? loader.inferNumeric(row.rate) : parseFloat(row.rate);
          var rate = isNaN(rateNum) || rateNum == null ? 0 : rateNum;
          var isPrimary = loader.isPrimary ? loader.isPrimary(row) : !!row.primary;

          return {
            customerId: String(customerId || '').trim(),
            accountId: row.accountId || row.account_id || row.loan_number || row.contract_id || undefined,
            balance: balance,
            openedAt: openedAt && !isNaN(openedAt.getTime()) ? openedAt : null,
            isPrimary: isPrimary,
            openDate: openStr || '',
            maturityDate: maturityStr || null,
            term: term,
            typeCode: typeCode,
            ownerCode: ownerCode,
            rate: rate,
            productType: productType,
            raw: row._raw || row
          };
        }

        var byType = mem.byType || { checking: [], savings: [], cd: [], loans: [], customers: [] };
        var out = { checking: [], savings: [], cd: [], loans: [] };
        ['checking', 'savings', 'cd', 'loans'].forEach(function (type) {
          var arr = byType[type] || [];
          for (var i = 0; i < arr.length; i++) {
            var row = arr[i];
            var acc = toAccount(row, type);
            if (!acc || isNaN(acc.balance)) continue;

            if (!acc.customerId) {
              console.warn(
                '[Copernicus.Data] Row skipped — no customerId after mapping (check CSV column → customerId)',
                rowCustomerIdLogContext(mem, row, type, i, acc)
              );
              continue;
            }

            if (acc.customerId === '0') {
              console.warn(
                '[Copernicus.Data] Weak customerId "0" — verify the correct column is mapped to customerId',
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
        }
        this.state.customerDirectory = nameMap;

        this.state.meta = { files: (mem.files || []).slice() };
        return { ok: true, state: this.state };
      },

      /**
       * Ensure data for requested types exists. Returns:
       * { ok: true, state } or { ok: false, missingTypes: [...], error? }.
       */
      ensureLoaded: function (needs) {
        needs = needs && needs.length ? needs : ['checking', 'savings', 'cd', 'loans'];
        var loader = (global.CSVLoader || (global.Copernicus && global.Copernicus.tools && global.Copernicus.tools.CSVLoader));
        if (!loader || !loader.getInMemoryStore) {
          return { ok: false, missingTypes: needs.slice(), error: 'CSV loader not available' };
        }
        var mem = loader.getInMemoryStore();
        if (!mem || !mem.files || !mem.files.length) {
          return { ok: false, missingTypes: needs.slice(), error: 'No CSV data loaded' };
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

        return this._normalizeFromLoader();
      },

      /** Get current normalized state (may be empty arrays). */
      getState: function () {
        return this.state;
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
        if (!profile.checking.length && !profile.savings.length && !profile.cd.length && !profile.loans.length) {
          return null;
        }
        return profile;
      }
    }
  };

  global.Copernicus = Copernicus;
})(typeof window !== 'undefined' ? window : this);
