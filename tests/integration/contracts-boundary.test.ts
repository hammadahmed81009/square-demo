import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  archivedCatalogFixture,
  categoryCycleFixture,
  deletedCatalogFixture,
  duplicateCatalogFixture,
  incompleteCatalogFixture,
  malformedCatalogFixture,
} from "../fixtures/square/edge-cases";
import {
  representativeSquareFixture,
  squareCatalogFixture,
  squareInventoryFixture,
  squareLocationsFixture,
} from "../fixtures/square/representative";

const contractFiles = ["api.ts", "cache.ts", "cart.ts", "common.ts", "menu.ts"];

describe("contract boundary", () => {
  it("contains representative Square coverage for the downstream normalizer", () => {
    expect(squareLocationsFixture).toHaveLength(2);
    expect(
      squareCatalogFixture.some((entry) => entry.type === "AVAILABILITY_PERIOD"),
    ).toBe(true);
    expect(
      squareCatalogFixture.some((entry) => entry.type === "IMAGE"),
    ).toBe(true);
    expect(
      squareCatalogFixture.some((entry) => entry.type === "MODIFIER_LIST"),
    ).toBe(true);
    expect(
      squareCatalogFixture.some((entry) => entry.type === "ITEM"),
    ).toBe(true);
    expect(squareInventoryFixture.some((count) => count.quantity === "0")).toBe(
      true,
    );
    expect(
      squareInventoryFixture.some((count) => count.quantity.includes(".")),
    ).toBe(true);
    expect(() => JSON.stringify(representativeSquareFixture)).toThrow(TypeError);
  });

  it("provides malformed and lifecycle edge fixtures", () => {
    expect(malformedCatalogFixture.item_data.name).toBe(42);
    expect(incompleteCatalogFixture.item_data.variations).toHaveLength(0);
    expect(duplicateCatalogFixture[0].id).toBe(duplicateCatalogFixture[1].id);
    expect(archivedCatalogFixture.item_data.is_archived).toBe(true);
    expect(deletedCatalogFixture.is_deleted).toBe(true);
    expect(categoryCycleFixture).toHaveLength(2);
  });

  it("contains no explicit unsafe escape hatches in public contracts", async () => {
    for (const filename of contractFiles) {
      const source = await readFile(
        resolve(process.cwd(), "src/shared/contracts", filename),
        "utf8",
      );

      expect(source).not.toMatch(/@ts-ignore|@ts-expect-error/);
      expect(source).not.toMatch(/\bany\b/);
      expect(source).not.toMatch(/\sas\s+(?!const\b)/);
    }
  });
});
