# Square Sandbox setup

This application talks only to Square **Sandbox**. Production credentials, custom API hosts, and browser-exposed tokens are out of scope.

## 1. Square account and application

1. Create or sign in to a Square Developer account at [https://developer.squareup.com](https://developer.squareup.com).
2. Open the Developer Dashboard and create an application (or reuse an existing Sandbox app).
3. Open the application → **Credentials** → **Sandbox**.
4. Copy the **Sandbox Access Token**.

### Required permissions / API surface

The server reads:

| API | Purpose |
| --- | --- |
| Locations | List active locations, addresses, timezones, business hours |
| Catalog | Items, categories, images, modifier lists, availability periods |
| Inventory | `IN_STOCK` counts for location-present variations |

Grant the Sandbox token access to Locations, Catalog, and Inventory. No Orders, Payments, Customers, or OAuth flows are used.

## 2. Environment variables

Copy the example file and set the token locally:

```bash
cp .env.example .env.local
```

```bash
# .env.local — server-only
SQUARE_ACCESS_TOKEN=<your-sandbox-access-token>
```

Rules:

- Never commit `.env.local` or any real token.
- Never put the token in `NEXT_PUBLIC_*` variables.
- The Sandbox environment, API origin (`https://connect.squareupsandbox.com`), and API version (`2026-07-15`) are hard-coded in `src/server/square/config.ts`. Do not override them from the browser or query string.

## 3. Startup

```bash
nvm use          # Node 22.x — see .nvmrc
corepack enable
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The home route loads active locations and redirects into `/locations/[locationId]`.

Without a real Sandbox token, unit/integration/E2E suites still run because they use fixtures and route mocks. Live browsing against Square requires `.env.local`.

## 4. Smoke-check the live Sandbox merchant

After seeding catalog data (see [seed-data.md](./seed-data.md)):

1. `pnpm dev`
2. Confirm `/` redirects to an active location.
3. Switch locations and verify distinct item sets.
4. Open an item with modifiers, confirm sold-out variations stay visible but disabled.
5. Disconnect the network after a successful load and confirm browse-only offline mode.

## 5. Security reminders

- Tokens must appear only in server modules that import `server-only`.
- API responses never echo Square error payloads or credentials.
- `pnpm secrets:scan` and CI secret scanning guard the tree before submission.
