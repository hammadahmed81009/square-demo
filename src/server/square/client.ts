import "server-only";

import { SquareClient, SquareEnvironment } from "square";

import { getServerEnvironment } from "@/server/env";
import {
  SQUARE_API_VERSION,
  SQUARE_ENVIRONMENT,
} from "@/server/square/config";
import type {
  SquareCatalogPage,
  SquareCatalogPageRequest,
  SquareInventoryPage,
  SquareInventoryPageRequest,
  SquareLocationsPage,
  SquareTransport,
} from "@/server/square/types";

const SQUARE_TIMEOUT_SECONDS = 10;

let squareClient: SquareClient | undefined;

/**
 * Construct the SDK client only on first server use. The fixed Sandbox
 * environment, API version, and zero SDK retries make this application's
 * boundary deterministic; retry policy lives in the gateway.
 */
export function getSquareClient(): SquareClient {
  if (squareClient !== undefined) {
    return squareClient;
  }

  const environment = getServerEnvironment();
  squareClient = new SquareClient({
    token: environment.SQUARE_ACCESS_TOKEN,
    environment: SquareEnvironment.Sandbox,
    version: SQUARE_API_VERSION,
    timeoutInSeconds: SQUARE_TIMEOUT_SECONDS,
    maxRetries: 0,
  });

  return squareClient;
}

/** Visible for isolated server tests; it is never used by application code. */
export function resetSquareClientForTests(): void {
  squareClient = undefined;
}

export function createSquareSdkTransport(
  clientFactory: () => SquareClient = getSquareClient,
): SquareTransport {
  return {
    async listLocations(): Promise<SquareLocationsPage> {
      const response = await clientFactory().locations.list({
        version: SQUARE_API_VERSION,
        timeoutInSeconds: SQUARE_TIMEOUT_SECONDS,
        maxRetries: 0,
      });

      return { locations: response.locations ?? [] };
    },
    async listCatalog(
      request: SquareCatalogPageRequest,
    ): Promise<SquareCatalogPage> {
      const page = await clientFactory().catalog.list(
        {
          cursor: request.cursor,
          types: request.types.join(","),
        },
        {
          version: SQUARE_API_VERSION,
          timeoutInSeconds: SQUARE_TIMEOUT_SECONDS,
          maxRetries: 0,
        },
      );
      const response = page.response;

      return {
        cursor: response.cursor,
        objects: response.objects ?? [],
      };
    },
    async batchGetInventoryCounts(
      request: SquareInventoryPageRequest,
    ): Promise<SquareInventoryPage> {
      const page = await clientFactory().inventory.batchGetCounts(
        {
          catalogObjectIds: [...request.catalogObjectIds],
          cursor: request.cursor,
          locationIds: [request.locationId],
          states: [...request.states],
        },
        {
          version: SQUARE_API_VERSION,
          timeoutInSeconds: SQUARE_TIMEOUT_SECONDS,
          maxRetries: 0,
        },
      );
      const response = page.response;

      return {
        counts: response.counts ?? [],
        cursor: response.cursor,
      };
    },
  };
}

// Keep the locked deployment environment referenced at this boundary so an
// accidental config expansion cannot silently create a client-controlled host.
void SQUARE_ENVIRONMENT;
