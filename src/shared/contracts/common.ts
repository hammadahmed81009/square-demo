import { z } from "zod";

export const PUBLIC_SCHEMA_VERSION = 1 as const;

export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, "Identifier contains unsupported characters");

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO 4217 code");

export const localeSchema = z.string().trim().min(2).max(35);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const httpsUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "URL must use HTTPS");

export const moneySchema = z
  .object({
    amountMinor: z
      .string()
      .regex(/^(0|-?[1-9]\d*)$/, "Minor amount must be a canonical base-10 integer"),
    currency: currencyCodeSchema,
  })
  .strict();

export type MoneyDto = z.infer<typeof moneySchema>;

/**
 * Minutes from Monday 00:00 in a normalized week. Intervals never wrap;
 * overnight and week-boundary periods are split before reaching this DTO.
 */
export const weeklyIntervalSchema = z
  .object({
    startMinute: z.number().int().min(0).max(10_079),
    endMinute: z.number().int().min(1).max(10_080),
  })
  .strict()
  .refine((interval) => interval.endMinute > interval.startMinute, {
    message: "Weekly interval must have positive duration",
    path: ["endMinute"],
  });

export type WeeklyIntervalDto = z.infer<typeof weeklyIntervalSchema>;

export const warningSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(80),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export type WarningDto = z.infer<typeof warningSchema>;
