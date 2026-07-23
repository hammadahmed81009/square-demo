import { get } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import {
  CACHE_SCHEMA_VERSION,
  MAX_BROWSER_CACHE_AGE_MS,
} from "@/shared/contracts";

import {
  LOCATIONS_CACHE_KEY,
  deleteLocationsCache,
  deleteMenuCache,
  markInventoryStale,
  menuCacheKey,
  readLocationsCache,
  readMenuCache,
  writeLocationsCache,
  writeMenuCache,
} from "./browser-cache";

const locationsPayload = {
  locations: [representativeMenuSnapshot.location],
};

describe("browser cache", () => {
  beforeEach(async () => {
    await deleteMenuCache("LOC_DOWNTOWN");
    await deleteLocationsCache();
  });

  it("round-trips validated locations and menu envelopes", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    await writeLocationsCache(locationsPayload, now);
    await writeMenuCache("LOC_DOWNTOWN", representativeMenuSnapshot, now);

    await expect(readLocationsCache(now)).resolves.toEqual({
      status: "hit",
      payload: locationsPayload,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MAX_BROWSER_CACHE_AGE_MS).toISOString(),
    });
    await expect(readMenuCache("LOC_DOWNTOWN", now)).resolves.toEqual({
      status: "hit",
      payload: representativeMenuSnapshot,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MAX_BROWSER_CACHE_AGE_MS).toISOString(),
    });
  });

  it("discards expired entries and deletes only the affected key", async () => {
    const cachedAt = new Date("2026-07-22T08:00:00.000Z");
    await writeMenuCache("LOC_DOWNTOWN", representativeMenuSnapshot, cachedAt);
    await writeLocationsCache(locationsPayload, new Date("2026-07-23T12:00:00.000Z"));

    await expect(
      readMenuCache("LOC_DOWNTOWN", new Date("2026-07-23T12:00:00.000Z")),
    ).resolves.toEqual({ status: "discarded", reason: "expired" });
    await expect(get(menuCacheKey("LOC_DOWNTOWN"))).resolves.toBeUndefined();
    await expect(readLocationsCache(new Date("2026-07-23T12:00:00.000Z"))).resolves.toMatchObject({
      status: "hit",
    });
  });

  it("discards corrupt envelopes and unsupported schema versions", async () => {
    const { set } = await import("idb-keyval");
    await set(menuCacheKey("LOC_DOWNTOWN"), {
      schemaVersion: CACHE_SCHEMA_VERSION,
      kind: "menu:LOC_DOWNTOWN",
      cachedAt: "2026-07-23T08:00:00.000Z",
      expiresAt: "2026-07-24T08:00:00.000Z",
      payload: { schemaVersion: 1 },
    });
    await expect(readMenuCache("LOC_DOWNTOWN")).resolves.toEqual({
      status: "discarded",
      reason: "invalid",
    });
    await expect(get(menuCacheKey("LOC_DOWNTOWN"))).resolves.toBeUndefined();

    await set(LOCATIONS_CACHE_KEY, {
      schemaVersion: 99,
      kind: "locations",
      cachedAt: "2026-07-23T08:00:00.000Z",
      expiresAt: "2026-07-24T08:00:00.000Z",
      payload: locationsPayload,
    });
    await expect(readLocationsCache()).resolves.toEqual({
      status: "discarded",
      reason: "unsupported-version",
    });
  });

  it("marks cached inventory unknown without clearing schedule windows", () => {
    const stale = markInventoryStale(representativeMenuSnapshot);
    expect(stale.items[0]?.variations.every((variation) => variation.inventoryState === "unknown")).toBe(true);
    expect(stale.items[0]?.scheduleWindows).toEqual(representativeMenuSnapshot.items[0]?.scheduleWindows);
  });
});
