import { z } from "zod";

import {
  isoDateTimeSchema,
  PUBLIC_SCHEMA_VERSION,
  warningSchema,
} from "./common";

export const apiSourceSchema = z.enum([
  "upstream",
  "server-cache",
  "server-stale",
]);

export const apiMetaSchema = z
  .object({
    schemaVersion: z.literal(PUBLIC_SCHEMA_VERSION),
    requestId: z.uuid(),
    fetchedAt: isoDateTimeSchema,
    source: apiSourceSchema,
    warnings: z.array(warningSchema),
  })
  .strict();

export type ApiMetaDto = z.infer<typeof apiMetaSchema>;

export const apiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFIGURATION_ERROR",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
        retryable: z.boolean(),
        requestId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorDto = z.infer<typeof apiErrorSchema>;

export function createApiSuccessSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z
    .object({
      data: dataSchema,
      meta: apiMetaSchema,
    })
    .strict();
}

export function createApiResponseSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z.union([createApiSuccessSchema(dataSchema), apiErrorSchema]);
}

export type ApiSuccessDto<TData> = {
  data: TData;
  meta: ApiMetaDto;
};

export type ApiResponseDto<TData> = ApiSuccessDto<TData> | ApiErrorDto;
