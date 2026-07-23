# Per Diem Multi-Location Menu

A Next.js application for browsing a Square Sandbox catalog across multiple locations while respecting location presence, business hours, category schedules, modifiers, and inventory state.

## Prerequisites

- Node.js `22.23.1` (see `.nvmrc` and `.node-version`)
- pnpm `10.14.0` through Corepack
- A Square Sandbox application with a server-side access token

## Local setup

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Open <http://localhost:3000>. Replace the placeholder in `.env.local` with a Square Sandbox access token before exercising Square-backed endpoints.

The Square environment, API origin, and API version are fixed server-side. Do not add the token, environment, or upstream URL to a `NEXT_PUBLIC_*` variable.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server |
| `pnpm build` | Produce a production build |
| `pnpm lint` | Run ESLint with zero warnings allowed |
| `pnpm typecheck` | Run strict TypeScript checking |
| `pnpm test:unit` | Run colocated unit and component tests |
| `pnpm test:integration` | Run repository and API integration tests |
| `pnpm test:e2e` | Run Chromium browser tests |
| `pnpm audit:prod` | Fail on high-severity production dependency findings |
| `pnpm secrets:scan` | Scan tracked project text for likely secrets |
| `pnpm verify` | Run lint, types, unit, integration, and build checks |
| `pnpm run ci` | Run the full local equivalent of CI |

Install the Playwright browser once before the first local E2E run:

```bash
pnpm exec playwright install chromium
```

## Architecture

- `src/app` owns routes, layouts, and route handlers.
- `src/features` owns user-facing menu and cart behavior.
- `src/domain` owns pure money, availability, inventory, modifier, and cart rules.
- `src/shared` owns serializable schemas and browser-safe utilities.
- `src/server` is the only boundary permitted to read secrets or use the Square SDK.

Validated menu and location snapshots are cached in IndexedDB for offline browsing. Cart mutations stay disabled until a fresh online response succeeds. The accepted foundation decision is documented in [ADR 0001](./docs/adr/0001-nextjs-bff-foundation.md).

## Square Sandbox data

Seed data should include two active locations, 3–4 categories, 6–10 items, a location-specific item, scheduled availability, modifiers, location price overrides, tracked inventory, and a sold-out variation.

## Testing strategy

- Unit tests target deterministic domain behavior and synchronous UI.
- Integration tests target module boundaries, schemas, adapters, pagination, cache behavior, and Route Handlers.
- Playwright covers guest-critical flows in a real browser.
- CI also performs production dependency auditing and secret scanning.

## Roadmap

After the challenge scope, add production OAuth, Square Channels mapping, webhook-driven cache invalidation, distributed caching, observability export, and server-side checkout revalidation. Payments and Square Order creation remain deliberately outside this challenge.
