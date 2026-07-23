import { expect, test } from "@playwright/test";

import {
  downtownLocation,
  downtownMenu,
  mockMenuApis,
  uptownLocation,
  uptownMenu,
} from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await mockMenuApis(page);
});

test("redirects home to a location and switches menus without silent cart carry-over", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/locations\/LOC_DOWNTOWN$/);
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();
  await expect(page.getByText("House Latte")).toBeVisible();
  await expect(page.getByText("Uptown Cold Brew")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Choose location" }).selectOption("LOC_UPTOWN");
  await expect(page).toHaveURL(/\/locations\/LOC_UPTOWN$/);
  await expect(page.getByRole("heading", { level: 1, name: "Uptown" })).toBeVisible();
  await expect(page.getByText("Uptown Cold Brew")).toBeVisible();
  await expect(page.getByText("House Latte")).toHaveCount(0);
});

test("intersects category filtering and search", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search menu" }).fill("matcha");
  await expect(page.getByText("Matcha Tea")).toBeVisible();
  await expect(page.getByText("House Latte")).toHaveCount(0);

  await page.getByRole("button", { name: "Coffee" }).click();
  await expect(page.getByText("No items match this search and category filter.")).toBeVisible();
});

test("opens item details and shows sold-out and scheduled states", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN");
  await page.getByRole("link", { name: "View House Latte details" }).click();
  await expect(page).toHaveURL(/\/locations\/LOC_DOWNTOWN\/items\/ITEM_LATTE$/);
  await expect(page.getByRole("heading", { level: 1, name: "House Latte" })).toBeVisible();
  await expect(page.getByLabel("Options").getByText("Sold out.")).toBeVisible();

  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByText("Nightcap Espresso")).toBeVisible();
  await expect(page.getByText("This item is not scheduled right now.").first()).toBeVisible();
});

test("configures modifiers and keeps an exact cart subtotal", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN/items/ITEM_LATTE");
  await expect(page.getByRole("heading", { level: 1, name: "House Latte" })).toBeVisible();

  await page.getByRole("checkbox", { name: /Whole milk/i }).uncheck();
  await page.getByRole("checkbox", { name: /Oat milk/i }).check();
  await page.getByLabel("Up to 24 characters").fill("Ada");
  await page.getByRole("button", { name: "Add to cart" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Cart" })).toBeVisible();
  await expect(page.getByText("1× Oat milk")).toBeVisible();
  await expect(page.getByText("Name on cup: Ada")).toBeVisible();
  await expect(page.getByText("Active subtotal").locator("..")).toContainText("$5.50");

  await page.getByRole("button", { name: "Increase House Latte quantity" }).click();
  await expect(page.getByText("Active subtotal").locator("..")).toContainText("$11.00");
});

test("keeps a warm offline snapshot browseable while disabling cart mutation", async ({ page }) => {
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();

  await page.route("**/api/locations**", async (route) => {
    await route.abort("failed");
  });
  await page.route("**/api/menu**", async (route) => {
    await route.abort("failed");
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
  });
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();
  await expect(page.getByText(/you are offline/i)).toBeVisible();
  await expect(page.getByText(/cart changes are disabled/i)).toBeVisible();
});

test("uses distinct location catalogs from the shared fixture set", async ({ page }) => {
  await mockMenuApis(page, {
    locations: [downtownLocation, uptownLocation],
    menus: {
      LOC_DOWNTOWN: downtownMenu(),
      LOC_UPTOWN: uptownMenu(),
    },
  });
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByText("Matcha Tea")).toBeVisible();
  await page.goto("/locations/LOC_UPTOWN");
  await expect(page.getByText("Uptown Cold Brew")).toBeVisible();
  await expect(page.getByText("Matcha Tea")).toHaveCount(0);
});
