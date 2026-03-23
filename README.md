# LocalAgents

A **local-first** JavaScript application framework that runs entirely in the browser via **file://** — no servers, no Node.js. It uses local agents to perform research tasks. **All data stays in memory on your machine** (bank security edge); nothing is sent to a server or persisted unless you choose to.

## How to run

1. Open `index.html` in your browser (double-click or **File → Open**).
2. Or from the project folder: `start index.html` (Windows) / `open index.html` (macOS).

The app uses the `file://` protocol; no dev server is required.

## Share of Wallet agent (banking)

A single **Share of Wallet** agent uses the framework’s **AI layer** and central **CSV loader**. Data remains **in memory only**; no Customer ID or income multiplier inputs — the agent infers segments and computes one SOW score per customer.

1. Select the **Share of Wallet** agent, then **Select files…** and choose your checking, savings, CD, and loan CSV files.
2. The system **infers file type** from filename and headers (e.g. `checking.csv`, `loans_2024.csv` → checking / loans).
3. It **infers column roles** from header names (e.g. `customer_id`, `current_balance`, `direct_deposit`, `open_date`) so different formats are supported.
4. Click **Run research**. The agent runs over all customers and uses `LocalAgents.AI` to infer segment, income multiplier, and a single **Share of Wallet** score (0–100) per customer.

### Column naming tips (for best inference)

- **Customer ID:** `customer_id`, `cust_id`, `client_id`, `customerid`, etc.
- **Balance:** `balance`, `current_balance`, `avg_balance`, `principal_balance`, `outstanding_balance`, etc.
- **Dates:** `open_date`, `date_opened`, `origination`, `maturity_date`, etc.
- **Flags:** `direct_deposit`, `primary_checking`, `dd`, `is_primary`, etc.
- **Income:** `household_income`, `annual_income`, `income`, etc. (for income-based SOW)
- **Local market (not banking rules):** `context/local-market.js` registers `local.market` and documents assumptions in its **header comments** (e.g. average household income when CSV income is missing). See `context/README.md` and `skills/README.md`.

### Sample data

In the `data/` folder you’ll find sample CSVs (`sample_checking.csv`, `sample_savings.csv`, `sample_cd.csv`, `sample_loans.csv`). Load all four and run research to see Share of Wallet scores for all customers.

## Framework

- **`js/framework.js`** — Core: `LocalAgents.Store`, `LocalAgents.Agent`, `LocalAgents.run()`, agent registry, and **`LocalAgents.AI`** (inference: segment, income multiplier, composite SOW score).
- **`skills/`** — `Copernicus.Skills` registrations for domain logic (`banking.js`, …). See `skills/README.md`.
- **`context/`** — Deployment context; includes **`local-market.js`** (registers `local.market`) plus optional `.md` notes. See `context/README.md`.
- **`js/tools/csv-loader.js`** — Central loader: in-memory only, file-type and column-semantic inference from names and content.
- **Agents** have `id`, `name`, `description`, and `run(inputs, researchContext)`.
- **Research context** can include `store` and the in-memory CSV store (via the loader).

## Adding more agents

1. Create a script (e.g. `js/agents/my-agent.js`) that defines an agent with `LocalAgents.Agent({ id, name, description, run })` and calls `LocalAgents.register(agent)`.
2. Load it in `index.html` after `framework.js` and before `app.js`.
3. Extend `js/app.js` in `selectAgent` and `runAgent` for inputs and result display.

To use loaded CSV data in an agent, use `CSVLoader.getInMemoryStore()` (or `researchContext.csvData` if the app passes it). Data is keyed by type: `byType.checking`, `byType.savings`, `byType.cd`, `byType.loans`, and `byType.customers` (customer directory: `customerId` + `customerName`, e.g. `Portfolio` + `fullname`). After normalization, `Copernicus.Data.getState().customerDirectory` maps `customerId` → display name (first occurrence wins for duplicates).
