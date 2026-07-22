import { expect, test } from "@playwright/test";

test("renders the accessible location loading state", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Loading the location menu.")).toBeVisible();
});
