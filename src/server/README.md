# Server

Square credentials, upstream adapters, cache orchestration, normalization, and backend services live here. Every credential-bearing or Square-SDK module must begin with `import "server-only"` and return minimal public DTOs. The PD-02 Square gateway is the sole raw-upstream boundary: it fixes the Sandbox host and API version in code, applies bounded read retries, and returns opaque server data for PD-03 normalization. `menu/normalize.ts` then performs deterministic location filtering, schedule conversion, price resolution, modifier shaping, and JSON-safe DTO validation.
