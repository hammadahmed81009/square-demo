import { describe, expect, it } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import { evaluateMenuOrderability } from "@/features/menu/availability";

import {
  canonicalConfigurationKey,
  cartReducer,
  cartSubtotal,
  createCartLine,
  createDefaultModifierDraft,
  createEmptyCart,
  reconcileCart,
  validateModifierConfiguration,
} from "./cart";

function latte() {
  const item = representativeMenuSnapshot.items[0];
  if (item === undefined) {
    throw new Error("Representative fixture must include a latte");
  }
  return item;
}

describe("cart domain", () => {
  it("uses effective defaults, validates required modifiers, and builds a stable key", () => {
    const item = latte();
    const draft = createDefaultModifierDraft(item);
    const result = createCartLine(item, "VAR_LATTE_SMALL", draft);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.line.selections).toHaveLength(1);
    expect(canonicalConfigurationKey(item.id, "VAR_LATTE_SMALL", result.line.selections)).toBe(result.line.key);

    expect(validateModifierConfiguration(item, {
      list: { MOD_MILK: {} },
      text: { MOD_CUP_NAME: "" },
    }, "USD")).toMatchObject({ valid: false });

    expect(validateModifierConfiguration(item, {
      ...draft,
      text: { MOD_CUP_NAME: "😀".repeat(24) },
    }, "USD")).toMatchObject({ valid: true });
    expect(validateModifierConfiguration(item, {
      ...draft,
      text: { MOD_CUP_NAME: "😀".repeat(25) },
    }, "USD")).toMatchObject({ valid: false });
  });

  it("merges equal configurations, enforces quantity limits, and totals in bigint minor units", () => {
    const item = latte();
    const built = createCartLine(item, "VAR_LATTE_SMALL", createDefaultModifierDraft(item));
    if (!built.valid) {
      throw new Error("Default latte configuration must be valid");
    }
    let cart = createEmptyCart("LOC_DOWNTOWN", "USD");
    cart = cartReducer(cart, { line: built.line, type: "add" });
    cart = cartReducer(cart, { line: built.line, type: "add" });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(2);
    expect(cartSubtotal(cart)).toEqual({ amountMinor: "900", currency: "USD" });

    cart = cartReducer(cart, { key: built.line.key, quantity: 120, type: "set_quantity" });
    expect(cart.lines[0]?.quantity).toBe(99);
  });

  it("reprices active lines and excludes unavailable lines after a menu refresh", () => {
    const item = latte();
    const built = createCartLine(item, "VAR_LATTE_SMALL", createDefaultModifierDraft(item));
    if (!built.valid) {
      throw new Error("Default latte configuration must be valid");
    }
    const cart = { ...createEmptyCart("LOC_DOWNTOWN", "USD"), lines: [{ ...built.line, quantity: 2 }] };
    const repricedItem = {
      ...item,
      variations: item.variations.map((variation) => variation.id === "VAR_LATTE_SMALL"
        ? { ...variation, price: { amountMinor: "500", currency: "USD" } }
        : variation),
    };
    const snapshot = { ...representativeMenuSnapshot, items: [repricedItem] };
    const availability = evaluateMenuOrderability({
      isOnline: true,
      isSnapshotFresh: true,
      now: new Date("2026-07-27T12:00:00.000Z"),
      snapshot,
    }).items;
    const reconciliation = reconcileCart(cart, snapshot, availability);
    expect(reconciliation.cart.lines[0]?.unitBasePrice.amountMinor).toBe("500");
    expect(reconciliation.notices).toContain("The price for House Latte was updated.");

    const withoutItem = reconcileCart(cart, { ...snapshot, items: [] }, []);
    expect(withoutItem.cart.lines[0]?.availability.status).toBe("unavailable");
    expect(cartSubtotal(withoutItem.cart)).toEqual({ amountMinor: "0", currency: "USD" });
  });
});
