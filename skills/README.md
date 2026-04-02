# Skills

**Executable** skill modules loaded by `index.html`. Each file calls `Copernicus.Skills.register(...)` so agents and tools can `Copernicus.Skills.get('skill.id')`.

| File | Domain | Registers (examples) |
|------|--------|----------------------|
| `banking.js` | `banking` | `banking.credit-for-funding`, `banking.profit-column-signals` (`headerSignals.checkingProfitability`), `banking.field-inference`, `banking.query-context`, … |

**Local / market** defaults are in **`../context/local-market.js`** (same `register` pattern) so they sit with deployment context.

**Load order:** `framework.js` → `skills/banking.js` → `context/local-market.js` → `ai-engine.js` → `profit-column-discovery.js` → … → agents.

User overrides may persist via `Copernicus.Store` (see `framework.js`).
