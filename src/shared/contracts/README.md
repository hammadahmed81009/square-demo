# Public contracts

These strict Zod schemas are the only shapes permitted to cross the server/browser boundary or enter browser persistence. Square SDK objects must be normalized into these DTOs first.

## Versioning

- Public API and menu snapshot schema: `1`
- Cart persistence schema: `1`
- Browser cache envelope schema: `1`
- Unknown cart or cache versions are discarded. A future version must add an explicit migration before changing that behavior.

## Representation rules

- Money is `{ amountMinor: string, currency }`; the amount is a canonical signed integer string. Runtime calculations may convert it to `bigint`, but JSON never contains `bigint`.
- Weekly intervals are normalized, non-wrapping minute ranges in a Monday-based week. `null` means no configured constraint; `[]` means configured but never available.
- Cache entries have a type-specific key and a maximum lifetime of 24 hours. Invalid, expired, cross-key, and unsupported-version entries are discarded independently.
- Menu snapshot IDs are unique, category parents and item category references resolve inside the snapshot, and all prices match the selected location currency.
- `modifierConfigurationError` is explicit: a malformed required modifier setup is shown safely but is not silently made orderable.
- Schemas are strict: undeclared upstream fields are rejected rather than silently forwarded.
