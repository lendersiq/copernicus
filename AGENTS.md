# Copernicus agents — author’s guide

This document is the **contract** for building agents so humans and tools can add new research agents consistently.

## Architecture (mental model)

| Layer | Role |
|--------|------|
| **`Copernicus.Agent(spec)`** | Factory: `id`, `name`, `description`, `run()`, optional `requiredDataTypes`, `optionalDataTypes`. |
| **`Copernicus.register(agent)`** | Adds the agent to the UI registry. |
| **`Copernicus.Data`** | Normalized accounts from CSV (`checking`, `savings`, `cd`, `loans`, `mortgages`, …) + `customerDirectory` + `meta`. |
| **`Copernicus.Skills.get(id)`** | Domain assumptions, formulas, `queryContext`, `headerSignals`, etc. |
| **`Copernicus.run(agent, inputs, researchContext)`** | Executes `run`; supports **sync or Promise** return values. |
| **`CSVLoader`** | CSV **ingestion** → in-memory `byType[fileType]` rows; file types are strings like `'loans'`, `'mortgages'`. |

Script **load order** (see `index.html`): `framework.js` → `skills/*.js` → `context/*.js` → `ai-engine.js` → tools → **agent scripts** → `app.js`.

## Agent specification (`spec`)

```javascript
Copernicus.register(Copernicus.Agent({
  id: 'my-agent',                    // required, unique, kebab-case
  name: 'Human Name',                // required
  description: 'One paragraph…',     // mission & outcomes; avoid platform boilerplate
  requiredDataTypes: ['loans'],      // optional; blocks run until these types have ≥1 row
  optionalDataTypes: ['mortgages'],  // optional; run proceeds; check ensureIngested optional flags
  run: function (inputs, researchContext) {
    return { summary: '…', … };     // or return Promise.resolve({ … }) for async (e.g. API)
  }
}));
```

### Data ingestion

- **Required only:**  
  `var ingest = Copernicus.Data.ensureIngested(['loans']);`  
  If `!ingest.ok`, return `{ needsData: true, missingTypes: ingest.missingTypes, error: '…' }`.

- **Required + optional:**  
  `var ingest = Copernicus.Data.ensureIngested(['loans'], { optionalTypes: ['mortgages'] });`  
  On success: `ingest.optionalDataPresent.mortgages === true/false`.

- **State:** `Copernicus.Data.getState()` → `loans`, `mortgages`, etc. Each item is a **canonical account**-shaped object (`customerId`, `accountId`, `balance`, `rate`, `term`, `raw`, …).

### Results & UI

- **`summary`** (string): shown in the result panel headline.
- **`needsData` / `missingTypes`**: opens the data modal; user ingests CSVs into memory.
- **`queryContext`**: for **Ask** / insights — `rowsKey`, `skillId`, `entityLabel`, `idFields`, `fieldCatalog` (see `banking.query-context` and existing agents).
- **Errors:** `{ error: '…' }` or thrown errors; framework wraps async failures.

### Async agents

Use **`return Promise.resolve(…)`** or **`return fetch(…).then(…)`** when calling external APIs (e.g. BankersIQ). `Copernicus.run` already unwraps Promises.

### Treasury curve (interest-rate risk)

**`js/tools/fred-client.js`** fetches the monthly curve only from **[BankersIQ trates](https://bankersiq.com/api/luci/trates/)** (vendor URL path `/api/luci/trates/`) with **`api_key`** (CORS-friendly JSON). The key is read from **`Copernicus.KeyRing`** (`KeyRingIds.BANKERSIQ_TRATES_API` → stored id `bankersiq_luci_api`). Override base URL (no query string): **`Copernicus.Fred.bankersIqTratesUrl`**.

If the BankersIQ key is missing, the loan agent returns **`needsBankersIqKey`**. There is **no** FRED or other Treasury fallback — **no** invented rates.

### Skills

- Numeric policy → **`assumptions`** on a dedicated skill; read with `Copernicus.Skills.get('banking.my-skill').assumptions`.
- Header alias lexicons → **`headerSignals`** (returned from `Skills.get` when registered on the skill).
- Do **not** hardcode rates/thresholds in the agent if they belong in Skills.

### File types (CSV)

Adding a new **required** type means updating **`js/tools/csv-loader.js`** (`FILE_TYPES`, `FILE_TYPE_SIGNALS`, `freshStore().byType`, inference), and **`js/framework.js`** `Data._normalizeFromIngestion` loop for that type.

### Secrets (API keys)

Use **`Copernicus.KeyRing`** (`js/tools/key-ring.js`): IndexedDB with localStorage fallback. Keys are **not encrypted** (browser constraint); they stay on device. Document which `id` each integration uses (e.g. `bankersiq_luci_api` via `KeyRingIds.BANKERSIQ_TRATES_API`).

## Checklist for a new agent

1. [ ] Unique `id`, clear `name`, outcome-focused `description`.
2. [ ] Declare `requiredDataTypes` / `optionalDataTypes` if CSV-driven.
3. [ ] `ensureIngested` with correct options; handle `needsData`.
4. [ ] Read assumptions from **Skills**, not literals.
5. [ ] Return `summary` + structured payload for JSON tree (+ `queryContext` if Ask should understand rows).
6. [ ] Register script in `index.html` **after** dependencies (skills, tools).
7. [ ] If new CSV **type**, extend csv-loader + `Data` normalization.

## Reference agents

| File | Pattern |
|------|--------|
| `js/agents/checking-profitability.js` | Required multi-type (`checking` + `customers`), Skills, `queryContext`. |
| `js/agents/share-of-wallet.js` | Multi required types, no external API. |
| `js/agents/loan-profitability.js` | Required + **optional** type; **BankersIQ** trates + **KeyRing** `bankersiq_luci_api`; **`riskDisclaimer`**. |
| `js/agents/field-signal-test.js` | Audits **field → role** mappings per ingested file; `fieldSignalLexicon`, `fieldSignalReports`. |
