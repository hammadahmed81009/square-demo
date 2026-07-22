import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  SQUARE_ACCESS_TOKEN: z
    .string()
    .trim()
    .min(1, "SQUARE_ACCESS_TOKEN is required")
    .refine(
      (value) => value !== "replace-with-your-square-sandbox-access-token",
      "SQUARE_ACCESS_TOKEN must be a real Sandbox credential",
    ),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

/**
 * Parse secrets at the server data-access boundary, immediately before use.
 * Keeping this lazy lets static pages and CI builds run without live credentials.
 */
export function getServerEnvironment(): ServerEnvironment {
  return serverEnvironmentSchema.parse(process.env);
}
