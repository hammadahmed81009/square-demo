import { z } from "zod";

import { currencyCodeSchema, identifierSchema, moneySchema } from "./common";

export const CART_SCHEMA_VERSION = 1 as const;

export const listModifierSelectionSchema = z
  .object({
    type: z.literal("list"),
    groupId: identifierSchema,
    optionId: identifierSchema,
    name: z.string().trim().min(1).max(255),
    quantity: z.number().int().min(1).max(99),
    unitPrice: moneySchema,
  })
  .strict();

export const textModifierSelectionSchema = z
  .object({
    type: z.literal("text"),
    groupId: identifierSchema,
    name: z.string().trim().min(1).max(255),
    value: z.string().min(1).max(10_000),
  })
  .strict();

export const cartModifierSelectionSchema = z.discriminatedUnion("type", [
  listModifierSelectionSchema,
  textModifierSelectionSchema,
]);

export type CartModifierSelection = z.infer<
  typeof cartModifierSelectionSchema
>;

export const cartLineAvailabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active") }).strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export const cartLineSchema = z
  .object({
    key: z.string().trim().min(1).max(2048),
    itemId: identifierSchema,
    variationId: identifierSchema,
    itemName: z.string().trim().min(1).max(512),
    variationName: z.string().trim().min(1).max(255),
    quantity: z.number().int().min(1).max(99),
    unitBasePrice: moneySchema,
    selections: z.array(cartModifierSelectionSchema),
    availability: cartLineAvailabilitySchema,
  })
  .strict()
  .superRefine((line, context) => {
    for (const [selectionIndex, selection] of line.selections.entries()) {
      if (
        selection.type === "list" &&
        selection.unitPrice.currency !== line.unitBasePrice.currency
      ) {
        context.addIssue({
          code: "custom",
          message: "Modifier currency must match the base price currency",
          path: ["selections", selectionIndex, "unitPrice", "currency"],
        });
      }
    }
  });

export type CartLine = z.infer<typeof cartLineSchema>;

export const cartStateSchema = z
  .object({
    schemaVersion: z.literal(CART_SCHEMA_VERSION),
    locationId: identifierSchema,
    currency: currencyCodeSchema,
    lines: z.array(cartLineSchema),
  })
  .strict()
  .superRefine((cart, context) => {
    for (const [lineIndex, line] of cart.lines.entries()) {
      if (line.unitBasePrice.currency !== cart.currency) {
        context.addIssue({
          code: "custom",
          message: "Cart line currency must match the cart currency",
          path: ["lines", lineIndex, "unitBasePrice", "currency"],
        });
      }
    }
  });

export type CartState = z.infer<typeof cartStateSchema>;

export type CartRestoreResult =
  | { status: "restored"; cart: CartState }
  | { status: "discarded"; reason: "invalid" | "unsupported-version" };

const persistedVersionSchema = z.object({ schemaVersion: z.number().int() });

export function restoreCartState(value: unknown): CartRestoreResult {
  const version = persistedVersionSchema.safeParse(value);
  if (!version.success) {
    return { status: "discarded", reason: "invalid" };
  }

  if (version.data.schemaVersion !== CART_SCHEMA_VERSION) {
    return { status: "discarded", reason: "unsupported-version" };
  }

  const cart = cartStateSchema.safeParse(value);
  if (!cart.success) {
    return { status: "discarded", reason: "invalid" };
  }

  return { status: "restored", cart: cart.data };
}
