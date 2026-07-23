import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { mockMenuApis } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await mockMenuApis(page);
});

test("menu browsing passes an accessibility smoke scan", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("supports keyboard search and category filtering", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search menu" }).focus();
  await page.keyboard.type("matcha");
  await expect(page.getByText("Matcha Tea")).toBeVisible();
  await expect(page.getByText("House Latte")).toHaveCount(0);

  await page.getByRole("button", { name: "Breakfast" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Matcha Tea")).toBeVisible();

  await page.getByRole("link", { name: "View Matcha Tea details" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/locations\/LOC_DOWNTOWN\/items\/ITEM_TEA$/);
  await expect(page.getByRole("heading", { level: 1, name: "Matcha Tea" })).toBeVisible();
});

test("item detail configuration remains operable by keyboard", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN/items/ITEM_LATTE");
  await expect(page.getByRole("heading", { level: 1, name: "House Latte" })).toBeVisible();

  await page.getByRole("radio", { name: /Small/i }).focus();
  await expect(page.getByRole("radio", { name: /Small/i })).toBeFocused();

  await page.getByRole("checkbox", { name: /Whole milk/i }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("checkbox", { name: /Oat milk/i }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: /Oat milk/i })).toBeChecked();

  await page.getByRole("button", { name: "Add to cart" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Cart" })).toBeVisible();
  await expect(page.getByText("Active subtotal").locator("..")).toContainText("$5.50");
});
