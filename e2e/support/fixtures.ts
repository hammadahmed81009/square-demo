import type { Page } from "@playwright/test";

import type { LocationDto, MenuSnapshotDto } from "../../src/shared/contracts";

export const REQUEST_ID = "00000000-0000-4000-8000-0000000000e2";

const openWeek = [{ startMinute: 0, endMinute: 10_080 }] as const;

export const downtownLocation: LocationDto = {
  id: "LOC_DOWNTOWN",
  name: "Downtown",
  addressLines: ["100 Main Street", "New York, NY 10001"],
  timezone: "America/New_York",
  timezoneStatus: "valid",
  locale: "en-US",
  currency: "USD",
  businessHours: [...openWeek],
};

export const uptownLocation: LocationDto = {
  ...downtownLocation,
  id: "LOC_UPTOWN",
  name: "Uptown",
  addressLines: ["500 Park Avenue", "New York, NY 10022"],
};

function baseLatte(overrides: Partial<MenuSnapshotDto["items"][number]> = {}): MenuSnapshotDto["items"][number] {
  return {
    id: "ITEM_LATTE",
    name: "House Latte",
    description: "Espresso with steamed milk.",
    imageUrl: null,
    categoryIds: ["CAT_COFFEE"],
    ordinal: 1,
    scheduleWindows: null,
    variations: [
      {
        id: "VAR_LATTE_SMALL",
        name: "Small",
        ordinal: 1,
        sellable: true,
        pricingStatus: "fixed",
        price: { amountMinor: "450", currency: "USD" },
        imageUrl: null,
        inventoryState: "in_stock",
        inventoryUpdatedAt: "2026-07-23T08:00:00.000Z",
        soldOutUntil: null,
      },
      {
        id: "VAR_LATTE_LARGE",
        name: "Large",
        ordinal: 2,
        sellable: true,
        pricingStatus: "fixed",
        price: { amountMinor: "550", currency: "USD" },
        imageUrl: null,
        inventoryState: "sold_out",
        inventoryUpdatedAt: "2026-07-23T08:00:00.000Z",
        soldOutUntil: null,
      },
    ],
    modifierGroups: [
      {
        id: "MOD_MILK",
        type: "list",
        name: "Milk",
        ordinal: 1,
        minimumSelections: 1,
        maximumSelections: 1,
        allowQuantities: false,
        options: [
          {
            id: "MOD_WHOLE",
            name: "Whole milk",
            ordinal: 1,
            price: { amountMinor: "0", currency: "USD" },
            defaultSelected: true,
          },
          {
            id: "MOD_OAT",
            name: "Oat milk",
            ordinal: 2,
            price: { amountMinor: "100", currency: "USD" },
            defaultSelected: false,
          },
        ],
      },
      {
        id: "MOD_CUP_NAME",
        type: "text",
        name: "Name on cup",
        ordinal: 2,
        required: false,
        maximumCodePoints: 24,
      },
    ],
    modifierConfigurationError: null,
    ...overrides,
  };
}

export function downtownMenu(): MenuSnapshotDto {
  return {
    schemaVersion: 1,
    location: downtownLocation,
    categories: [
      {
        id: "CAT_COFFEE",
        name: "Coffee",
        ordinal: 1,
        parentId: "CAT_BREAKFAST",
        kind: "menu",
        scheduleWindows: null,
      },
      {
        id: "CAT_BREAKFAST",
        name: "Breakfast",
        ordinal: 2,
        parentId: null,
        kind: "menu",
        scheduleWindows: null,
      },
    ],
    items: [
      baseLatte(),
      {
        ...baseLatte({
          id: "ITEM_NIGHTCAP",
          name: "Nightcap Espresso",
          description: "Only during late service.",
          categoryIds: ["CAT_COFFEE"],
          scheduleWindows: [],
          variations: [
            {
              id: "VAR_NIGHTCAP",
              name: "Single",
              ordinal: 1,
              sellable: true,
              pricingStatus: "fixed",
              price: { amountMinor: "300", currency: "USD" },
              imageUrl: null,
              inventoryState: "in_stock",
              inventoryUpdatedAt: "2026-07-23T08:00:00.000Z",
              soldOutUntil: null,
            },
          ],
          modifierGroups: [],
        }),
      },
      {
        ...baseLatte({
          id: "ITEM_TEA",
          name: "Matcha Tea",
          description: "Ceremonial green tea.",
          categoryIds: ["CAT_BREAKFAST"],
          variations: [
            {
              id: "VAR_TEA",
              name: "Ceremonial",
              ordinal: 1,
              sellable: true,
              pricingStatus: "fixed",
              price: { amountMinor: "500", currency: "USD" },
              imageUrl: null,
              inventoryState: "in_stock",
              inventoryUpdatedAt: "2026-07-23T08:00:00.000Z",
              soldOutUntil: null,
            },
          ],
          modifierGroups: [],
        }),
      },
    ],
    inventoryStatus: "fresh",
    generatedAt: "2026-07-23T08:00:01.000Z",
    catalogUpdatedAt: "2026-07-20T10:10:00.000Z",
  };
}

export function uptownMenu(): MenuSnapshotDto {
  return {
    ...downtownMenu(),
    location: uptownLocation,
    items: [
      baseLatte({
        id: "ITEM_COLD_BREW",
        name: "Uptown Cold Brew",
        description: "Location-only cold brew.",
        categoryIds: ["CAT_COFFEE"],
        modifierGroups: [],
        variations: [
          {
            id: "VAR_COLD_BREW",
            name: "Regular",
            ordinal: 1,
            sellable: true,
            pricingStatus: "fixed",
            price: { amountMinor: "475", currency: "USD" },
            imageUrl: null,
            inventoryState: "in_stock",
            inventoryUpdatedAt: "2026-07-23T08:00:00.000Z",
            soldOutUntil: null,
          },
        ],
      }),
    ],
  };
}

export function apiSuccess<T>(data: T, source: "upstream" | "server-cache" | "server-stale" = "upstream") {
  return {
    data,
    meta: {
      fetchedAt: "2026-07-23T08:00:01.000Z",
      requestId: REQUEST_ID,
      schemaVersion: 1,
      source,
      warnings: [] as const,
    },
  };
}

export async function mockMenuApis(
  page: Page,
  options: {
    readonly locations?: readonly LocationDto[];
    readonly menus?: Readonly<Record<string, MenuSnapshotDto>>;
  } = {},
): Promise<void> {
  const locations = options.locations ?? [downtownLocation, uptownLocation];
  const menus = options.menus ?? {
    LOC_DOWNTOWN: downtownMenu(),
    LOC_UPTOWN: uptownMenu(),
  };

  await page.route("**/api/locations**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(apiSuccess({ locations: [...locations] })),
    });
  });

  await page.route("**/api/menu**", async (route) => {
    const url = new URL(route.request().url());
    const locationId = url.searchParams.get("locationId") ?? "LOC_DOWNTOWN";
    const menu = menus[locationId];
    if (menu === undefined) {
      await route.fulfill({
        contentType: "application/json",
        status: 404,
        body: JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "Location not found.",
            requestId: REQUEST_ID,
            retryable: false,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(apiSuccess(menu)),
    });
  });
}
