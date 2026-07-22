import { describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  createApiSuccessSchema,
  locationsDataSchema,
  menuSnapshotSchema,
} from "@/shared/contracts";
import { handleLocations, handleMenu } from "@/server/api/handlers";
import { MenuApiService, type MenuApiGateway } from "@/server/api/menu-service";
import { SquareGatewayError } from "@/server/square/errors";
import { SquareGateway } from "@/server/square/gateway";
import type { SquareTransport } from "@/server/square/types";
import {
  squareCatalogFixture,
  squareInventoryFixture,
  squareLocationsFixture,
} from "../fixtures/square/representative";

function silentLogger() {
  return { log(): void {} };
}

function createTransport(overrides: Partial<SquareTransport> = {}): SquareTransport {
  return {
    async batchGetInventoryCounts() {
      return { counts: squareInventoryFixture };
    },
    async listCatalog() {
      return { objects: squareCatalogFixture };
    },
    async listLocations() {
      return { locations: squareLocationsFixture };
    },
    ...overrides,
  };
}

function createService(
  transport: SquareTransport = createTransport(),
): MenuApiService {
  return new MenuApiService({
    gateway: new SquareGateway({ logger: silentLogger(), transport }),
    now: () => new Date("2026-07-23T09:00:00.000Z"),
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json();
}

describe("API handler contracts", () => {
  it("returns normalized active locations in the public success envelope", async () => {
    const response = await handleLocations(createService());
    const body = createApiSuccessSchema(locationsDataSchema).parse(
      await responseBody(response),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(body.meta.requestId);
    expect(body.meta.source).toBe("upstream");
    expect(body.data.locations.map((location) => location.id)).toEqual([
      "LOC_AIRPORT",
      "LOC_DOWNTOWN",
    ]);
  });

  it("returns a fully serialized normalized menu and uses cache source metadata", async () => {
    const service = createService();
    const request = new Request("http://per-diem.test/api/menu?locationId=LOC_DOWNTOWN");
    const first = await handleMenu(request, service);
    const firstBody = createApiSuccessSchema(menuSnapshotSchema).parse(
      await responseBody(first),
    );
    const second = await handleMenu(request, service);
    const secondBody = createApiSuccessSchema(menuSnapshotSchema).parse(
      await responseBody(second),
    );
    const serialized = JSON.stringify(firstBody);

    expect(first.status).toBe(200);
    expect(firstBody.data.location.id).toBe("LOC_DOWNTOWN");
    expect(firstBody.data.inventoryStatus).toBe("fresh");
    expect(firstBody.data.items.map((item) => item.id)).toContain("ITEM_LATTE");
    expect(serialized).not.toContain("price_money");
    expect(serialized).not.toContain("access_token");
    expect(secondBody.meta.source).toBe("server-cache");
  });

  it("rejects malformed IDs without gateway calls and unknown locations without catalog calls", async () => {
    let locationCalls = 0;
    let catalogCalls = 0;
    const transport = createTransport({
      async listCatalog() {
        catalogCalls += 1;
        return { objects: squareCatalogFixture };
      },
      async listLocations() {
        locationCalls += 1;
        return { locations: squareLocationsFixture };
      },
    });
    const service = createService(transport);
    const invalid = await handleMenu(
      new Request("http://per-diem.test/api/menu?locationId=bad%20id"),
      service,
    );
    const unknown = await handleMenu(
      new Request("http://per-diem.test/api/menu?locationId=LOC_UNKNOWN"),
      service,
    );

    expect(invalid.status).toBe(400);
    expect(locationCalls).toBe(1);
    expect(catalogCalls).toBe(0);
    expect(unknown.status).toBe(404);
    expect(apiErrorSchema.parse(await responseBody(invalid)).error.code).toBe("BAD_REQUEST");
  });

  it("returns a usable menu with an explicit warning when inventory fails", async () => {
    const service = createService(
      createTransport({
        async batchGetInventoryCounts() {
          throw Object.assign(new Error("inventory provider unavailable"), {
            statusCode: 503,
          });
        },
      }),
    );
    const response = await handleMenu(
      new Request("http://per-diem.test/api/menu?locationId=LOC_DOWNTOWN"),
      service,
    );
    const body = createApiSuccessSchema(menuSnapshotSchema).parse(
      await responseBody(response),
    );

    expect(response.status).toBe(200);
    expect(body.data.inventoryStatus).toBe("unavailable");
    expect(body.meta.warnings.map((warning) => warning.code)).toContain(
      "INVENTORY_UNAVAILABLE",
    );
  });

  it("never exposes upstream messages or credentials in failure envelopes", async () => {
    const unsafeGateway: MenuApiGateway = {
      async listActiveLocations() {
        throw new Error("Bearer square-sandbox-secret-token raw upstream payload");
      },
      async listCatalogObjects() {
        return { data: [], fetchedAt: new Date(), pageCount: 0, source: "upstream" };
      },
      async listInventoryCounts() {
        return { data: [], fetchedAt: new Date(), pageCount: 0, source: "upstream" };
      },
    };
    const service = new MenuApiService({ gateway: unsafeGateway });
    const response = await handleLocations(service);
    const serialized = JSON.stringify(await responseBody(response));

    expect(response.status).toBe(500);
    expect(serialized).toContain("INTERNAL_ERROR");
    expect(serialized).not.toContain("square-sandbox-secret-token");
    expect(serialized).not.toContain("raw upstream payload");
  });

  it("maps sanitized Square rate limits to the fixed retryable API error", async () => {
    const rateLimitedGateway: MenuApiGateway = {
      async listActiveLocations() {
        throw new SquareGatewayError("rate_limited", true, 429);
      },
      async listCatalogObjects() {
        return { data: [], fetchedAt: new Date(), pageCount: 0, source: "upstream" };
      },
      async listInventoryCounts() {
        return { data: [], fetchedAt: new Date(), pageCount: 0, source: "upstream" };
      },
    };
    const response = await handleLocations(new MenuApiService({ gateway: rateLimitedGateway }));
    const body = apiErrorSchema.parse(await responseBody(response));

    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({
      code: "UPSTREAM_RATE_LIMITED",
      retryable: true,
    });
  });
});
