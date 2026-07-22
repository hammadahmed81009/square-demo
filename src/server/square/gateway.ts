import "server-only";

import {
  InMemoryTtlCache,
  type ServerCachePolicy,
} from "@/server/cache/in-memory";
import {
  getRetryAfterMs,
  getUpstreamStatus,
  SquareGatewayError,
  toSquareGatewayError,
} from "@/server/square/errors";
import { squareGatewayLogger } from "@/server/square/logging";
import {
  MAX_INVENTORY_VARIATION_IDS,
  SQUARE_CATALOG_OBJECT_TYPES,
  type SquareCatalogPage,
  type SquareGatewayEndpoint,
  type SquareGatewayLogger,
  type SquareGatewayRead,
  type SquareInventoryPage,
  type SquareTransport,
} from "@/server/square/types";

const LOCATION_CACHE_POLICY: ServerCachePolicy = {
  freshForMs: 5 * 60_000,
  staleForMs: 15 * 60_000,
};

const CATALOG_CACHE_POLICY: ServerCachePolicy = {
  freshForMs: 60_000,
  staleForMs: 15 * 60_000,
};

const INVENTORY_CACHE_POLICY: ServerCachePolicy = {
  freshForMs: 15_000,
  staleForMs: 15_000,
};

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 200;

interface PagedResult {
  readonly data: readonly unknown[];
  readonly pageCount: number;
}

export interface SquareGatewayDependencies {
  readonly cache?: InMemoryTtlCache<PagedResult>;
  readonly logger?: SquareGatewayLogger;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly transport: SquareTransport;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isActiveLocation(location: unknown): boolean {
  if (typeof location !== "object" || location === null) {
    return false;
  }

  return (location as { status?: unknown }).status === "ACTIVE";
}

function cursorFrom(
  page: Pick<SquareCatalogPage | SquareInventoryPage, "cursor">,
): string | undefined {
  return page.cursor === undefined || page.cursor === "" ? undefined : page.cursor;
}

function chunks(values: readonly string[], size: number): readonly (readonly string[])[] {
  const result: string[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function uniqueSortedIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.filter((id) => id.length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Server-side Square read gateway. It returns only raw, opaque upstream values
 * to PD-03, where all public normalization and Zod validation happens.
 */
export class SquareGateway {
  private readonly cache: InMemoryTtlCache<PagedResult>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: SquareGatewayLogger;

  constructor(private readonly dependencies: SquareGatewayDependencies) {
    this.cache = dependencies.cache ?? new InMemoryTtlCache<PagedResult>();
    this.now = dependencies.now ?? (() => new Date());
    this.random = dependencies.random ?? Math.random;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.logger = dependencies.logger ?? squareGatewayLogger;
  }

  async listActiveLocations(): Promise<SquareGatewayRead<unknown>> {
    return this.readCached("locations", "locations", LOCATION_CACHE_POLICY, async () => {
      const locations = await this.withRetry("locations", () =>
        this.dependencies.transport.listLocations(),
      );

      return {
        data: locations.locations.filter(isActiveLocation),
        pageCount: 1,
      };
    });
  }

  async listCatalogObjects(): Promise<SquareGatewayRead<unknown>> {
    return this.readCached("catalog", "catalog", CATALOG_CACHE_POLICY, async () => {
      return this.fetchCatalogPages();
    });
  }

  async listInventoryCounts(
    locationId: string,
    variationIds: readonly string[],
  ): Promise<SquareGatewayRead<unknown>> {
    if (locationId.length === 0) {
      throw new SquareGatewayError("configuration", false);
    }

    const ids = uniqueSortedIds(variationIds);
    if (ids.length === 0) {
      return {
        data: [],
        fetchedAt: this.now(),
        pageCount: 0,
        source: "upstream",
      };
    }

    const cacheKey = `inventory:${locationId}:${ids.join(",")}`;
    return this.readCached(cacheKey, "inventory", INVENTORY_CACHE_POLICY, async () => {
      const data: unknown[] = [];
      let pageCount = 0;

      for (const batch of chunks(ids, MAX_INVENTORY_VARIATION_IDS)) {
        const result = await this.fetchInventoryPages(locationId, batch);
        data.push(...result.data);
        pageCount += result.pageCount;
      }

      return { data, pageCount };
    });
  }

  private async fetchCatalogPages(): Promise<PagedResult> {
    const data: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const page = await this.withRetry("catalog", () =>
        this.dependencies.transport.listCatalog({
          cursor,
          types: SQUARE_CATALOG_OBJECT_TYPES,
        }),
      );
      data.push(...page.objects);
      pageCount += 1;
      cursor = cursorFrom(page);

      if (cursor !== undefined && cursors.has(cursor)) {
        throw new SquareGatewayError("pagination_cycle", false);
      }
      if (cursor !== undefined) {
        cursors.add(cursor);
      }
    } while (cursor !== undefined);

    return { data, pageCount };
  }

  private async fetchInventoryPages(
    locationId: string,
    catalogObjectIds: readonly string[],
  ): Promise<PagedResult> {
    const data: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const page = await this.withRetry("inventory", () =>
        this.dependencies.transport.batchGetInventoryCounts({
          catalogObjectIds,
          cursor,
          locationId,
          states: ["IN_STOCK"],
        }),
      );
      data.push(...page.counts);
      pageCount += 1;
      cursor = cursorFrom(page);

      if (cursor !== undefined && cursors.has(cursor)) {
        throw new SquareGatewayError("pagination_cycle", false);
      }
      if (cursor !== undefined) {
        cursors.add(cursor);
      }
    } while (cursor !== undefined);

    return { data, pageCount };
  }

  private async readCached(
    key: string,
    endpoint: SquareGatewayEndpoint,
    policy: ServerCachePolicy,
    load: () => Promise<PagedResult>,
  ): Promise<SquareGatewayRead<unknown>> {
    const startedAt = this.now();
    let pageCount = 0;

    try {
      const result = await this.cache.getOrLoad(key, policy, async () => {
        const loaded = await load();
        pageCount = loaded.pageCount;
        return loaded;
      });
      const cachedPageCount = result.value.pageCount;
      this.log({
        cacheSource: result.source,
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
        endpoint,
        outcome: "success",
        pageCount: pageCount || cachedPageCount,
        warningCodes: result.source === "server-stale" ? ["SERVER_STALE"] : [],
      });

      return {
        data: result.value.data,
        fetchedAt: result.fetchedAt,
        pageCount: cachedPageCount,
        source: result.source,
      };
    } catch (error) {
      const gatewayError = toSquareGatewayError(error);
      this.log({
        durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()),
        endpoint,
        outcome: "failure",
        pageCount,
        upstreamStatus: gatewayError.upstreamStatus,
        warningCodes: [gatewayError.code.toUpperCase()],
      });
      throw gatewayError;
    }
  }

  private async withRetry<T>(
    endpoint: SquareGatewayEndpoint,
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const gatewayError = toSquareGatewayError(error);
        if (!gatewayError.retryable || attempt === MAX_RETRIES) {
          throw gatewayError;
        }

        const retryAfterMs = getRetryAfterMs(error);
        const exponentialDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
        const jitter = Math.floor(this.random() * BASE_RETRY_DELAY_MS);
        await this.sleep(Math.max(retryAfterMs ?? 0, exponentialDelay + jitter));

        this.log({
          durationMs: 0,
          endpoint,
          outcome: "failure",
          pageCount: 0,
          upstreamStatus: getUpstreamStatus(error),
          warningCodes: ["RETRYING"],
        });
      }
    }

    throw new SquareGatewayError("unavailable", true);
  }

  private log(event: Parameters<SquareGatewayLogger["log"]>[0]): void {
    this.logger.log(event);
  }
}
