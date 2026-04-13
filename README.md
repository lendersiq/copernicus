# Copernicus

Local agents, local data — AI without trading away control.

Local-first research agents: **ingest** CSV extracts in the browser, run profitability / share-of-wallet / loan-spread analysis (and more), and use **Explain** / **Ask** with zero server dependency for the core demo. Data stays in memory on your machine unless you add hosting or integrations.

## Quick start

1. Open `index.html` in a modern browser (works on `file://`). If an embedded IDE preview logs a `file:` / frame security warning, use a normal browser tab or a local static server (e.g. `npx serve .`) for a clean console.
2. Use **Select data files…** to ingest your CSVs (data stays in memory only).
3. Pick an agent from the dropdown and click **Run research**.

## Share of Wallet (example flow)

1. Prepare two CSVs: **checking** (or savings) accounts and a **customer directory** with `customerId` + name **fields**.
2. Select both files. The app classifies types from headers and filename hints.
3. Optionally adjust skill assumptions under **Skills** (stored in browser local storage).
4. Click **Run research**. The agent runs over all customers and uses `Copernicus.AI` to infer segment, income multiplier, and a single **Share of Wallet** score (0–100) per customer.

## Layout

- **`index.html`** — Single-page shell: agent picker, file input, results, optional skills editor.
- **`js/framework.js`** — Core: `Copernicus.Store`, `Copernicus.Agent`, `Copernicus.run()`, agent registry, and **`Copernicus.AI`** (inference: segment, income multiplier, composite SOW score).
- **`skills/`** — `Copernicus.Skills` registrations for domain logic (`banking.js`, …). See `skills/README.md`.
- **`js/agents/`** — One script per agent; each registers with the framework.
- **`js/ai-engine.js`** — NLP-lite, intent parsing, insight text, field classification.
- **`js/tools/csv-loader.js`** — Parses CSV, infers **field → role** mappings, holds in-memory store by file type.

## Adding an agent

1. Create a script (e.g. `js/agents/my-agent.js`) that defines an agent with `Copernicus.Agent({ id, name, description, run })` and calls `Copernicus.register(agent)`.
2. Add `<script src="js/agents/my-agent.js"></script>` to `index.html` after `framework.js` and skills.

## Data in agents

To use ingested CSV data in an agent, use `CSVLoader.getInMemoryStore()` (or `researchContext.csvData` if the app passes it). Data is keyed by type: `byType.checking`, `byType.savings`, `byType.cd`, `byType.loans`, and `byType.customers` (customer directory: `customerId` + `customerName`, e.g. `Portfolio` + `fullname`). After normalization, `Copernicus.Data.getState().customerDirectory` maps `customerId` → display name (first occurrence wins for duplicates).

## Authoring agents

See **`AGENTS.md`** for the full contract (`requiredDataTypes`, `ensureIngested`, `queryContext`, async patterns, and secrets).

## Determinism and Ask vs. agents

The default pipeline is **deterministic** and **data-grounded**; agents do not depend on Ask. For a precise distinction (reproducibility, stochastic sampling, API-driven variability vs. hallucination), see **`context/determinism.md`**.
