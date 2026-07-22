import { describe, expect, it } from "vitest";

import type { MenuSnapshotDto } from "@/shared/contracts";
import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import {
  evaluateMenuOrderability,
  nextMinuteBoundary,
  normalizeWeeklyPeriods,
  resolveInventoryState,
  resolveItemScheduleWindows,
} from "./availability";

function snapshotWith(
  changes: Partial<MenuSnapshotDto>,
): MenuSnapshotDto {
  return { ...representativeMenuSnapshot, ...changes };
}

function evaluate(snapshot: MenuSnapshotDto, now: string) {
  return evaluateMenuOrderability({
    isOnline: true,
    isSnapshotFresh: true,
    now: new Date(now),
    snapshot,
  });
}

describe("menu availability engine", () => {
  it("normalizes overnight periods, preserves exact boundaries, and returns the next minute boundary", () => {
    expect(
      normalizeWeeklyPeriods([
        { dayOfWeek: "MON", startLocalTime: "22:00:00", endLocalTime: "02:00:00" },
      ]),
    ).toEqual([
      { startMinute: 1320, endMinute: 1440 },
      { startMinute: 1440, endMinute: 1560 },
    ]);
    expect(
      normalizeWeeklyPeriods([
        { dayOfWeek: "MON", startLocalTime: "08:00:00", endLocalTime: "08:00:00" },
      ]),
    ).toEqual([]);
    expect(nextMinuteBoundary(new Date("2026-07-20T07:00:12.345Z")).toISOString()).toBe(
      "2026-07-20T07:01:00.000Z",
    );
  });

  it("uses start-inclusive/end-exclusive category scheduling and computes the next opening", () => {
    const atOpening = evaluate(representativeMenuSnapshot, "2026-07-20T11:00:00.000Z");
    const atClosing = evaluate(representativeMenuSnapshot, "2026-07-20T15:00:00.000Z");
    const openingItem = atOpening.items[0];
    const closingItem = atClosing.items[0];

    expect(openingItem?.reason).toBe("orderable");
    expect(closingItem?.reason).toBe("category_schedule_closed");
    expect(closingItem?.nextOpening).toBe("2026-07-21T07:00:00.000-04:00");

    const chicago = evaluate(
      {
        ...representativeMenuSnapshot,
        location: { ...representativeMenuSnapshot.location, timezone: "America/Chicago" },
      },
      "2026-07-20T11:00:00.000Z",
    );
    expect(chicago.items[0]?.reason).toBe("location_closed");
  });

  it("uses the location timezone across DST transitions", () => {
    const schedule = [{ startMinute: 8700, endMinute: 8820 }];
    const baseItem = representativeMenuSnapshot.items[0];
    if (baseItem === undefined) {
      throw new Error("Representative item is missing");
    }
    const snapshot = snapshotWith({
      categories: [
        {
          id: "CAT_DST",
          kind: "menu",
          name: "DST",
          ordinal: 0,
          parentId: null,
          scheduleWindows: schedule,
        },
      ],
      items: [{ ...baseItem, categoryIds: ["CAT_DST"], scheduleWindows: schedule }],
      location: {
        ...representativeMenuSnapshot.location,
        businessHours: schedule,
      },
    });

    expect(evaluate(snapshot, "2026-03-08T06:30:00.000Z").items[0]?.reason).toBe(
      "orderable",
    );
    expect(evaluate(snapshot, "2026-03-08T07:30:00.000Z").items[0]?.reason).toBe(
      "location_closed",
    );
  });

  it("intersects category ancestors and unions independent item category paths", () => {
    const baseItem = representativeMenuSnapshot.items[0];
    if (baseItem === undefined) {
      throw new Error("Representative item is missing");
    }
    const snapshot = snapshotWith({
      categories: [
        {
          id: "CAT_ROOT",
          kind: "menu",
          name: "Root",
          ordinal: 0,
          parentId: null,
          scheduleWindows: [{ startMinute: 420, endMinute: 720 }],
        },
        {
          id: "CAT_CHILD",
          kind: "menu",
          name: "Child",
          ordinal: 0,
          parentId: "CAT_ROOT",
          scheduleWindows: [{ startMinute: 600, endMinute: 900 }],
        },
        {
          id: "CAT_TUESDAY",
          kind: "menu",
          name: "Tuesday",
          ordinal: 0,
          parentId: null,
          scheduleWindows: [{ startMinute: 1_860, endMinute: 2_100 }],
        },
      ],
      items: [
        {
          ...baseItem,
          categoryIds: ["CAT_CHILD", "CAT_TUESDAY"],
          scheduleWindows: null,
        },
      ],
    });
    const item = snapshot.items[0];
    if (item === undefined) {
      throw new Error("Snapshot item is missing");
    }

    expect(resolveItemScheduleWindows(snapshot, item)).toEqual([
      { startMinute: 600, endMinute: 720 },
      { startMinute: 1_860, endMinute: 2_100 },
    ]);
  });

  it("resolves inventory exactly with decimal quantities, overrides, expiration, and missing counts", () => {
    const base = { globalTrackInventory: true, inventoryAvailable: true, now: new Date("2026-07-23T09:00:00.000Z") };

    expect(resolveInventoryState({ ...base, quantity: "0" }).inventoryState).toBe("sold_out");
    expect(resolveInventoryState({ ...base, quantity: "-0.25" }).inventoryState).toBe("sold_out");
    expect(resolveInventoryState({ ...base, quantity: "0.00001" }).inventoryState).toBe("in_stock");
    expect(resolveInventoryState({ ...base, quantity: "4.5" }).inventoryState).toBe("in_stock");
    expect(resolveInventoryState({ ...base, quantity: "not-a-number" }).inventoryState).toBe("unknown");
    expect(resolveInventoryState({ ...base, quantity: undefined }).inventoryState).toBe("unknown");
    expect(
      resolveInventoryState({
        ...base,
        locationSoldOut: true,
        quantity: "4.5",
        soldOutValidUntil: "2026-07-24T09:00:00.000Z",
      }).inventoryState,
    ).toBe("sold_out");
    expect(
      resolveInventoryState({
        ...base,
        locationSoldOut: true,
        quantity: "4.5",
        soldOutValidUntil: "2026-07-22T09:00:00.000Z",
      }).inventoryState,
    ).toBe("in_stock");
    expect(
      resolveInventoryState({
        ...base,
        locationTrackInventory: false,
        quantity: "0",
      }).inventoryState,
    ).toBe("untracked");
  });

  it("applies the locked orderability precedence for offline, configuration, schedules, variants, stock, and modifiers", () => {
    const baseItem = representativeMenuSnapshot.items[0];
    const firstVariation = baseItem?.variations[0];
    const secondVariation = baseItem?.variations[1];
    if (baseItem === undefined || firstVariation === undefined || secondVariation === undefined) {
      throw new Error("Representative variations are missing");
    }
    const snapshot = snapshotWith({
      items: [
        {
          ...baseItem,
          modifierConfigurationError: "Invalid required modifier",
          variations: [
            { ...firstVariation, inventoryState: "sold_out", sellable: false },
            { ...secondVariation, inventoryState: "sold_out" },
          ],
        },
      ],
    });
    const online = evaluate(snapshot, "2026-07-20T11:00:00.000Z");
    const offline = evaluateMenuOrderability({
      isOnline: false,
      isSnapshotFresh: false,
      now: new Date("2026-07-20T11:00:00.000Z"),
      snapshot: {
        ...snapshot,
        location: { ...snapshot.location, timezoneStatus: "invalid" },
      },
    });
    const invalidTimezone = evaluate(
      { ...snapshot, location: { ...snapshot.location, timezoneStatus: "invalid" } },
      "2026-07-20T11:00:00.000Z",
    );

    expect(online.items[0]?.variations.map((variation) => variation.reason)).toEqual([
      "variation_not_sellable",
      "sold_out",
    ]);
    expect(online.items[0]?.reason).toBe("variation_not_sellable");
    expect(offline.items[0]?.reason).toBe("offline_or_stale");
    expect(invalidTimezone.items[0]?.reason).toBe("invalid_location_timezone");

    const snapshotItem = snapshot.items[0];
    if (snapshotItem === undefined) {
      throw new Error("Snapshot item is missing");
    }

    const allSold = evaluate(
      {
        ...snapshot,
        items: [
          {
            ...snapshotItem,
            modifierConfigurationError: null,
            variations: [
              { ...firstVariation, inventoryState: "sold_out" },
              { ...secondVariation, inventoryState: "sold_out" },
            ],
          },
        ],
      },
      "2026-07-20T11:00:00.000Z",
    );
    const modifierInvalid = evaluate(
      {
        ...snapshot,
        items: [
          {
            ...snapshotItem,
            variations: [
              { ...firstVariation, inventoryState: "untracked" },
              { ...secondVariation, inventoryState: "untracked" },
            ],
          },
        ],
      },
      "2026-07-20T11:00:00.000Z",
    );
    expect(allSold.items[0]?.reason).toBe("sold_out");
    expect(modifierInvalid.items[0]?.reason).toBe("modifier_configuration_invalid");
  });

  it("keeps store-closed status ahead of category scheduling", () => {
    const closed = evaluate(representativeMenuSnapshot, "2026-07-25T12:00:00.000Z");

    expect(closed.locationOpen).toBe(false);
    expect(closed.items[0]?.reason).toBe("location_closed");
  });
});
