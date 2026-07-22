import { z } from "zod";

import {
  currencyCodeSchema,
  httpsUrlSchema,
  identifierSchema,
  isoDateTimeSchema,
  localeSchema,
  moneySchema,
  PUBLIC_SCHEMA_VERSION,
  weeklyIntervalSchema,
} from "./common";

export const timezoneStatusSchema = z.enum(["valid", "missing", "invalid"]);

export const locationSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(255),
    addressLines: z.array(z.string().trim().min(1).max(255)).max(8),
    timezone: z.string().trim().min(1).max(64).nullable(),
    timezoneStatus: timezoneStatusSchema,
    locale: localeSchema,
    currency: currencyCodeSchema,
    businessHours: z.array(weeklyIntervalSchema).nullable(),
  })
  .strict()
  .superRefine((location, context) => {
    if (
      location.timezoneStatus !== "missing" &&
      location.timezone === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A valid timezone status requires a timezone",
        path: ["timezone"],
      });
    }

    if (location.timezoneStatus === "missing" && location.timezone !== null) {
      context.addIssue({
        code: "custom",
        message: "A missing timezone status requires a null timezone",
        path: ["timezone"],
      });
    }
  });

export type LocationDto = z.infer<typeof locationSchema>;

export const categorySchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(255),
    ordinal: z.number().int().min(0),
    parentId: identifierSchema.nullable(),
    kind: z.enum(["menu", "regular", "synthetic"]),
    scheduleWindows: z.array(weeklyIntervalSchema).nullable(),
  })
  .strict();

export type CategoryDto = z.infer<typeof categorySchema>;

export const inventoryStateSchema = z.enum([
  "in_stock",
  "sold_out",
  "untracked",
  "unknown",
]);

export const pricingStatusSchema = z.enum(["fixed", "variable", "invalid"]);

export const menuVariationSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(255),
    ordinal: z.number().int().min(0),
    sellable: z.boolean(),
    pricingStatus: pricingStatusSchema,
    price: moneySchema.nullable(),
    imageUrl: httpsUrlSchema.nullable(),
    inventoryState: inventoryStateSchema,
    inventoryUpdatedAt: isoDateTimeSchema.nullable(),
    soldOutUntil: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((variation, context) => {
    if (variation.pricingStatus === "fixed" && variation.price === null) {
      context.addIssue({
        code: "custom",
        message: "Fixed pricing requires a price",
        path: ["price"],
      });
    }

    if (variation.pricingStatus !== "fixed" && variation.price !== null) {
      context.addIssue({
        code: "custom",
        message: "Only fixed pricing can expose a price",
        path: ["price"],
      });
    }
  });

export type MenuVariationDto = z.infer<typeof menuVariationSchema>;

export const modifierOptionSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(255),
    ordinal: z.number().int().min(0),
    price: moneySchema,
    defaultSelected: z.boolean(),
  })
  .strict();

export type ModifierOptionDto = z.infer<typeof modifierOptionSchema>;

export const listModifierGroupSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("list"),
    name: z.string().trim().min(1).max(255),
    ordinal: z.number().int().min(0),
    minimumSelections: z.number().int().min(0),
    maximumSelections: z.number().int().min(0),
    allowQuantities: z.boolean(),
    options: z.array(modifierOptionSchema).min(1),
  })
  .strict()
  .superRefine((group, context) => {
    if (
      group.maximumSelections !== 0 &&
      group.maximumSelections < group.minimumSelections
    ) {
      context.addIssue({
        code: "custom",
        message: "Maximum selections cannot be lower than minimum selections",
        path: ["maximumSelections"],
      });
    }

    if (
      !group.allowQuantities &&
      group.minimumSelections > group.options.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Required selections exceed the available options",
        path: ["minimumSelections"],
      });
    }
  });

export const textModifierGroupSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("text"),
    name: z.string().trim().min(1).max(255),
    ordinal: z.number().int().min(0),
    required: z.boolean(),
    maximumCodePoints: z.number().int().min(1).max(10_000),
  })
  .strict();

export const modifierGroupSchema = z.discriminatedUnion("type", [
  listModifierGroupSchema,
  textModifierGroupSchema,
]);

export type ModifierGroupDto = z.infer<typeof modifierGroupSchema>;

export const menuItemSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(512),
    description: z.string().max(65_535),
    imageUrl: httpsUrlSchema.nullable(),
    categoryIds: z.array(identifierSchema).min(1),
    ordinal: z.number().int().min(0),
    scheduleWindows: z.array(weeklyIntervalSchema).nullable(),
    variations: z.array(menuVariationSchema).min(1),
    modifierGroups: z.array(modifierGroupSchema),
  })
  .strict();

export type MenuItemDto = z.infer<typeof menuItemSchema>;

export const inventorySnapshotStatusSchema = z.enum([
  "fresh",
  "partial",
  "unavailable",
]);

export const menuSnapshotSchema = z
  .object({
    schemaVersion: z.literal(PUBLIC_SCHEMA_VERSION),
    location: locationSchema,
    categories: z.array(categorySchema),
    items: z.array(menuItemSchema),
    inventoryStatus: inventorySnapshotStatusSchema,
    generatedAt: isoDateTimeSchema,
    catalogUpdatedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const categoryIds = new Set(snapshot.categories.map((category) => category.id));
    const itemIds = new Set<string>();
    const variationIds = new Set<string>();

    if (categoryIds.size !== snapshot.categories.length) {
      context.addIssue({
        code: "custom",
        message: "Normalized category IDs must be unique",
        path: ["categories"],
      });
    }

    for (const [categoryIndex, category] of snapshot.categories.entries()) {
      if (category.parentId !== null && !categoryIds.has(category.parentId)) {
        context.addIssue({
          code: "custom",
          message: `Category references unknown parent ${category.parentId}`,
          path: ["categories", categoryIndex, "parentId"],
        });
      }
    }

    for (const [itemIndex, item] of snapshot.items.entries()) {
      if (itemIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate normalized item ID ${item.id}`,
          path: ["items", itemIndex, "id"],
        });
      }
      itemIds.add(item.id);

      for (const [categoryIndex, categoryId] of item.categoryIds.entries()) {
        if (!categoryIds.has(categoryId)) {
          context.addIssue({
            code: "custom",
            message: `Item references unknown category ${categoryId}`,
            path: ["items", itemIndex, "categoryIds", categoryIndex],
          });
        }
      }

      for (const [variationIndex, variation] of item.variations.entries()) {
        if (variationIds.has(variation.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate normalized variation ID ${variation.id}`,
            path: ["items", itemIndex, "variations", variationIndex, "id"],
          });
        }
        variationIds.add(variation.id);

        if (
          variation.price !== null &&
          variation.price.currency !== snapshot.location.currency
        ) {
          context.addIssue({
            code: "custom",
            message: "Variation currency must match the location currency",
            path: ["items", itemIndex, "variations", variationIndex, "price"],
          });
        }
      }

      for (const [groupIndex, group] of item.modifierGroups.entries()) {
        if (group.type !== "list") {
          continue;
        }

        for (const [optionIndex, option] of group.options.entries()) {
          if (option.price.currency !== snapshot.location.currency) {
            context.addIssue({
              code: "custom",
              message: "Modifier currency must match the location currency",
              path: [
                "items",
                itemIndex,
                "modifierGroups",
                groupIndex,
                "options",
                optionIndex,
                "price",
              ],
            });
          }
        }
      }
    }
  });

export type MenuSnapshotDto = z.infer<typeof menuSnapshotSchema>;
