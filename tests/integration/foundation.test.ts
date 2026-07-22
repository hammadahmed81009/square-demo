import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = process.cwd();

describe("repository foundation", () => {
  it("pins the supported runtime and package manager", async () => {
    const packageJsonSchema = z.object({
      engines: z.object({ node: z.string(), pnpm: z.string() }),
      packageManager: z.string(),
    });
    const packageJson = packageJsonSchema.parse(
      JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    );

    expect(packageJson.engines.node).toBe("22.x");
    expect(packageJson.engines.pnpm).toBe("10.14.0");
    expect(packageJson.packageManager).toBe("pnpm@10.14.0");
  });

  it("keeps the Square credential in a server-only module", async () => {
    const serverEnvironment = await readFile(
      resolve(root, "src/server/env.ts"),
      "utf8",
    );

    expect(serverEnvironment).toContain('import "server-only"');
    expect(serverEnvironment).toContain("SQUARE_ACCESS_TOKEN");
    expect(serverEnvironment).not.toContain("NEXT_PUBLIC_SQUARE");
  });
});
