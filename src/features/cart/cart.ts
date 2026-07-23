import type { ItemOrderability } from "@/features/menu/availability";
import type {
  CartLine,
  CartModifierSelection,
  CartState,
  MenuItemDto,
  MenuSnapshotDto,
  MoneyDto,
} from "@/shared/contracts";

export const CART_QUANTITY_MAXIMUM = 99;

export interface ModifierDraft {
  readonly list: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly text: Readonly<Record<string, string>>;
}

export type ConfigurationValidation =
  | { readonly valid: true; readonly selections: readonly CartModifierSelection[] }
  | { readonly errors: readonly string[]; readonly valid: false };

export type CartLineBuildResult =
  | { readonly line: CartLine; readonly valid: true }
  | { readonly errors: readonly string[]; readonly valid: false };

export interface CartReconciliation {
  readonly cart: CartState;
  readonly notices: readonly string[];
}

export type CartAction =
  | { readonly type: "add"; readonly line: CartLine }
  | { readonly type: "clear" }
  | { readonly key: string; readonly type: "decrement" }
  | { readonly key: string; readonly type: "increment" }
  | { readonly key: string; readonly type: "remove" }
  | { readonly cart: CartState; readonly type: "replace" }
  | { readonly key: string; readonly quantity: number; readonly type: "set_quantity" };

export function createEmptyCart(locationId: string, currency: string): CartState {
  return { schemaVersion: 1, locationId, currency, lines: [] };
}

export function createDefaultModifierDraft(item: MenuItemDto): ModifierDraft {
  const list: Record<string, Record<string, number>> = {};
  const text: Record<string, string> = {};
  for (const group of item.modifierGroups) {
    if (group.type === "text") {
      text[group.id] = "";
      continue;
    }
    list[group.id] = Object.fromEntries(
      group.options
        .filter((option) => option.defaultSelected)
        .map((option) => [option.id, 1]),
    );
  }
  return { list, text };
}

export function modifierQuantity(draft: ModifierDraft, groupId: string, optionId: string): number {
  return draft.list[groupId]?.[optionId] ?? 0;
}

export function groupSelectionQuantity(draft: ModifierDraft, groupId: string): number {
  return Object.values(draft.list[groupId] ?? {}).reduce((total, quantity) => total + quantity, 0);
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function validQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= CART_QUANTITY_MAXIMUM;
}

/** Converts a modifier draft into validated, current-price cart selections. */
export function validateModifierConfiguration(
  item: MenuItemDto,
  draft: ModifierDraft,
  currency: string,
): ConfigurationValidation {
  const errors: string[] = [];
  const selections: CartModifierSelection[] = [];
  if (item.modifierConfigurationError !== null) {
    return { errors: [item.modifierConfigurationError], valid: false };
  }

  for (const group of item.modifierGroups) {
    if (group.type === "text") {
      const value = draft.text[group.id] ?? "";
      if (group.required && value.trim().length === 0) {
        errors.push(`${group.name} is required.`);
      }
      if (unicodeLength(value) > group.maximumCodePoints) {
        errors.push(`${group.name} must be ${group.maximumCodePoints} characters or fewer.`);
      }
      if (value.length > 0 && unicodeLength(value) <= group.maximumCodePoints) {
        selections.push({ groupId: group.id, name: group.name, type: "text", value });
      }
      continue;
    }

    const selected = draft.list[group.id] ?? {};
    const knownOptions = new Map(group.options.map((option) => [option.id, option]));
    const total = groupSelectionQuantity(draft, group.id);
    if (total < group.minimumSelections) {
      errors.push(`${group.name} requires at least ${group.minimumSelections} selection${group.minimumSelections === 1 ? "" : "s"}.`);
    }
    if (group.maximumSelections > 0 && total > group.maximumSelections) {
      errors.push(`${group.name} allows at most ${group.maximumSelections} selection${group.maximumSelections === 1 ? "" : "s"}.`);
    }
    for (const [optionId, quantity] of Object.entries(selected)) {
      const option = knownOptions.get(optionId);
      if (option === undefined || !validQuantity(quantity)) {
        errors.push(`${group.name} contains an invalid selection.`);
        continue;
      }
      if (!group.allowQuantities && quantity !== 1) {
        errors.push(`${group.name} does not allow modifier quantities.`);
        continue;
      }
      if (option.price.currency !== currency) {
        errors.push(`${group.name} has a price in a different currency.`);
        continue;
      }
      selections.push({
        groupId: group.id,
        name: option.name,
        optionId: option.id,
        quantity,
        type: "list",
        unitPrice: option.price,
      });
    }
  }
  return errors.length > 0 ? { errors, valid: false } : { selections, valid: true };
}

function canonicalSelection(selection: CartModifierSelection): readonly [string, string, string, number | string] {
  return selection.type === "list"
    ? ["list", selection.groupId, selection.optionId, selection.quantity]
    : ["text", selection.groupId, "", selection.value];
}

/** A collision-free, order-independent identity for an item configuration. */
export function canonicalConfigurationKey(
  itemId: string,
  variationId: string,
  selections: readonly CartModifierSelection[],
): string {
  return JSON.stringify([
    itemId,
    variationId,
    ...selections.map(canonicalSelection).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ]);
}

export function createCartLine(
  item: MenuItemDto,
  variationId: string,
  draft: ModifierDraft,
): CartLineBuildResult {
  const variation = item.variations.find((candidate) => candidate.id === variationId);
  if (variation === undefined || !variation.sellable || variation.pricingStatus !== "fixed" || variation.price === null) {
    return { errors: ["Choose an orderable option with a fixed price."], valid: false };
  }
  const validation = validateModifierConfiguration(item, draft, variation.price.currency);
  if (!validation.valid) {
    return { errors: validation.errors, valid: false };
  }
  return {
    line: {
      availability: { status: "active" },
      itemId: item.id,
      itemName: item.name,
      key: canonicalConfigurationKey(item.id, variation.id, validation.selections),
      quantity: 1,
      selections: [...validation.selections],
      unitBasePrice: variation.price,
      variationId: variation.id,
      variationName: variation.name,
    },
    valid: true,
  };
}

function withQuantity(line: CartLine, quantity: number): CartLine | null {
  return quantity < 1 ? null : { ...line, quantity: Math.min(CART_QUANTITY_MAXIMUM, quantity) };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "clear") {
    return { ...state, lines: [] };
  }
  if (action.type === "replace") {
    return action.cart;
  }
  if (action.type === "add") {
    const current = state.lines.find((line) => line.key === action.line.key);
    if (current === undefined) {
      return { ...state, lines: [...state.lines, action.line] };
    }
    return {
      ...state,
      lines: state.lines.map((line) => line.key === action.line.key
        ? { ...action.line, quantity: Math.min(CART_QUANTITY_MAXIMUM, line.quantity + action.line.quantity) }
        : line),
    };
  }
  if (action.type === "remove") {
    return { ...state, lines: state.lines.filter((line) => line.key !== action.key) };
  }
  if (action.type !== "increment" && action.type !== "decrement" && action.type !== "set_quantity") {
    return state;
  }
  return {
    ...state,
    lines: state.lines.flatMap((line) => {
      if (line.key !== action.key) {
        return [line];
      }
      const nextQuantity: number = action.type === "increment"
        ? line.quantity + 1
        : action.type === "decrement"
          ? line.quantity - 1
          : action.quantity;
      const next = withQuantity(line, nextQuantity);
      return next === null ? [] : [next];
    }),
  };
}

function lineUnitTotalMinor(line: CartLine): bigint {
  return line.selections.reduce(
    (total, selection) => total + (selection.type === "list"
      ? BigInt(selection.unitPrice.amountMinor) * BigInt(selection.quantity)
      : 0n),
    BigInt(line.unitBasePrice.amountMinor),
  );
}

/** Exact subtotal of active lines, expressed in the cart currency's minor units. */
export function cartSubtotal(cart: CartState): MoneyDto {
  const amountMinor = cart.lines.reduce(
    (total, line) => line.availability.status === "active"
      ? total + lineUnitTotalMinor(line) * BigInt(line.quantity)
      : total,
    0n,
  );
  return { amountMinor: amountMinor.toString(), currency: cart.currency };
}

function draftFromLine(line: CartLine): ModifierDraft {
  const list: Record<string, Record<string, number>> = {};
  const text: Record<string, string> = {};
  for (const selection of line.selections) {
    if (selection.type === "list") {
      list[selection.groupId] = { ...(list[selection.groupId] ?? {}), [selection.optionId]: selection.quantity };
    } else {
      text[selection.groupId] = selection.value;
    }
  }
  return { list, text };
}

function unavailable(line: CartLine, reason: string): CartLine {
  return { ...line, availability: { reason, status: "unavailable" } };
}

/** Reprices retained configurations and makes changed/removed lines explicit to the guest. */
export function reconcileCart(
  cart: CartState,
  snapshot: MenuSnapshotDto,
  availability: readonly ItemOrderability[],
): CartReconciliation {
  const notices: string[] = [];
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  const orderability = new Map(availability.map((item) => [item.id, item]));
  const lines = cart.lines.map((line) => {
    const item = items.get(line.itemId);
    const itemAvailability = orderability.get(line.itemId);
    const variation = item?.variations.find((candidate) => candidate.id === line.variationId);
    const variationAvailability = itemAvailability?.variations.find((candidate) => candidate.id === line.variationId);
    if (item === undefined || variation === undefined) {
      notices.push(`${line.itemName} is no longer on this menu.`);
      return unavailable(line, "This item is no longer available.");
    }
    if (variationAvailability === undefined || !variationAvailability.orderable) {
      notices.push(`${line.itemName} is currently unavailable.`);
      return unavailable(line, "This selection is currently unavailable.");
    }
    const configured = createCartLine(item, variation.id, draftFromLine(line));
    if (!configured.valid) {
      notices.push(`${line.itemName} needs to be reconfigured.`);
      return unavailable(line, configured.errors.join(" "));
    }
    const repriced = { ...configured.line, availability: { status: "active" as const }, quantity: line.quantity };
    if (
      repriced.unitBasePrice.amountMinor !== line.unitBasePrice.amountMinor ||
      JSON.stringify(repriced.selections) !== JSON.stringify(line.selections)
    ) {
      notices.push(`The price for ${line.itemName} was updated.`);
    }
    return repriced;
  });
  return { cart: { ...cart, currency: snapshot.location.currency, lines }, notices: [...new Set(notices)] };
}
