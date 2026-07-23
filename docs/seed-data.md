# Deterministic Sandbox seed-data matrix

Configure the Sandbox merchant so an evaluator can reproduce location filtering, schedules, modifiers, prices, and inventory without guessing. The automated fixtures in `tests/fixtures/square/representative.ts` mirror this matrix for offline tests.

## Locations (2 active)

| ID (example) | Name | Timezone | Hours (local) | Notes |
| --- | --- | --- | --- | --- |
| Downtown | Downtown | `America/New_York` | Mon–Tue 07:00–18:00 (extend weekdays similarly) | Primary demo location |
| Airport | Airport | `America/Chicago` | Mon 05:00–23:00 (extend similarly) | Different catalog presence + price overrides |

Create both as **ACTIVE**. Incomplete addresses are fine; inactive locations must not appear in the app.

## Categories (3–4)

| Category | Kind | Parent | Schedule | Purpose |
| --- | --- | --- | --- | --- |
| Breakfast | `MENU_CATEGORY` | — | Mon–Tue 07:00–11:00 (availability periods) | Top-level scheduled category |
| Coffee | `MENU_CATEGORY` | Breakfast | Inherit Breakfast | Nested menu category |
| Breakfast Food | `MENU_CATEGORY` | Breakfast | Inherit Breakfast | Second leaf under Breakfast |
| Pastries | Regular category fallback | — | None (always available unless item overrides) | Proves non-menu category fallback |

Prefer `MENU_CATEGORY` memberships when available; the normalizer falls back to regular categories for Sandbox compatibility.

## Items (6–10 recommended)

Minimum reproducible set used by fixtures (expand live Sandbox to 6–10 for the demo):

| Item | Locations | Variations / prices | Modifiers | Inventory | Notes |
| --- | --- | --- | --- | --- | --- |
| House Latte | All | Small $4.50 (Airport override $5.00); Large $5.50 **Downtown only** | Milk (required list), Name on cup (text ≤24) | Tracked | Multi-variation + modifiers |
| Egg Sandwich | **Downtown only** | Regular $8.50 | — | Untracked | Location-specific parent item |
| Butter Croissant | All | Regular $4.25 | — | Tracked; Airport `sold_out` override | Sold-out still visible |
| Matcha Tea *(add in Sandbox)* | Downtown | Ceremonial $5.00 | — | Tracked | Extra search/category demo item |
| Cold Brew *(add in Sandbox)* | Airport only | Regular $4.75 | — | Tracked | Second location-only SKU |
| Seasonal Muffin *(add in Sandbox)* | All | Regular $3.75 | — | Tracked qty `0` at Downtown | Another sold-out signal |
| Nightcap Espresso *(optional)* | All | Single $3.00 | — | Tracked | Empty / off-schedule windows for “not scheduled” UI |
| Bagel *(optional)* | Downtown | Regular $3.25 | Cream cheese list | Untracked | Extra modifier coverage |

Target **6–10** sellable items in the live Sandbox catalog so the UI feels populated while still matching the rules above.

## Required behaviors to configure

1. **Location-specific item** — Egg Sandwich present only at Downtown (`present_at_all_locations=false` + Downtown in `present_at_location_ids`).
2. **Variation-level presence** — Latte Large present only at Downtown; Small present everywhere with Airport price override.
3. **Scheduled category** — Breakfast (and children) limited by Catalog availability periods.
4. **Modifiers** — At least one required list (Milk) and one optional text (Name on cup); Airport oat-milk price override `$1.50`.
5. **Multiple prices** — Global variation price plus location overrides.
6. **Tracked stock** — Latte Small / Croissant with inventory counts.
7. **Sold-out variation** — Croissant at Airport via location `sold_out` (or qty ≤ 0 for a tracked variation).

## Square Dashboard checklist

1. Create the two ACTIVE locations with the timezones above.
2. Create availability periods, then attach them to Breakfast.
3. Create modifier lists, then attach them to Latte.
4. Create items/variations with explicit location presence and price overrides.
5. Set inventory counts (or sold-out overrides) per location.
6. Restart `pnpm dev` and confirm Downtown vs Airport item sets differ.

## Channels API note

Square Channels can map menus to selling surfaces in production, but the Channels API is **not available in Sandbox**. This project therefore treats Catalog location presence + schedules as authoritative for the challenge. See [product-behavior.md](./product-behavior.md#sandbox-channels-limitation).
