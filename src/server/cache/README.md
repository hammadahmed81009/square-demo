# Server cache

Best-effort in-memory caches, request coalescing, TTL handling, and stale fallback belong in this boundary. Cache failures must degrade to upstream reads rather than fail requests. `in-memory.ts` coalesces concurrent loads. The Square gateway caches locations for five minutes, catalog reads for 60 seconds, and inventory for 15 seconds. Complete location and catalog values may use a server-stale value for up to 15 minutes after an upstream failure; inventory never receives a stale extension.
