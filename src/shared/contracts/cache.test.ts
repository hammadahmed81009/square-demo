import { describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import { createCacheEnvelopeSchema, readCacheEnvelope } from "./cache";
import { menuSnapshotSchema } from "./menu";

const cacheFixture = {
  schemaVersion: 1,
  kind: "menu:LOC_DOWNTOWN",
  cachedAt: "2026-07-23T08:00:00.000Z",
  expiresAt: "2026-07-24T08:00:00.000Z",
  payload: representativeMenuSnapshot,
};

describe("cache envelope contract", () => {
  it("reads a valid, unexpired, correctly typed cache entry", () => {
    const schema = createCacheEnvelopeSchema(
      "menu:LOC_DOWNTOWN",
      menuSnapshotSchema,
    );
    expect(schema.safeParse(cacheFixture).success).toBe(true);

    expect(
      readCacheEnvelope(
        cacheFixture,
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
        new Date("2026-07-23T12:00:00.000Z"),
      ),
    ).toEqual({
      status: "hit",
      payload: representativeMenuSnapshot,
      cachedAt: cacheFixture.cachedAt,
      expiresAt: cacheFixture.expiresAt,
    });
  });

  it("discards expired, cross-key, and unsupported-version entries", () => {
    expect(
      readCacheEnvelope(
        cacheFixture,
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
        new Date("2026-07-24T08:00:00.000Z"),
      ),
    ).toEqual({ status: "discarded", reason: "expired" });

    expect(
      readCacheEnvelope(
        cacheFixture,
        "menu:LOC_AIRPORT",
        menuSnapshotSchema,
      ),
    ).toEqual({ status: "discarded", reason: "wrong-kind" });

    expect(
      readCacheEnvelope(
        { ...cacheFixture, schemaVersion: 2 },
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
      ),
    ).toEqual({ status: "discarded", reason: "unsupported-version" });
  });

  it("discards corrupt payloads and invalid cache ranges", () => {
    expect(
      readCacheEnvelope(
        { ...cacheFixture, payload: { schemaVersion: 1 } },
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
      ),
    ).toEqual({ status: "discarded", reason: "invalid" });

    expect(
      readCacheEnvelope(
        { ...cacheFixture, expiresAt: cacheFixture.cachedAt },
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
      ),
    ).toEqual({ status: "discarded", reason: "invalid" });

    expect(
      readCacheEnvelope(
        { ...cacheFixture, expiresAt: "2026-07-24T08:00:01.000Z" },
        "menu:LOC_DOWNTOWN",
        menuSnapshotSchema,
      ),
    ).toEqual({ status: "discarded", reason: "invalid" });
  });
});
