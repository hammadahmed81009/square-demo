import { describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";

import {
  filterMenuItems,
  formatMoney,
  itemMatchesSearch,
  normalizeSearch,
} from "./browse-utils";

describe("menu browse utilities", () => {
  it("normalizes Unicode and matches every search token across browse fields", () => {
    const item = representativeMenuSnapshot.items[0];
    if (item === undefined) {
      throw new Error("Representative fixture must include an item");
    }

    expect(normalizeSearch("  Caf\u00e9\u00a0LATTE ")).toEqual(["cafe", "latte"]);
    expect(itemMatchesSearch(item, representativeMenuSnapshot.categories, "espresso milk")).toBe(true);
    expect(itemMatchesSearch(item, representativeMenuSnapshot.categories, "espresso matcha")).toBe(false);
  });

  it("intersects a category filter and search without duplicating items", () => {
    const item = representativeMenuSnapshot.items[0];
    const variation = item?.variations[0];
    if (item === undefined || variation === undefined) {
      throw new Error("Representative fixture must include an item variation");
    }
    const tea = {
      ...item,
      id: "ITEM_TEA",
      name: "Matcha Tea",
      description: "Ceremonial green tea.",
      categoryIds: ["CAT_BREAKFAST"],
      variations: [{ ...variation, id: "VAR_TEA", name: "Ceremonial" }],
    };
    const snapshot = { ...representativeMenuSnapshot, items: [item, tea] };

    expect(filterMenuItems(snapshot, "CAT_BREAKFAST", "tea").map(({ id }) => id)).toEqual(["ITEM_TEA"]);
    expect(filterMenuItems(snapshot, null, "espresso").map(({ id }) => id)).toEqual(["ITEM_LATTE"]);
  });

  it("formats minor units with currency-specific fraction digits without floating point", () => {
    expect(formatMoney({ amountMinor: "1234", currency: "USD" }, "en-US")).toBe("$12.34");
    expect(formatMoney({ amountMinor: "1234", currency: "JPY" }, "en-US")).toContain("1,234");
    expect(formatMoney({ amountMinor: "1234", currency: "BHD" }, "en-US")).toContain("1.234");
  });
});
