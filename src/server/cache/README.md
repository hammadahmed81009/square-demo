# Server cache

Best-effort in-memory caches, request coalescing, TTL handling, and stale fallback belong in this boundary. Cache failures must degrade to upstream reads rather than fail requests.
