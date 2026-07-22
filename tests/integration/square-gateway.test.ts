import { describe, expect, it } from "vitest";

import { InMemoryTtlCache } from "@/server/cache/in-memory";
import { SquareGatewayError } from "@/server/square/errors";
import { SquareGateway } from "@/server/square/gateway";
import {
  MAX_INVENTORY_VARIATION_IDS,
  SQUARE_CATALOG_OBJECT_TYPES,
  type SquareTransport,
} from "@/server/square/types";
import {
  squareCatalogFixture,
  squareLocationsFixture,
} from "../fixtures/square/representative";

function createTransport(overrides: Partial<SquareTransport> = {}): SquareTransport {
  return {
    async listLocations() {
      return { locations: squareLocationsFixture };
    },
    async listCatalog() {
      return { objects: squareCatalogFixture };
    },
    async batchGetInventoryCounts() {
      return { counts: [] };
    },
    ...overrides,
  };
}

function silentLogger() {
  return { log(): void {} };
}

describe("SquareGateway", () => {
  it("filters locations, uses explicit catalog types, and coalesces concurrent reads", async () => {
    let locationCalls = 0;
    let catalogCalls = 0;
    const requestedTypes: string[][] = [];
    const gateway = new SquareGateway({
      logger: silentLogger(),
      transport: createTransport({
        async listLocations() {
          locationCalls += 1;
          return {
            locations: [
              ...squareLocationsFixture,
              { id: "LOC_CLOSED", status: "INACTIVE" },
            ],
          };
        },
        async listCatalog(request) {
          catalogCalls += 1;
          requestedTypes.push([...request.types]);
          await Promise.resolve();
          return { objects: squareCatalogFixture };
        },
      }),
    });

    const [firstLocations, secondLocations, firstCatalog, secondCatalog] = await Promise.all([
      gateway.listActiveLocations(),
      gateway.listActiveLocations(),
      gateway.listCatalogObjects(),
      gateway.listCatalogObjects(),
    ]);

    expect(locationCalls).toBe(1);
    expect(firstLocations.data).toHaveLength(squareLocationsFixture.length);
    expect(secondLocations.source).toBe("upstream");
    expect(catalogCalls).toBe(1);
    expect(requestedTypes).toEqual([[...SQUARE_CATALOG_OBJECT_TYPES]]);
    expect(firstCatalog.data).toHaveLength(squareCatalogFixture.length);
    expect(secondCatalog.pageCount).toBe(1);
  });

  it("collects every catalog page and rejects a repeated pagination cursor", async () => {
    const cursors: Array<string | undefined> = [];
    const paginatedGateway = new SquareGateway({
      logger: silentLogger(),
      transport: createTransport({
        async listCatalog(request) {
          cursors.push(request.cursor);
          return request.cursor === undefined
            ? { cursor: "second-page", objects: [{ id: "first" }] }
            : { objects: [{ id: "second" }] };
        },
      }),
    });

    const catalog = await paginatedGateway.listCatalogObjects();

    expect(cursors).toEqual([undefined, "second-page"]);
    expect(catalog.data).toEqual([{ id: "first" }, { id: "second" }]);
    expect(catalog.pageCount).toBe(2);

    const loopingGateway = new SquareGateway({
      logger: silentLogger(),
      transport: createTransport({
        async listCatalog() {
          return { cursor: "same-cursor", objects: [{ id: "partial" }] };
        },
      }),
    });

    await expect(loopingGateway.listCatalogObjects()).rejects.toMatchObject({
      code: "pagination_cycle",
      retryable: false,
    });
  });

  it("batches inventory at 1,000 IDs and follows every cursor in each batch", async () => {
    const requests: Array<{
      readonly catalogObjectIds: readonly string[];
      readonly cursor?: string;
      readonly states: readonly ["IN_STOCK"];
    }> = [];
    const variationIds = Array.from(
      { length: MAX_INVENTORY_VARIATION_IDS + 1 },
      (_, index) => `VAR_${String(index).padStart(4, "0")}`,
    );
    const gateway = new SquareGateway({
      logger: silentLogger(),
      transport: createTransport({
        async batchGetInventoryCounts(request) {
          requests.push({
            catalogObjectIds: request.catalogObjectIds,
            cursor: request.cursor,
            states: request.states,
          });
          if (request.catalogObjectIds.length === MAX_INVENTORY_VARIATION_IDS) {
            return request.cursor === undefined
              ? { counts: [{ id: "first-page" }], cursor: "next" }
              : { counts: [{ id: "second-page" }] };
          }

          return { counts: [{ id: "last-batch" }] };
        },
      }),
    });

    const inventory = await gateway.listInventoryCounts("LOC_DOWNTOWN", variationIds);

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.catalogObjectIds.length)).toEqual([
      1000, 1000, 1,
    ]);
    expect(requests.map((request) => request.cursor)).toEqual([
      undefined,
      "next",
      undefined,
    ]);
    expect(requests.every((request) => request.states[0] === "IN_STOCK")).toBe(true);
    expect(inventory.data).toHaveLength(3);
    expect(inventory.pageCount).toBe(3);
  });

  it("retries rate limits and timeouts at most twice, honoring Retry-After", async () => {
    let rateLimitedCalls = 0;
    const rateLimitDelays: number[] = [];
    const rateLimitGateway = new SquareGateway({
      logger: silentLogger(),
      random: () => 0,
      sleep: async (milliseconds) => {
        rateLimitDelays.push(milliseconds);
      },
      transport: createTransport({
        async listLocations() {
          rateLimitedCalls += 1;
          if (rateLimitedCalls < 3) {
            throw Object.assign(new Error("rate limited"), {
              headers: new Headers({ "retry-after": "1" }),
              statusCode: 429,
            });
          }

          return { locations: squareLocationsFixture };
        },
      }),
    });

    await expect(rateLimitGateway.listActiveLocations()).resolves.toMatchObject({
      source: "upstream",
    });
    expect(rateLimitedCalls).toBe(3);
    expect(rateLimitDelays).toEqual([1_000, 1_000]);

    let timeoutCalls = 0;
    const timeoutDelays: number[] = [];
    const timeoutGateway = new SquareGateway({
      logger: silentLogger(),
      random: () => 0,
      sleep: async (milliseconds) => {
        timeoutDelays.push(milliseconds);
      },
      transport: createTransport({
        async listLocations() {
          timeoutCalls += 1;
          throw new Error("timed out");
        },
      }),
    });

    await expect(timeoutGateway.listActiveLocations()).rejects.toBeInstanceOf(
      SquareGatewayError,
    );
    expect(timeoutCalls).toBe(3);
    expect(timeoutDelays).toEqual([200, 400]);
  });

  it("uses a complete stale catalog after a later page fails and never returns a partial result", async () => {
    let nowMs = Date.parse("2026-07-23T09:00:00.000Z");
    let shouldFail = false;
    let catalogCalls = 0;
    const gateway = new SquareGateway({
      cache: new InMemoryTtlCache(() => new Date(nowMs)),
      logger: silentLogger(),
      now: () => new Date(nowMs),
      random: () => 0,
      sleep: async () => {},
      transport: createTransport({
        async listCatalog(request) {
          catalogCalls += 1;
          if (request.cursor === undefined) {
            return { cursor: "later", objects: [{ id: "complete-first" }] };
          }
          if (shouldFail) {
            throw Object.assign(new Error("upstream unavailable"), { statusCode: 503 });
          }

          return { objects: [{ id: "complete-second" }] };
        },
      }),
    });

    const fresh = await gateway.listCatalogObjects();
    nowMs += 60_001;
    shouldFail = true;
    const stale = await gateway.listCatalogObjects();

    expect(fresh.data).toEqual([{ id: "complete-first" }, { id: "complete-second" }]);
    expect(stale.source).toBe("server-stale");
    expect(stale.data).toEqual(fresh.data);
    // Initial complete read is two pages. The failed second page is retried at
    // most twice before the complete cached snapshot becomes server-stale.
    expect(catalogCalls).toBe(6);
  });
});
