# Architecture, security, testing, and roadmap

## Architecture

Single Next.js 16 App Router deployment acting as a backend-for-frontend:

| Boundary | Responsibility |
| --- | --- |
| `src/app` | Routes, layouts, `/api/locations`, `/api/menu` |
| `src/server` | Square SDK, secrets, gateway, normalization, in-memory TTL cache |
| `src/features` | Menu browsing UI, offline cache, cart UI/state |
| `src/shared` | Zod DTOs shared across the server/browser boundary |
| `src/domain` | Reserved for pure rules; availability/cart logic currently lives with features for colocation |

Data flow:

1. Browser calls same-origin `/api/*` only.
2. Server validates input, reads Square (Sandbox), normalizes to DTOs, returns `{ data, meta }` or `{ error }`.
3. Browser caches validated snapshots, recomputes time-dependent availability, and owns the cart.

There is **no database**. Server caches are best-effort in-memory TTLs; browser persistence is limited to public normalized data.

Foundation decision: [ADR 0001](./adr/0001-nextjs-bff-foundation.md).

## Security controls

- Environment validation for `SQUARE_ACCESS_TOKEN` at the server boundary.
- `server-only` on every credential-bearing / Square SDK module.
- Fixed Sandbox host + API version in code; never accepted from the client.
- Query validation (ID syntax, lengths) before upstream calls.
- Plaintext catalog descriptions only; no HTML rendering from Square.
- HTTPS-only remote images with narrow `next/image` remote patterns.
- Request IDs on responses/logs; no tokens, raw Square payloads, or stack traces in client responses.
- Dependency audit + secret scan in CI.

## Test strategy

| Layer | Tooling | Focus |
| --- | --- | --- |
| Unit | Vitest + Testing Library | Presence, money, schedules, inventory, search, modifiers, cart, browser cache |
| Integration | Vitest + fixtures | Gateway pagination/retries/stale fallback, API envelopes, inventory degradation |
| E2E | Playwright | Location switch, search/category, detail, modifiers/subtotal, sold-out, scheduled, offline |
| A11y | axe-core + keyboard flows | WCAG 2 A/AA smoke on the menu; operable search/config |
| Gate | `pnpm run ci` | lint, typecheck, unit, integration, e2e, audit, secrets, build |

Evidence: [verification-evidence.md](./verification-evidence.md).

## Trade-offs

1. **No Channels in Sandbox** — Catalog presence stands in for channel menus; production must add Channels mapping.
2. **Best-effort server cache** — process-local TTLs are enough for a demo; multi-instance production needs Redis/CDN invalidation.
3. **Client cart only** — exact local subtotals without Square Orders; checkout remains future work.
4. **Category availability periods are beta** — isolated behind normalized DTOs so upstream changes stay contained.

## Known limitations

- Payments, checkout submission, user accounts, production OAuth, admin tooling, tax calculation, and Square order creation are out of scope.
- Channels-based menu visibility is not authoritative in Sandbox.
- Inventory can lag while offline; the UI disables cart mutations rather than guessing.
- Image URLs that fail HTTPS fetch show a deterministic placeholder.
- Server stale snapshots may briefly serve catalog after upstream failure; inventory is not extended as fresh beyond its TTL.

## Another-week roadmap

1. Production OAuth + rotating credentials.
2. Channels API mapping per location/selling surface.
3. Webhook-driven cache invalidation for catalog and inventory.
4. Distributed caching and structured observability export.
5. Server-side checkout revalidation against live Square prices/stock before payment.
6. Optional authenticated saved carts — still without implying payments are in scope until explicitly added.
