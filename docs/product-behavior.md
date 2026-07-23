# Product behavior

How the app decides what is visible, orderable, and mutable.

## Variation-level location semantics

Square Catalog presence is applied exactly:

1. Evaluate the **parent item** presence for the selected location.
2. Evaluate each **variation** presence independently.
3. Keep the item only when the parent is present **and** at least one variation is present.
4. Parent absence always wins over variation presence.
5. Deleted/archived objects are omitted. Temporarily unavailable (sold out / closed) items stay visible.

Presence rules:

- `present_at_all_locations=true` → present unless the location is in `absent_at_location_ids`.
- `present_at_all_locations=false` → present only when listed in `present_at_location_ids`.

Location price overrides replace global variation prices before money leaves the server.

## Availability algorithm

Orderability is recomputed in the browser against the selected location timezone, current clock, connectivity, and snapshot freshness. Precedence (first match wins):

1. Offline or stale snapshot
2. Invalid location timezone / configuration
3. Location closed (business hours)
4. Category schedule closed
5. Variation not sellable / unsupported pricing
6. Sold out
7. Modifier configuration invalid
8. Orderable

Schedule details:

- Weekly intervals are start-inclusive / end-exclusive in the location IANA timezone.
- Overnight periods (end earlier than start) extend into the next day.
- Multiple periods on one category are OR’d; ancestor paths are intersected; alternate item category paths are unioned.
- Missing schedules mean always available; invalid referenced periods fail closed for that path and emit a warning.
- Item schedule windows are intersected with location business hours.
- Next opening is searched within the next seven days.
- Store-closed messaging takes priority over category-schedule messaging.
- Re-evaluation runs on the next minute boundary, tab focus, and connectivity restoration.

## Inventory degradation policy

- Inventory is fetched in batches of ≤1000 variation IDs with full cursor pagination.
- Effective tracking: location override → variation `track_inventory` → default false.
- Current `sold_out=true` location overrides are authoritative until `sold_out_valid_until` passes.
- Tracked `IN_STOCK` quantity ≤ 0 is sold out; quantities use decimal strings (no float math).
- Missing counts for tracked items become `unknown`, not zero.
- If inventory fails but catalog succeeds, the menu still returns with a warning and degraded stock state.
- An item is sold out only when every orderable variation is sold out; individual sold-out variations are disabled.
- Out-of-stock items remain visible and searchable.

## Offline restrictions

- Normalized location lists and per-location menu snapshots are stored in IndexedDB (≤24 hours, schema-versioned).
- UI loads cache first, then revalidates online (no empty flash on warm cache).
- Cached schedules are re-evaluated with the current clock; cached inventory is marked unknown/stale.
- Offline or stale snapshots are **browse/search only**: add, remove, quantity, and modifier mutations stay disabled until a fresh online response succeeds.
- Corrupt, expired, wrong-kind, or unsupported-version envelopes are discarded independently.

## Cart and location policy

- Cart state is schema-versioned in `localStorage` (no secrets).
- Quantities are whole numbers 1–99; money uses minor-unit strings and `bigint` arithmetic.
- Identical item/variation/modifier configurations merge into one line via a canonical key.
- After each fresh menu response, lines are reconciled: prices update with notices; unavailable lines drop out of the active subtotal.
- Changing location with a non-empty cart requires confirmation; confirmation clears the cart.
- Last selected location is persisted for the home redirect.

## Sandbox Channels limitation

Square’s [Channels API](https://developer.squareup.com/docs/channels-api) can map channel-specific menus to locations in production, but it is **not available in Sandbox**. This challenge therefore:

- Treats Catalog object presence + schedules as the Sandbox source of truth.
- Documents Channels mapping as the production extension: resolve the selling channel for each location, filter catalog visibility through channel assignments, then apply the same normalization pipeline.

Do not claim Sandbox channel menus are authoritative for this submission.
