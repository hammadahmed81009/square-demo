import { describe, expect, it } from "vitest";

import { cartStateSchema, restoreCartState, type CartState } from "./cart";

const cartFixture: CartState = {
  schemaVersion: 1,
  locationId: "LOC_DOWNTOWN",
  currency: "USD",
  lines: [
    {
      key: "ITEM_LATTE|VAR_LATTE_SMALL|MOD_OAT:1",
      itemId: "ITEM_LATTE",
      variationId: "VAR_LATTE_SMALL",
      itemName: "House Latte",
      variationName: "Small",
      quantity: 2,
      unitBasePrice: { amountMinor: "450", currency: "USD" },
      selections: [
        {
          type: "list",
          groupId: "MOD_MILK",
          optionId: "MOD_OAT",
          name: "Oat milk",
          quantity: 1,
          unitPrice: { amountMinor: "100", currency: "USD" },
        },
        {
          type: "text",
          groupId: "MOD_CUP_NAME",
          name: "Name on cup",
          value: "Ada",
        },
      ],
      availability: { status: "active" },
    },
  ],
};

describe("cart persistence contract", () => {
  it("restores a valid current-version cart", () => {
    expect(cartStateSchema.safeParse(cartFixture).success).toBe(true);
    expect(restoreCartState(cartFixture)).toEqual({
      status: "restored",
      cart: cartFixture,
    });
    expect(() => JSON.stringify(cartFixture)).not.toThrow();
  });

  it("discards unsupported versions instead of guessing a migration", () => {
    expect(restoreCartState({ ...cartFixture, schemaVersion: 2 })).toEqual({
      status: "discarded",
      reason: "unsupported-version",
    });
  });

  it("discards malformed current-version state", () => {
    expect(
      restoreCartState({ ...cartFixture, lines: [{ quantity: 0 }] }),
    ).toEqual({ status: "discarded", reason: "invalid" });
  });

  it("rejects line and modifier currencies that differ from the cart", () => {
    const line = cartFixture.lines[0];
    expect(line).toBeDefined();
    if (line === undefined) {
      return;
    }

    expect(
      cartStateSchema.safeParse({
        ...cartFixture,
        lines: [
          {
            ...line,
            unitBasePrice: { amountMinor: "450", currency: "EUR" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
