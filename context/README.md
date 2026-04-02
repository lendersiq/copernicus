# Context

This folder holds **deployment-specific and human-facing context** for **Copernicus** — local agents, local data — **AI without trading away control.** It is a **local-first** web app where teams **ingest** CSV extracts, run **research agents** (profitability, share of wallet, loan spread vs Treasury, field-mapping tests, and more), and use **Explain / Ask** powered by the in-browser **Copernicus.AI** engine. Data stays in memory in the browser unless you add your own hosting or integrations; the design favors **no Node**, **no server requirement** for the core demo, and **skills** that centralize assumptions instead of hard-coding policy in every agent.

**Why `context/` vs `skills/`?**  
**`skills/banking.js`** (and other domain skills) describe **portable banking logic** — formulas, default assumptions, and AI field catalogs that could apply at any institution. **`context/`** is for **this rollout**: how we **address the user**, and **numbers or labels tied to a geography or deployment** (e.g. typical household income when the CSV does not carry it). Keeping that split makes it obvious what to copy wholesale versus what to edit when you ship to another market or team.

---

## Files in this folder

| File | Purpose |
|------|--------|
| **`local-market.js`** | Registers skill **`local.market`** (`averageHouseholdIncome`, …). Values and rationale live in the **file header comments** — update when you change region or methodology. Loaded after **`skills/banking.js`** in **`index.html`**. |
| **`soul.js`** | Defines **`Copernicus.Soul`**: preferences for **tone and addressing** in Explain / Ask. On **`file://`**, the app uses embedded **`DEFAULT_SOUL_MARKDOWN`** (no fetch). On **http(s)**, it may **`fetch('soul.md')`** from the site root if you add that file, otherwise it falls back to the embed. |
| *(optional `.md`)* | Runbooks, compliance notes, glossary of internal field names — **not executed** by the app; for people maintaining the deployment. |

---

## Optional: `soul.md` on a server

If you serve the app over **HTTPS**, you can add a **`soul.md`** next to **`index.html`** so non-developers can edit addressing without touching **`soul.js`**. The embedded default in **`soul.js`** remains the source of truth for **offline / file://** use.

---

## Related paths

- **Agent behavior & Treasury notes:** **`AGENTS.md`**
- **Shared banking assumptions & query context:** **`skills/banking.js`**
- **CSV types and normalization:** **`js/tools/csv-loader.js`**, **`js/framework.js`**

When you onboard someone new, point them here first for **what “context” means in this repo**, then to **`AGENTS.md`** for how agents and external data (e.g. Treasury curve) fit together.
