import { describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import { representativeSquareFixture } from "../../../tests/fixtures/square/representative";
import {
  listModifierGroupSchema,
  menuSnapshotSchema,
  menuVariationSchema,
} from "./menu";
import { weeklyIntervalSchema } from "./common";

describe("menu contracts", () => {
  it("accepts and serializes the representative normalized snapshot", () => {
    const snapshot = menuSnapshotSchema.parse(representativeMenuSnapshot);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).toContain('"amountMinor":"450"');
    expect(serialized).not.toContain("price_money");
    expect(JSON.parse(serialized)).toEqual(snapshot);
  });

  it("demonstrates that raw Square SDK money cannot cross JSON", () => {
    expect(() => JSON.stringify(representativeSquareFixture)).toThrow(TypeError);
    expect(menuSnapshotSchema.safeParse(representativeSquareFixture).success).toBe(
      false,
    );
  });

  it("rejects fixed variations without prices and variable variations with prices", () => {
    const baseVariation = representativeMenuSnapshot.items[0]?.variations[0];
    expect(baseVariation).toBeDefined();
    if (baseVariation === undefined) {
      return;
    }

    expect(
      menuVariationSchema.safeParse({ ...baseVariation, price: null }).success,
    ).toBe(false);
    expect(
      menuVariationSchema.safeParse({
        ...baseVariation,
        pricingStatus: "variable",
      }).success,
    ).toBe(false);
  });

  it("rejects wrapping and zero-duration normalized weekly intervals", () => {
    expect(
      weeklyIntervalSchema.safeParse({ startMinute: 600, endMinute: 600 })
        .success,
    ).toBe(false);
    expect(
      weeklyIntervalSchema.safeParse({ startMinute: 900, endMinute: 800 })
        .success,
    ).toBe(false);
  });

  it("rejects contradictory or impossible modifier limits", () => {
    const modifierGroup =
      representativeMenuSnapshot.items[0]?.modifierGroups[0];
    expect(modifierGroup?.type).toBe("list");
    if (modifierGroup?.type !== "list") {
      return;
    }

    expect(
      listModifierGroupSchema.safeParse({
        ...modifierGroup,
        minimumSelections: 2,
        maximumSelections: 1,
      }).success,
    ).toBe(false);
    expect(
      listModifierGroupSchema.safeParse({
        ...modifierGroup,
        minimumSelections: 3,
        maximumSelections: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects item references to categories missing from the snapshot", () => {
    const item = representativeMenuSnapshot.items[0];
    expect(item).toBeDefined();
    if (item === undefined) {
      return;
    }

    const invalidSnapshot = {
      ...representativeMenuSnapshot,
      items: [{ ...item, categoryIds: ["CAT_UNKNOWN"] }],
    };

    expect(menuSnapshotSchema.safeParse(invalidSnapshot).success).toBe(false);
  });

  it("rejects duplicate normalized IDs and cross-currency prices", () => {
    const item = representativeMenuSnapshot.items[0];
    const variation = item?.variations[0];
    expect(item).toBeDefined();
    expect(variation).toBeDefined();
    if (item === undefined || variation === undefined) {
      return;
    }

    expect(
      menuSnapshotSchema.safeParse({
        ...representativeMenuSnapshot,
        items: [item, item],
      }).success,
    ).toBe(false);

    expect(
      menuSnapshotSchema.safeParse({
        ...representativeMenuSnapshot,
        items: [
          {
            ...item,
            variations: [
              {
                ...variation,
                price: { amountMinor: "450", currency: "EUR" },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
