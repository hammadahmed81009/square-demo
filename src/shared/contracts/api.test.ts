import { z } from "zod";
import { describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import {
  apiErrorSchema,
  createApiResponseSchema,
  createApiSuccessSchema,
} from "./api";
import { locationSchema, menuSnapshotSchema } from "./menu";

const requestId = "00000000-0000-4000-8000-000000000001";

describe("API envelope contracts", () => {
  it("accepts a menu success response and rejects undeclared fields", () => {
    const successSchema = createApiSuccessSchema(menuSnapshotSchema);
    const response = {
      data: representativeMenuSnapshot,
      meta: {
        schemaVersion: 1,
        requestId,
        fetchedAt: "2026-07-23T08:00:02.000Z",
        source: "upstream",
        warnings: [],
      },
    };

    expect(successSchema.safeParse(response).success).toBe(true);
    expect(
      successSchema.safeParse({ ...response, squareAccessToken: "forbidden" })
        .success,
    ).toBe(false);
  });

  it("accepts only the locked public error codes", () => {
    const response = {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "The menu service is temporarily unavailable.",
        retryable: true,
        requestId,
      },
    };

    expect(apiErrorSchema.safeParse(response).success).toBe(true);
    expect(
      apiErrorSchema.safeParse({
        error: { ...response.error, code: "SQUARE_RAW_ERROR" },
      }).success,
    ).toBe(false);
  });

  it("builds reusable response contracts for location arrays", () => {
    const locationsResponseSchema = createApiResponseSchema(
      z.array(locationSchema),
    );
    const response = {
      data: [representativeMenuSnapshot.location],
      meta: {
        schemaVersion: 1,
        requestId,
        fetchedAt: "2026-07-23T08:00:02.000Z",
        source: "server-cache",
        warnings: [
          { code: "CACHE_HIT", message: "Locations came from cache." },
        ],
      },
    };

    expect(locationsResponseSchema.safeParse(response).success).toBe(true);
  });
});
