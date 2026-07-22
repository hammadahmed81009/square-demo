import { z } from "zod";

import { isoDateTimeSchema } from "./common";

export const CACHE_SCHEMA_VERSION = 1 as const;
export const MAX_BROWSER_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export function createCacheEnvelopeSchema<
  const TKind extends string,
  TPayloadSchema extends z.ZodType,
>(kind: TKind, payloadSchema: TPayloadSchema) {
  return z
    .object({
      schemaVersion: z.literal(CACHE_SCHEMA_VERSION),
      kind: z.literal(kind),
      cachedAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema,
      payload: payloadSchema,
    })
    .strict()
    .refine(
      (envelope) => Date.parse(envelope.expiresAt) > Date.parse(envelope.cachedAt),
      {
        message: "Cache expiry must be after the cache timestamp",
        path: ["expiresAt"],
      },
    )
    .refine(
      (envelope) =>
        Date.parse(envelope.expiresAt) - Date.parse(envelope.cachedAt) <=
        MAX_BROWSER_CACHE_AGE_MS,
      {
        message: "Cache lifetime cannot exceed 24 hours",
        path: ["expiresAt"],
      },
    );
}

export type CacheReadResult<TPayload> =
  | { status: "hit"; payload: TPayload; cachedAt: string; expiresAt: string }
  | {
      status: "discarded";
      reason:
        | "expired"
        | "invalid"
        | "wrong-kind"
        | "unsupported-version";
    };

const cacheHeaderSchema = z
  .object({
    schemaVersion: z.number().int(),
    kind: z.string(),
  })
  .passthrough();

const storedCacheEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(CACHE_SCHEMA_VERSION),
    kind: z.string(),
    cachedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    payload: z.unknown(),
  })
  .strict()
  .refine(
    (envelope) => Date.parse(envelope.expiresAt) > Date.parse(envelope.cachedAt),
    {
      message: "Cache expiry must be after the cache timestamp",
      path: ["expiresAt"],
    },
  )
  .refine(
    (envelope) =>
      Date.parse(envelope.expiresAt) - Date.parse(envelope.cachedAt) <=
      MAX_BROWSER_CACHE_AGE_MS,
    {
      message: "Cache lifetime cannot exceed 24 hours",
      path: ["expiresAt"],
    },
  );

export function readCacheEnvelope<
  const TKind extends string,
  TPayload,
  TPayloadSchema extends z.ZodType<TPayload>,
>(
  value: unknown,
  kind: TKind,
  payloadSchema: TPayloadSchema,
  now: Date = new Date(),
): CacheReadResult<TPayload> {
  const header = cacheHeaderSchema.safeParse(value);
  if (!header.success) {
    return { status: "discarded", reason: "invalid" };
  }

  if (header.data.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return { status: "discarded", reason: "unsupported-version" };
  }

  if (header.data.kind !== kind) {
    return { status: "discarded", reason: "wrong-kind" };
  }

  const envelope = storedCacheEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { status: "discarded", reason: "invalid" };
  }

  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return { status: "discarded", reason: "invalid" };
  }

  if (Date.parse(envelope.data.expiresAt) <= now.getTime()) {
    return { status: "discarded", reason: "expired" };
  }

  return {
    status: "hit",
    payload: payload.data,
    cachedAt: envelope.data.cachedAt,
    expiresAt: envelope.data.expiresAt,
  };
}
