"use client";

import { del, get, set } from "idb-keyval";
import type { z } from "zod";

import {
  CACHE_SCHEMA_VERSION,
  MAX_BROWSER_CACHE_AGE_MS,
  locationsDataSchema,
  menuSnapshotSchema,
  readCacheEnvelope,
  type CacheReadResult,
  type LocationsDataDto,
  type MenuSnapshotDto,
} from "@/shared/contracts";

export const LOCATIONS_CACHE_KIND = "locations" as const;
export const LOCATIONS_CACHE_KEY = "per-diem:cache:locations";

export function menuCacheKind(locationId: string): `menu:${string}` {
  return `menu:${locationId}`;
}

export function menuCacheKey(locationId: string): string {
  return `per-diem:cache:menu:${locationId}`;
}

type CacheEnvelope<TKind extends string, TPayload> = {
  readonly schemaVersion: typeof CACHE_SCHEMA_VERSION;
  readonly kind: TKind;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly payload: TPayload;
};

function buildEnvelope<TKind extends string, TPayload>(
  kind: TKind,
  payload: TPayload,
  now: Date,
): CacheEnvelope<TKind, TPayload> {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    kind,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MAX_BROWSER_CACHE_AGE_MS).toISOString(),
    payload,
  };
}

async function readValidatedCache<TKind extends string, TPayload>(
  key: string,
  kind: TKind,
  payloadSchema: z.ZodType<TPayload>,
  now: Date,
): Promise<CacheReadResult<TPayload>> {
  let raw: unknown;
  try {
    raw = await get(key);
  } catch {
    await del(key).catch(() => undefined);
    return { status: "discarded", reason: "invalid" };
  }

  if (raw === undefined) {
    return { status: "discarded", reason: "invalid" };
  }

  const result = readCacheEnvelope(raw, kind, payloadSchema, now);
  if (result.status === "discarded") {
    await del(key).catch(() => undefined);
  }
  return result as CacheReadResult<TPayload>;
}

/**
 * Marks cached inventory untrusted while keeping schedule windows intact so
 * the client can re-evaluate availability against the current clock.
 */
export function markInventoryStale(snapshot: MenuSnapshotDto): MenuSnapshotDto {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      variations: item.variations.map((variation) => ({
        ...variation,
        inventoryState: "unknown",
        inventoryUpdatedAt: null,
        soldOutUntil: null,
      })),
    })),
  };
}

export async function readLocationsCache(
  now: Date = new Date(),
): Promise<CacheReadResult<LocationsDataDto>> {
  return readValidatedCache(
    LOCATIONS_CACHE_KEY,
    LOCATIONS_CACHE_KIND,
    locationsDataSchema,
    now,
  );
}

export async function writeLocationsCache(
  payload: LocationsDataDto,
  now: Date = new Date(),
): Promise<void> {
  const parsed = locationsDataSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  try {
    await set(
      LOCATIONS_CACHE_KEY,
      buildEnvelope(LOCATIONS_CACHE_KIND, parsed.data, now),
    );
  } catch {
    // Browser storage failures must never block menu browsing.
  }
}

export async function deleteLocationsCache(): Promise<void> {
  await del(LOCATIONS_CACHE_KEY).catch(() => undefined);
}

export async function readMenuCache(
  locationId: string,
  now: Date = new Date(),
): Promise<CacheReadResult<MenuSnapshotDto>> {
  return readValidatedCache(
    menuCacheKey(locationId),
    menuCacheKind(locationId),
    menuSnapshotSchema,
    now,
  );
}

export async function writeMenuCache(
  locationId: string,
  payload: MenuSnapshotDto,
  now: Date = new Date(),
): Promise<void> {
  if (payload.location.id !== locationId) {
    return;
  }
  const parsed = menuSnapshotSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  try {
    await set(
      menuCacheKey(locationId),
      buildEnvelope(menuCacheKind(locationId), parsed.data, now),
    );
  } catch {
    // Browser storage failures must never block menu browsing.
  }
}

export async function deleteMenuCache(locationId: string): Promise<void> {
  await del(menuCacheKey(locationId)).catch(() => undefined);
}
