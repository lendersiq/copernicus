# Skills

**Executable** skill modules loaded by `index.html`. Each file calls `Copernicus.Skills.register(...)` so agents and tools can `Copernicus.Skills.get('skill.id')`.

| File | Domain | Registers (examples) |
|------|--------|----------------------|
| `banking.js` | `banking` | `banking.credit-for-funding`, `banking.segmentation`, `banking.share-of-wallet`, `banking.query-context`, … |

**Local / market** defaults are in **`../context/local-market.js`** (same `register` pattern) so they sit with deployment context.

**Load order:** `framework.js` → `skills/banking.js` → `context/local-market.js` → … → agents.

User overrides may persist via `Copernicus.Store` (see `framework.js`).
