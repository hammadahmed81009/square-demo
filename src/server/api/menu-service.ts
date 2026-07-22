import "server-only";

import {
  locationsDataSchema,
  menuSnapshotSchema,
  type LocationDto,
  type LocationsDataDto,
  type MenuSnapshotDto,
  type WarningDto,
} from "@/shared/contracts";
import { MenuNormalizationError, normalizeLocation, normalizeMenu } from "@/server/menu";
import {
  createSquareSdkTransport,
  SquareGateway,
  type SquareGatewayRead,
  type SquareGatewayReadSource,
} from "@/server/square";

export interface MenuApiGateway {
  listActiveLocations(): Promise<SquareGatewayRead<unknown>>;
  listCatalogObjects(): Promise<SquareGatewayRead<unknown>>;
  listInventoryCounts(
    locationId: string,
    variationIds: readonly string[],
  ): Promise<SquareGatewayRead<unknown>>;
}

export interface ServiceRead<TData> {
  readonly data: TData;
  readonly fetchedAt: Date;
  readonly source: SquareGatewayReadSource;
  readonly warnings: readonly WarningDto[];
}

interface LocationEntry {
  readonly dto: LocationDto;
  readonly raw: unknown;
}

export interface MenuApiServiceDependencies {
  readonly gateway: MenuApiGateway;
  readonly now?: () => Date;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function combineSource(
  sources: readonly SquareGatewayReadSource[],
): SquareGatewayReadSource {
  if (sources.includes("server-stale")) {
    return "server-stale";
  }
  if (sources.includes("server-cache")) {
    return "server-cache";
  }
  return "upstream";
}

function earliestFetchedAt(reads: readonly { readonly fetchedAt: Date }[]): Date {
  return new Date(Math.min(...reads.map((read) => read.fetchedAt.getTime())));
}

function staleWarning(source: SquareGatewayReadSource): readonly WarningDto[] {
  return source === "server-stale"
    ? [{ code: "SERVER_STALE", message: "A complete server-cached snapshot is being shown." }]
    : [];
}

/**
 * Orchestrates raw Square reads into only public, schema-validated DTOs.
 * This service never returns Square SDK values, error payloads, or credentials.
 */
export class MenuApiService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: MenuApiServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async getLocations(): Promise<ServiceRead<LocationsDataDto>> {
    const locationsRead = await this.dependencies.gateway.listActiveLocations();
    const warnings: WarningDto[] = [...staleWarning(locationsRead.source)];
    const seen = new Set<string>();
    const entries: LocationEntry[] = [];

    for (const rawLocation of locationsRead.data) {
      try {
        const dto = normalizeLocation(rawLocation);
        if (seen.has(dto.id)) {
          warnings.push({
            code: "DUPLICATE_LOCATION_ID",
            message: "Duplicate active locations were omitted.",
          });
          continue;
        }
        seen.add(dto.id);
        entries.push({ dto, raw: rawLocation });
      } catch (error) {
        if (error instanceof MenuNormalizationError) {
          warnings.push({
            code: "MALFORMED_LOCATION",
            message: "A malformed active location was omitted.",
          });
          continue;
        }
        throw error;
      }
    }

    const locations = entries
      .map((entry) => entry.dto)
      .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
    return {
      data: locationsDataSchema.parse({ locations }),
      fetchedAt: locationsRead.fetchedAt,
      source: locationsRead.source,
      warnings,
    };
  }

  async getMenu(locationId: string): Promise<ServiceRead<MenuSnapshotDto> | null> {
    const locationsRead = await this.dependencies.gateway.listActiveLocations();
    const locationEntry = this.normalizeLocations(locationsRead.data).find(
      (entry) => entry.dto.id === locationId,
    );
    if (locationEntry === undefined) {
      return null;
    }

    const catalogRead = await this.dependencies.gateway.listCatalogObjects();
    const generatedAt = this.now();
    const preInventoryMenu = normalizeMenu({
      catalog: catalogRead.data,
      generatedAt,
      location: locationEntry.raw,
    });
    const variationIds = preInventoryMenu.snapshot.items.flatMap((item) =>
      item.variations.map((variation) => variation.id),
    );
    let inventoryRead: SquareGatewayRead<unknown> | undefined;
    let inventoryStatus: MenuSnapshotDto["inventoryStatus"] = "fresh";
    const warnings: WarningDto[] = [
      ...staleWarning(locationsRead.source),
      ...staleWarning(catalogRead.source),
    ];

    if (variationIds.length > 0) {
      try {
        inventoryRead = await this.dependencies.gateway.listInventoryCounts(
          locationId,
          variationIds,
        );
        warnings.push(...staleWarning(inventoryRead.source));
      } catch {
        inventoryStatus = "unavailable";
        warnings.push({
          code: "INVENTORY_UNAVAILABLE",
          message: "Live inventory could not be loaded; stock may be unknown.",
        });
      }
    }

    const normalized = normalizeMenu({
      catalog: catalogRead.data,
      generatedAt,
      inventory: inventoryRead?.data,
      inventoryStatus,
      location: locationEntry.raw,
    });
    warnings.push(...normalized.warnings);
    const reads = inventoryRead === undefined
      ? [locationsRead, catalogRead]
      : [locationsRead, catalogRead, inventoryRead];
    return {
      data: menuSnapshotSchema.parse(normalized.snapshot),
      fetchedAt: earliestFetchedAt(reads),
      source: combineSource(reads.map((read) => read.source)),
      warnings,
    };
  }

  private normalizeLocations(rawLocations: readonly unknown[]): readonly LocationEntry[] {
    const locations: LocationEntry[] = [];
    const seen = new Set<string>();
    for (const rawLocation of rawLocations) {
      try {
        const dto = normalizeLocation(rawLocation);
        if (!seen.has(dto.id)) {
          seen.add(dto.id);
          locations.push({ dto, raw: rawLocation });
        }
      } catch (error) {
        if (!(error instanceof MenuNormalizationError)) {
          throw error;
        }
      }
    }
    return locations;
  }
}

let defaultMenuApiService: MenuApiService | undefined;

export function getMenuApiService(): MenuApiService {
  if (defaultMenuApiService === undefined) {
    defaultMenuApiService = new MenuApiService({
      gateway: new SquareGateway({ transport: createSquareSdkTransport() }),
    });
  }
  return defaultMenuApiService;
}
