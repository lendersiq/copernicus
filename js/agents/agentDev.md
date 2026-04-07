# Building a Copernicus agent (step-by-step)

This guide is for **humans and AI assistants** adding or changing research agents in this repo. It complements the shorter contract in **`AGENTS.md`** at the project root.

---

## 1. Decide what the agent does

- **Inputs:** Which CSV types (or UI-only inputs like ZIP) does it need?
- **Outputs:** What JSON shape should appear under **Result** and in the JSON tree?
- **Ask / AI Insights:** Should users query rows in natural language? If yes, you need a coherent **`queryContext`** (see §6).

Write a one-sentence **outcome** for the agent `description` (what the user gets), not implementation trivia.

---

## 2. Register the agent module

1. Create **`js/agents/<your-agent>.js`** (IIFE, strict mode).
2. Depend on **`global.Copernicus`** (`LA`): exit early if `!LA || !LA.Agent`.
3. Build the spec with **`LA.Agent({ ... })`** and register with **`LA.register(agent)`**.
4. Add a **`<script src="js/agents/<your-agent>.js"></script>`** line in **`index.html`** **after** every script your agent needs:
   - Always after **`framework.js`**, **`skills/banking.js`** (or your domain skills), **`ai-engine.js`**, and any **`js/tools/*`** your agent calls.

Load order matters: tools and skills must exist before the agent runs.

---

## 3. Declare data requirements

Use **`requiredDataTypes`** and **`optionalDataTypes`** on the agent spec.

Inside **`run()`**:

```javascript
var ingest = LA.Data.ensureIngested(['checking'], { optionalTypes: ['mortgages'] });
if (!ingest.ok) {
  return {
    needsData: true,
    missingTypes: ingest.missingTypes,
    error: '…'
  };
}
var state = ingest.state;
var opt = ingest.optionalDataPresent || {};
```

- **`state`** holds normalized arrays: `checking`, `loans`, `customerDirectory`, `meta`, etc.
- Each account-like row is shaped like the contract in **`AGENTS.md`** (`customerId`, `balance`, `rate`, `raw`, …).

If you need a **new CSV file type**, you must extend **`js/tools/csv-loader.js`** and **`js/framework.js`** (`Data._normalizeFromIngestion`) — not only the agent file.

---

## 4. Keep the agent thin: Skills and tools

**Homogeneous pattern:** the agent **orchestrates**; reusable logic lives elsewhere.

| Concern | Where it belongs |
|--------|-------------------|
| Numeric policy (rates, bps, thresholds) | **`LA.Skills.register`** — `assumptions` on a domain skill (e.g. `banking.loan-profitability`) |
| Regulatory / product disclaimers tied to that skill | Same skill object, e.g. **`riskDisclaimer`** string — agent reads `LA.Skills.get(id).riskDisclaimer` into the result |
| CSV header / role discovery | **`js/tools/*`** + skills **`headerSignals`** where applicable |
| Shared transforms (Treasury curve, spread rows, directory name resolution) | **`LA.tools.*`** in **`js/tools/<name>.js`** |
| Repeating result snippets (e.g. ingested file list) | **`LA.Data.summarizeIngestedFiles(state)`** or a small **`LA.tools`** helper |

**Anti-pattern:** long `fieldCatalog` arrays copy-pasted in every banking agent. Prefer extending **`banking.query-context`** in **`skills/banking.js`** once, then set on the agent only:

- **`queryContext.rowsKey`** — property on the result object that holds row arrays (e.g. `customers`, `loanProfitability`).
- **`queryContext.skillId`** — e.g. `'banking.query-context'` so **`mergeQueryContext`** in **`ai-engine.js`** merges the shared catalog.
- **`queryContext.entityLabel` / `entityPlural` / `idFields` / `insightsPrimaryKey`** — override defaults from the skill when your entity is not a generic “Customer”.

Add **new metric keys** (with `labels` for NL) to the **skill** `fieldCatalog` if multiple agents share the same banking domain.

---

## 5. Implement `run()`

- Return a **plain object** for sync work, or a **Promise** for async (APIs, IndexedDB keys). **`Copernicus.run`** already handles Promises.
- Always include a string **`summary`** when the run succeeds — that drives the main result headline.
- Return **`{ error: '…' }`** (or reject) on failure; use domain-specific flags when the UI needs them (e.g. **`needsBankersIqKey`** for loan Treasury).

**Optional:** attach **`ingestedFiles: LA.Data.summarizeIngestedFiles(state)`** for a consistent view of source files (name, type, row count).

---

## 6. `queryContext` and Ask / insights

The AI engine uses **`mergeQueryContext(result)`** to:

1. Load **`queryContext`** from the result.
2. Pull **`fieldCatalog`** (and defaults) from skills referenced by **`skillId`** / **`skillIds`**.
3. Merge any **`fieldCatalog`** on the agent result **last** (only for keys you truly need to override).

**Minimum for NL queries over rows:**

- **`rowsKey`** — must match an array on your result object.
- **`skillId`** — typically **`'banking.query-context'`** for banking agents.
- **`entityLabel`**, **`entityPlural`**, **`idFields`**, **`insightsPrimaryKey`** as needed.

**Insights** (`LA.AI.generateInsights` / Explain) use the same row list and merged catalog.

---

## 7. External APIs and secrets

- Use **`LA.KeyRing.get(LA.KeyRingIds.…)`** (see **`js/tools/key-ring.js`**) for stored keys.
- For Treasury, prefer **`LA.tools.loadTreasuryCurveFromKeyRing()`** (**`fred-client.js`**) so key handling stays in one place.
- Document new key IDs in **`AGENTS.md`** and the skill **`sources`**.

---

## 8. UI and app wiring

**`js/app.js`** drives the dropdown, data modal, and AI panel. You usually **do not** edit it if your agent follows the same patterns as existing ones:

- **`requiredDataTypes` / `optionalDataTypes`** control which sources appear in the modal.
- **`summary`**, **`queryContext`**, **`riskDisclaimer`** are consumed when present.

Smoke-test: select the agent, run with required CSVs, open **Ask**, try a **top N** question if you expose tabular data.

---

## 9. Checklist (copy for PRs)

1. [ ] New **`id`** (kebab-case), clear **`name`**, outcome **`description`**.
2. [ ] **`ensureIngested`** and **`needsData`** handling.
3. [ ] Assumptions / disclaimers on **Skills**, not scattered literals.
4. [ ] Shared math / joins in **`LA.tools`**, not only inside the agent file.
5. [ ] **`queryContext`** with **`rowsKey`** + **`skillId`**; new NL fields added to **`banking.query-context`** (or domain skill) instead of duplicating huge catalogs.
6. [ ] **`index.html`** script tag after dependencies.
7. [ ] New CSV **type** → **csv-loader** + **Data** normalization updated.

---

## 10. Reference implementations

| Agent | File | What to copy |
|-------|------|----------------|
| Thin + Skills + optional API | **`loan-profitability.js`** | `loadTreasuryCurveFromKeyRing`, `buildLoanTreasurySpreadRows` (amortized remaining cash flows; payment + maturity / seasoning), `riskDisclaimer` from skill, minimal `queryContext` |
| Multi-file CSV + discovery | **`checking-profitability.js`** | `discoverCheckingProfitColumns`, aggregation pattern |
| Multi required types | **`share-of-wallet.js`** | `ensureIngested` with several types |
| No CSV, geo + APIs | **`market-vitality.js`** | FDIC + FSBI tools, custom `queryContext` |
| Diagnostic / meta rows | **`field-signal-test.js`** | Different row shape, glossary answers |

For the **loan** stack specifically, see also **`js/tools/fred-client.js`**, **`js/tools/loan-spread.js`**, **`js/tools/customer-directory.js`**, and **`banking.loan-profitability`** / **`banking.query-context`** in **`skills/banking.js`**.
