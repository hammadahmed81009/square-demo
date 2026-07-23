import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";

import { evaluateMenuOrderability } from "@/features/menu/availability";
import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";

import { cartReducer, createEmptyCart } from "./cart";
import { CartPanel, ItemConfigurator } from "./cart-ui";

function CartFixture() {
  const [cart, dispatch] = useReducer(cartReducer, createEmptyCart("LOC_DOWNTOWN", "USD"));
  const item = representativeMenuSnapshot.items[0];
  if (item === undefined) {
    throw new Error("Representative fixture must include a latte");
  }
  const availability = evaluateMenuOrderability({
    isOnline: true,
    isSnapshotFresh: true,
    now: new Date("2026-07-27T12:00:00.000Z"),
    snapshot: representativeMenuSnapshot,
  }).items[0];
  return (
    <>
      <ItemConfigurator availability={availability} canMutate currency="USD" item={item} locale="en-US" onAdd={(line) => dispatch({ line, type: "add" })} />
      <CartPanel canMutate controls={{ cart, clear: () => dispatch({ type: "clear" }), decrement: (key) => dispatch({ key, type: "decrement" }), increment: (key) => dispatch({ key, type: "increment" }), remove: (key) => dispatch({ key, type: "remove" }) }} locale="en-US" notices={[]} />
    </>
  );
}

describe("cart controls", () => {
  it("automatically selects the sole orderable variation, adds defaults, and maintains an exact subtotal", async () => {
    const user = userEvent.setup();
    render(<CartFixture />);

    expect(screen.getByRole("radio", { name: /small/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getByText("Whole milk")).toBeInTheDocument();
    expect(screen.getByText("Active subtotal").parentElement).toHaveTextContent("$4.50");

    await user.click(screen.getByRole("button", { name: "Increase House Latte quantity" }));
    expect(screen.getByText("Active subtotal").parentElement).toHaveTextContent("$9.00");
  });
});
