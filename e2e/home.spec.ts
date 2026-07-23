import { expect, test } from "@playwright/test";

import {
  apiSuccess,
  downtownLocation,
  downtownMenu,
  mockMenuApis,
} from "./support/fixtures";

test("renders the accessible location loading state before the redirect settles", async ({ page }) => {
  await page.route("**/api/locations**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(apiSuccess({ locations: [downtownLocation] })),
    });
  });

  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Loading the location menu.")).toBeVisible();
});

test("shows an actionable retry when the first locations request fails cold", async ({ page }) => {
  await page.route("**/api/locations**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 503,
      body: JSON.stringify({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Locations are temporarily unavailable.",
          requestId: "00000000-0000-4000-8000-0000000000e2",
          retryable: true,
        },
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "We could not load this menu." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("loads a mocked menu after retry recovers", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/locations**", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        contentType: "application/json",
        status: 503,
        body: JSON.stringify({
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: "Locations are temporarily unavailable.",
            requestId: "00000000-0000-4000-8000-0000000000e2",
            retryable: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(apiSuccess({ locations: [downtownLocation] })),
    });
  });
  await page.route("**/api/menu**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify(apiSuccess(downtownMenu())),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page).toHaveURL(/\/locations\/LOC_DOWNTOWN$/);
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();
});

test("keeps mocked APIs available for direct location entry", async ({ page }) => {
  await mockMenuApis(page);
  await page.goto("/locations/LOC_DOWNTOWN");
  await expect(page.getByRole("heading", { level: 1, name: "Downtown" })).toBeVisible();
});
