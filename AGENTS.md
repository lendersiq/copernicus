# Copernicus agents — author’s guide

This document is the **contract** for building agents so humans and tools can add new research agents consistently.

**Step-by-step tutorial (Skills, tools, `queryContext`, load order):** [`js/agents/agentDev.md`](js/agents/agentDev.md).

**Determinism, Ask vs. agents, reproducibility, APIs vs. hallucination:** [`context/determinism.md`](context/determinism.md).

## Architecture (mental model)

| Layer | Role |
|--------|------|
| **`Copernicus.Agent(spec)`** | Factory: `id`, `name`, `description`, `run()`, optional `requiredDataTypes`, `optionalDataTypes`. |
| **`Copernicus.register(agent)`** | Adds the agent to the UI registry. |
| **`Copernicus.Data`** | Normalized accounts from CSV (`checking`, `savings`, `cd`, `loans`, `mortgages`, …) + `customerDirectory` + `meta`. |
| **`Copernicus.Skills.get(id)`** | Domain assumptions, formulas, `queryContext`, `headerSignals`, etc. |
| **`Copernicus.run(agent, inputs, researchContext)`** | Executes `run`; supports **sync or Promise** return values. |
| **`CSVLoader`** | CSV **ingestion** → in-memory `byType[fileType]` rows; file types are strings like `'loans'`, `'mortgages'`. |

Script **load order** (see `index.html`): `framework.js` → `skills/*.js` → `context/*.js` → `ai-engine.js` → tools (e.g. `csv-loader.js`, `customer-directory.js`, `key-ring.js`, `fred-client.js`, `loan-spread.js`, …) → **agent scripts** → `app.js`.

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
- **`queryContext`**: for **Ask** / insights — `rowsKey`, `skillId`, `entityLabel`, `idFields`, optional `insightsPrimaryKey`. Prefer extending **`banking.query-context`** `fieldCatalog` in `skills/banking.js` instead of repeating large catalogs per agent; merge order is skill first, then agent overrides.
- **Errors:** `{ error: '…' }` or thrown errors; framework wraps async failures.

### Async agents

Use **`return Promise.resolve(…)`** or **`return fetch(…).then(…)`** when calling external APIs (e.g. BankersIQ). `Copernicus.run` already unwraps Promises.

### FDIC Summary of Deposits (market vitality)

**`js/tools/fdic-sod.js`** calls **`https://api.fdic.gov/banks/sod`** with Elasticsearch-style **`filters`**: **`ZIPBR:#####`** only for ZIP (no `STALP` AND — avoids dropping rows that still match the public SOD ZIP extract), or **`CITYBR:"City" AND STALP:XX`**. Paginates (`limit` / `offset`); sums **DEPSUMBR** (else **DEPSUM**) in **$ thousands** by **YEAR**. Optional **`api_key`**. Browser **CORS** must allow `api.fdic.gov`.

**CBSA (market vitality, ZIP mode):** **`js/tools/census-cbsa.js`** maps ZIP → CBSA code via **`Copernicus.ZipCbsaData`** (**`js/data/zip5-to-cbsa.js`**) and title via **`Copernicus.CbsaNameData`** (**`js/data/cbsa-code-to-name.js`**). Both are built by **`scripts/build-zip5-cbsa.py`**: ZCTA5–CBSA from the Census **[2010 relationship file](https://www2.census.gov/geo/docs/maps-data/data/rel/zcta_cbsa_rel_10.txt)** (dominant **ZPOPPCT**); NAME list from **`api.census.gov`** ACS 5-year at build time only (browser never calls Census — **`file://` OK**).

### Treasury curve (interest-rate risk)

**`js/tools/fred-client.js`** builds a 1–360 month curve via the **BankersIQ Copernicus proxy** (`https://bankersiq.com/api/copernicus/proxy/`): fetches 10 FRED constant-maturity series (`DGS3MO`, `DGS6MO`, `DGS1`, `DGS2`, `DGS3`, `DGS5`, `DGS7`, `DGS10`, `DGS20`, `DGS30`) in parallel, each as `?_key=KEY&service=fred&endpoint=series/observations&series_id=SERIES&limit=1&sort_order=desc`, then **linearly interpolates** between knots; months 1–2 use the 3-month rate (flat). **`LA.tools.loadTreasuryCurveFromKeyRing()`** reads the key from **`Copernicus.KeyRing`** (`KeyRingIds.BANKERSIQ_TRATES_API` → stored id `bankersiq_luci_api`) and calls **`buildTreasuryCurveFromFredProxy`**. Override proxy base URL (no query string): **`Copernicus.Fred.copernicusProxyUrl`**.

Legacy path: **`buildMonthlyTreasuryCurve`** / **`fetchBankersIqTreasuryCurve`** still call `/api/luci/trates/` directly (`api_key=`); override: **`Copernicus.Fred.bankersIqTratesUrl`**. Use these only if the proxy is unavailable.

Loan spread rows are built in **`js/tools/loan-spread.js`** (`buildLoanTreasurySpreadRows`, `summarizeTreasuryCurveForResult`). Shared customer-directory lookups live in **`js/tools/customer-directory.js`**.

If the BankersIQ key is missing, the loan agent returns **`needsBankersIqKey`**. There is **no** FRED or other Treasury fallback — **no** invented rates.

### Skills

- Numeric policy → **`assumptions`** on a dedicated skill; read with `Copernicus.Skills.get('banking.my-skill').assumptions`.
- Header alias lexicons → **`headerSignals`** (returned from `Skills.get` when registered on the skill).
- Do **not** hardcode rates/thresholds in the agent if they belong in Skills.
- **`riskDisclaimer`** (and similar copy) can live on the domain skill (e.g. **`banking.loan-profitability.riskDisclaimer`**) and be copied onto the result in `run()`.

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
| `js/agents/loan-profitability.js` | Required + **optional** type; thin orchestration — **`loadTreasuryCurveFromKeyRing`**, **`buildLoanTreasurySpreadRows`**, **`summarizeIngestedFiles`**; **`riskDisclaimer`** on skill **`banking.loan-profitability`**. |
| `js/agents/field-signal-test.js` | Audits **field → role** mappings per ingested file; `fieldSignalLexicon`, `fieldSignalReports`. |
| `js/agents/market-vitality.js` | **No CSV** — UI: **ZIP, state, city** only. **FDIC SOD** (`js/tools/fdic-sod.js`); **`inferUsStateFromZip`** + **`js/data/zip5-to-state.js`** when state is blank. **CBSA** (ZIP only): **`js/data/zip5-to-cbsa.js`** + **`js/data/cbsa-code-to-name.js`** + **`js/tools/census-cbsa.js`**; `scripts/build-zip5-cbsa.py` (ZCTA file + ACS NAME at build time). **FSBI**: one call `state` + `inflationAdjusted` (no period/subSector) → full ALL/ALL series per [BankersIQ](https://bankersiq.com/api/FSBI/); `js/tools/fsbi-client.js`; optional **`KeyRingIds.BANKERSIQ_TRATES_API`**. ZIP→state: `scripts/build-zip5-state.py`. |
