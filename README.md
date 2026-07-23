# Per Diem Multi-Location Menu

A Next.js application for browsing a Square Sandbox catalog across multiple locations while respecting location presence, business hours, category schedules, modifiers, and inventory state.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/square-setup.md](./docs/square-setup.md) | Square account, Sandbox app, token, permissions, env, startup |
| [docs/seed-data.md](./docs/seed-data.md) | Deterministic Sandbox seed-data matrix |
| [docs/product-behavior.md](./docs/product-behavior.md) | Availability, presence, inventory, offline, cart, Channels limitation |
| [docs/architecture.md](./docs/architecture.md) | Architecture, security, tests, trade-offs, roadmap |
| [docs/verification-evidence.md](./docs/verification-evidence.md) | Local CI command evidence |
| [docs/loom-script.md](./docs/loom-script.md) | 60–90s Loom shot list |
| [docs/submission-email.md](./docs/submission-email.md) | Submission email draft |
| [docs/commit-history.md](./docs/commit-history.md) | Commit history review notes |
| [docs/adr/0001-nextjs-bff-foundation.md](./docs/adr/0001-nextjs-bff-foundation.md) | Foundation ADR |

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

Open <http://localhost:3000>. Put the Sandbox access token in `.env.local` (see [docs/square-setup.md](./docs/square-setup.md)). Seed the merchant using [docs/seed-data.md](./docs/seed-data.md).

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

## Architecture (summary)

- `src/app` owns routes, layouts, and route handlers.
- `src/features` owns user-facing menu and cart behavior.
- `src/domain` owns pure money, availability, inventory, modifier, and cart rules.
- `src/shared` owns serializable schemas and browser-safe utilities.
- `src/server` is the only boundary permitted to read secrets or use the Square SDK.

Validated menu and location snapshots are cached in IndexedDB for offline browsing. Cart mutations stay disabled until a fresh online response succeeds. Details: [docs/architecture.md](./docs/architecture.md).

## Testing strategy

- Unit tests target deterministic domain behavior and synchronous UI.
- Integration tests target module boundaries, schemas, adapters, pagination, cache behavior, and Route Handlers.
- Playwright covers guest-critical flows in a real browser, including accessibility smoke checks.
- CI also performs production dependency auditing and secret scanning.

Acceptance evidence: [docs/verification-evidence.md](./docs/verification-evidence.md).

## Roadmap

After the challenge scope, add production OAuth, Square Channels mapping, webhook-driven cache invalidation, distributed caching, observability export, and server-side checkout revalidation. Payments and Square Order creation remain deliberately outside this challenge.
