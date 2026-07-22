import { describe, expect, it } from "vitest";

import {
  archivedCatalogFixture,
  categoryCycleFixture,
  deletedCatalogFixture,
  duplicateCatalogFixture,
  incompleteCatalogFixture,
  malformedCatalogFixture,
} from "../../../tests/fixtures/square/edge-cases";
import {
  squareCatalogFixture,
  squareInventoryFixture,
  squareLocationsFixture,
} from "../../../tests/fixtures/square/representative";
import { normalizeMenu } from "./normalize";

const generatedAt = new Date("2026-07-23T09:00:00.000Z");

function menuFor(
  locationIndex: number,
  catalog: readonly unknown[] = squareCatalogFixture,
  inventory: readonly unknown[] | undefined = squareInventoryFixture,
) {
  const location = squareLocationsFixture[locationIndex];
  if (location === undefined) {
    throw new Error("Fixture location is missing");
  }
  return normalizeMenu({ catalog, generatedAt, inventory, location });
}

function simpleItem(
  id: string,
  categoryIds: readonly string[] = [],
  variation: Record<string, unknown> = {},
) {
  return {
    id,
    is_deleted: false,
    present_at_all_locations: true,
    type: "ITEM",
    item_data: {
      categories: categoryIds.map((categoryId, ordinal) => ({ id: categoryId, ordinal })),
      name: id,
      variations: [
        {
          id: `${id}_VAR`,
          present_at_all_locations: true,
          type: "ITEM_VARIATION",
          item_variation_data: {
            name: "Regular",
            pricing_type: "FIXED_PRICING",
            price_money: { amount: BigInt(500), currency: "USD" },
            sellable: true,
            ...variation,
          },
        },
      ],
    },
  };
}

describe("normalizeMenu", () => {
  it("applies parent and variation location presence, price overrides, and safe serialization", () => {
    const downtown = menuFor(0);
    const airport = menuFor(1);
    const downtownLatte = downtown.snapshot.items.find((item) => item.id === "ITEM_LATTE");
    const airportLatte = airport.snapshot.items.find((item) => item.id === "ITEM_LATTE");
    const airportCroissant = airport.snapshot.items.find(
      (item) => item.id === "ITEM_CROISSANT",
    );

    expect(downtown.snapshot.items.map((item) => item.id)).toEqual([
      "ITEM_CROISSANT",
      "ITEM_SANDWICH",
      "ITEM_LATTE",
    ]);
    expect(airport.snapshot.items.map((item) => item.id)).toEqual([
      "ITEM_CROISSANT",
      "ITEM_LATTE",
    ]);
    expect(downtownLatte?.variations.map((variation) => variation.id)).toEqual([
      "VAR_LATTE_SMALL",
      "VAR_LATTE_LARGE",
    ]);
    expect(airportLatte?.variations.map((variation) => variation.id)).toEqual([
      "VAR_LATTE_SMALL",
    ]);
    expect(airportLatte?.variations[0]?.price).toEqual({
      amountMinor: "500",
      currency: "USD",
    });
    expect(airportCroissant?.variations[0]?.inventoryState).toBe("sold_out");
    const oatMilk = airportLatte?.modifierGroups[0];
    expect(oatMilk?.type === "list" ? oatMilk.options[1]?.price.amountMinor : null).toBe(
      "150",
    );
    expect(airportLatte?.modifierGroups[1]).toMatchObject({ type: "text" });
    expect(JSON.stringify(airport.snapshot)).not.toContain("price_money");
    expect(JSON.stringify(airport.snapshot)).not.toContain("BigInt");
  });

  it("prefers menu categories, falls back to regular categories, and puts uncategorized items in Other", () => {
    const catalog = [
      {
        id: "CAT_MENU",
        type: "CATEGORY",
        category_data: { category_type: "MENU_CATEGORY", name: "Menu" },
      },
      {
        id: "CAT_REGULAR",
        type: "CATEGORY",
        category_data: { category_type: "REGULAR_CATEGORY", name: "Regular" },
      },
      simpleItem("ITEM_BOTH", ["CAT_MENU", "CAT_REGULAR"]),
      simpleItem("ITEM_OTHER", ["CAT_MISSING"]),
    ];

    const result = menuFor(0, catalog, []);
    const both = result.snapshot.items.find((item) => item.id === "ITEM_BOTH");
    const other = result.snapshot.items.find((item) => item.id === "ITEM_OTHER");

    expect(both?.categoryIds).toEqual(["CAT_MENU"]);
    expect(other?.categoryIds).toEqual(["OTHER"]);
    expect(result.snapshot.categories.map((category) => category.id)).toEqual([
      "CAT_MENU",
      "OTHER",
    ]);
  });

  it("normalizes inherited and overnight schedules, while invalid referenced periods fail closed", () => {
    const catalog = [
      {
        id: "PERIOD_OVERNIGHT",
        type: "AVAILABILITY_PERIOD",
        availability_period_data: {
          day_of_week: "MON",
          end_local_time: "02:00:00",
          start_local_time: "22:00:00",
        },
      },
      {
        id: "CAT_ROOT",
        type: "CATEGORY",
        category_data: {
          availability_period_ids: ["PERIOD_OVERNIGHT"],
          category_type: "MENU_CATEGORY",
          name: "Root",
        },
      },
      {
        id: "CAT_CHILD",
        type: "CATEGORY",
        category_data: {
          category_type: "MENU_CATEGORY",
          name: "Child",
          parent_category: { id: "CAT_ROOT", ordinal: 1 },
        },
      },
      {
        id: "CAT_INVALID",
        type: "CATEGORY",
        category_data: {
          availability_period_ids: ["PERIOD_MISSING"],
          category_type: "MENU_CATEGORY",
          name: "Invalid",
        },
      },
      simpleItem("ITEM_CHILD", ["CAT_CHILD"]),
      simpleItem("ITEM_INVALID", ["CAT_INVALID"]),
    ];

    const result = menuFor(0, catalog, []);
    const child = result.snapshot.categories.find((category) => category.id === "CAT_CHILD");
    const invalid = result.snapshot.categories.find(
      (category) => category.id === "CAT_INVALID",
    );
    const childItem = result.snapshot.items.find((item) => item.id === "ITEM_CHILD");

    expect(child?.scheduleWindows).toEqual([
      { startMinute: 1320, endMinute: 1440 },
      { startMinute: 1440, endMinute: 1560 },
    ]);
    expect(childItem?.scheduleWindows).toEqual(child?.scheduleWindows);
    expect(invalid?.scheduleWindows).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "INVALID_CATEGORY_SCHEDULE",
    );
  });

  it("preserves explicit empty business hours as configured-closed rather than missing", () => {
    const location = squareLocationsFixture[0];
    if (location === undefined) {
      throw new Error("Fixture location is missing");
    }
    const result = normalizeMenu({
      catalog: [simpleItem("ITEM_HOURS")],
      generatedAt,
      inventory: [],
      location: { ...location, business_hours: { periods: [] } },
    });

    expect(result.snapshot.location.businessHours).toEqual([]);
  });

  it("breaks missing parents and category cycles without emitting invalid public hierarchy", () => {
    const catalog = [
      ...categoryCycleFixture,
      {
        id: "CAT_ORPHAN",
        type: "CATEGORY",
        category_data: {
          category_type: "MENU_CATEGORY",
          name: "Orphan",
          parent_category: { id: "CAT_GONE", ordinal: 1 },
        },
      },
      simpleItem("ITEM_CYCLE", ["CAT_CYCLE_A"]),
      simpleItem("ITEM_ORPHAN", ["CAT_ORPHAN"]),
    ];

    const result = menuFor(0, catalog, []);
    const cycleA = result.snapshot.categories.find((category) => category.id === "CAT_CYCLE_A");
    const cycleB = result.snapshot.categories.find((category) => category.id === "CAT_CYCLE_B");
    const orphan = result.snapshot.categories.find((category) => category.id === "CAT_ORPHAN");

    expect(cycleA?.parentId).toBeNull();
    expect(cycleB?.parentId).toBeNull();
    expect(orphan?.parentId).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["CATEGORY_CYCLE", "MISSING_CATEGORY_PARENT"]),
    );
  });

  it("keeps malformed fixed and variable prices browseable but not fixed-price orderable", () => {
    const catalog = [
      simpleItem("ITEM_FIXED_MALFORMED", [], { price_money: { amount: "not-an-int", currency: "USD" } }),
      simpleItem("ITEM_VARIABLE", [], { pricing_type: "VARIABLE_PRICING", price_money: undefined }),
      simpleItem("ITEM_CURRENCY", [], { price_money: { amount: BigInt(500), currency: "EUR" } }),
    ];
    const result = menuFor(0, catalog, []);
    const fixed = result.snapshot.items.find((item) => item.id === "ITEM_FIXED_MALFORMED");
    const variable = result.snapshot.items.find((item) => item.id === "ITEM_VARIABLE");
    const currency = result.snapshot.items.find((item) => item.id === "ITEM_CURRENCY");

    expect(fixed?.variations[0]).toMatchObject({ pricingStatus: "invalid", price: null });
    expect(variable?.variations[0]).toMatchObject({ pricingStatus: "variable", price: null });
    expect(currency?.variations[0]).toMatchObject({ pricingStatus: "invalid", price: null });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["CURRENCY_MISMATCH", "INVALID_MONEY"]),
    );
  });

  it("applies modifier overrides and reports impossible required modifier configurations", () => {
    const catalog = [
      {
        id: "MOD_LIST",
        present_at_all_locations: true,
        type: "MODIFIER_LIST",
        modifier_list_data: {
          allow_quantities: false,
          max_selected_modifiers: 2,
          min_selected_modifiers: 1,
          modifier_type: "LIST",
          modifiers: [
            {
              id: "MOD_OPTION",
              modifier_data: {
                name: "Option",
                on_by_default: false,
                ordinal: 2,
                price_money: { amount: BigInt(100), currency: "USD" },
              },
            },
          ],
          name: "Choices",
        },
      },
      {
        id: "MOD_BAD",
        present_at_all_locations: true,
        type: "MODIFIER_LIST",
        modifier_list_data: {
          allow_quantities: false,
          min_selected_modifiers: 2,
          modifier_type: "LIST",
          modifiers: [
            {
              id: "MOD_BAD_OPTION",
              modifier_data: {
                name: "Only option",
                price_money: { amount: BigInt(0), currency: "USD" },
              },
            },
          ],
          name: "Invalid choices",
        },
      },
      {
        id: "ITEM_MODIFIERS",
        present_at_all_locations: true,
        type: "ITEM",
        item_data: {
          modifier_list_info: [
            {
              max_selected_modifiers: 1,
              min_selected_modifiers: 1,
              modifier_list_id: "MOD_LIST",
              modifier_overrides: [
                {
                  modifier_id: "MOD_OPTION",
                  on_by_default: true,
                  ordinal: 1,
                  price_money: { amount: BigInt(250), currency: "USD" },
                },
              ],
            },
            { modifier_list_id: "MOD_BAD" },
          ],
          name: "Modifier item",
          variations: [
            {
              id: "VAR_MODIFIERS",
              present_at_all_locations: true,
              item_variation_data: {
                name: "Regular",
                pricing_type: "FIXED_PRICING",
                price_money: { amount: BigInt(500), currency: "USD" },
              },
            },
          ],
        },
      },
    ];

    const result = menuFor(0, catalog, []);
    const item = result.snapshot.items[0];
    const group = item?.modifierGroups[0];

    expect(group).toMatchObject({ id: "MOD_LIST", type: "list" });
    expect(group?.type === "list" ? group.options[0] : undefined).toMatchObject({
      defaultSelected: true,
      ordinal: 1,
      price: { amountMinor: "250", currency: "USD" },
    });
    expect(item?.modifierConfigurationError).toBe(
      "A required modifier configuration is invalid.",
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "INVALID_MODIFIER_LIMITS",
    );
  });

  it("omits deleted, archived, incomplete, and malformed records while resolving duplicate IDs", () => {
    const catalog = [
      malformedCatalogFixture,
      incompleteCatalogFixture,
      archivedCatalogFixture,
      deletedCatalogFixture,
      ...duplicateCatalogFixture,
      simpleItem("ITEM_DUPLICATE_CATEGORY", ["CAT_DUPLICATE"]),
    ];

    const result = menuFor(0, catalog, []);

    expect(result.snapshot.items.map((item) => item.id)).toEqual([
      "ITEM_DUPLICATE_CATEGORY",
    ]);
    expect(result.snapshot.categories[0]).toMatchObject({
      id: "CAT_DUPLICATE",
      name: "Newer duplicate",
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_CATALOG_ID", "ITEM_WITHOUT_LOCATION_VARIATION"]),
    );
  });
});
