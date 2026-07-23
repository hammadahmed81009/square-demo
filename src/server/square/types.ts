import "server-only";

export const SQUARE_CATALOG_OBJECT_TYPES = [
  "ITEM",
  "CATEGORY",
  "IMAGE",
  "MODIFIER_LIST",
  "AVAILABILITY_PERIOD",
] as const;

export type SquareCatalogObjectType = (typeof SQUARE_CATALOG_OBJECT_TYPES)[number];

export const MAX_INVENTORY_VARIATION_IDS = 1_000;

export interface SquareCatalogPageRequest {
  readonly cursor?: string;
  readonly types: readonly SquareCatalogObjectType[];
}

export interface SquareInventoryPageRequest {
  readonly catalogObjectIds: readonly string[];
  readonly cursor?: string;
  readonly locationId: string;
  readonly states: readonly ["IN_STOCK"];
}

/**
 * Square responses are intentionally opaque here. Runtime validation and
 * normalization own the conversion to public DTOs; keeping `unknown` prevents
 * a raw SDK shape or bigint value from accidentally crossing into a public API
 * contract.
 */
export interface SquareLocationsPage {
  readonly locations: readonly unknown[];
}

export interface SquareCatalogPage {
  readonly cursor?: string;
  readonly objects: readonly unknown[];
}

export interface SquareInventoryPage {
  readonly counts: readonly unknown[];
  readonly cursor?: string;
}

export interface SquareTransport {
  listLocations(): Promise<SquareLocationsPage>;
  listCatalog(request: SquareCatalogPageRequest): Promise<SquareCatalogPage>;
  batchGetInventoryCounts(
    request: SquareInventoryPageRequest,
  ): Promise<SquareInventoryPage>;
}

export type SquareGatewayReadSource = "upstream" | "server-cache" | "server-stale";

export interface SquareGatewayRead<T> {
  readonly data: readonly T[];
  readonly fetchedAt: Date;
  readonly pageCount: number;
  readonly source: SquareGatewayReadSource;
}

export type SquareGatewayEndpoint = "locations" | "catalog" | "inventory";

export interface SquareGatewayLogEvent {
  readonly cacheSource?: SquareGatewayReadSource;
  readonly durationMs: number;
  readonly endpoint: SquareGatewayEndpoint;
  readonly outcome: "success" | "failure";
  readonly pageCount: number;
  readonly upstreamStatus?: number;
  readonly warningCodes: readonly string[];
}

export interface SquareGatewayLogger {
  log(event: SquareGatewayLogEvent): void;
}
