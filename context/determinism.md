# Determinism, reproducibility, and hallucination

Copernicus is designed to fundamentally avoid hallucination through a strictly deterministic pipeline. Both **agent logic** and the **Ask** interface produce responses exclusively from secure, locally ingested data combined with explicit, fixed rules—never from open-ended or probabilistic text generation.

**Identical inputs** means: the same ingested dataset and the same agent configuration for a **research run**; for **Ask**, the same natural-language question applied to the same **stored agent result** (Ask does not drive agents—it only interprets a result already in memory). Under those conditions, the system yields fully reproducible outputs, because the core response path contains no stochastic sampling or random generation steps.

External time-varying sources (e.g. live market feeds or third-party APIs) may produce different numerical results when the remote payload or observation date changes. That variability reflects **updated external data**, not random or generative steps in the local implementation; it is **orthogonal** to stochastic behavior in the client-side computation and does not constitute hallucination in the sense of inventing facts absent from the supplied context.

In essence, Copernicus is **not generative by default**. It computes answers directly from the supplied data and specified procedures, rather than inventing unconstrained natural-language content.
