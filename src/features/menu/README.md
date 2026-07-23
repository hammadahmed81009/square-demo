# Menu feature

This boundary owns location selection, category browsing, search, item cards, item details, availability presentation, and offline-friendly snapshot caching. It may consume public DTOs but must not import `src/server`.

Validated location lists and per-location menu snapshots are stored in IndexedDB for at most 24 hours. The UI loads cache first, revalidates in the background, re-evaluates schedules against the current clock, treats cached inventory as stale, and disables cart mutations until a fresh online response succeeds.
