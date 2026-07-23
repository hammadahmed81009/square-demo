import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { representativeMenuSnapshot } from "../../../tests/fixtures/contracts/representative-menu";
import { createCartLine, createDefaultModifierDraft } from "@/features/cart/cart";

import { MenuBrowser } from "./menu-browser";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <span aria-label={alt} data-src={src} role="img" />,
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const requestId = "00000000-0000-4000-8000-000000000001";
const secondLocation = {
  ...representativeMenuSnapshot.location,
  id: "LOC_UPTOWN",
  name: "Uptown",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function success(data: unknown, source: "upstream" | "server-cache" | "server-stale" = "upstream", warnings: readonly { code: string; message: string }[] = []) {
  return {
    data,
    meta: {
      fetchedAt: "2026-07-23T08:00:01.000Z",
      requestId,
      schemaVersion: 1,
      source,
      warnings,
    },
  };
}

function menuWithTea() {
  const latte = representativeMenuSnapshot.items[0];
  const variation = latte?.variations[0];
  if (latte === undefined || variation === undefined) {
    throw new Error("Representative fixture must include an item variation");
  }
  return {
    ...representativeMenuSnapshot,
    items: [
      { ...latte, categoryIds: ["CAT_COFFEE", "CAT_BREAKFAST"] },
      {
        ...latte,
        categoryIds: ["CAT_BREAKFAST"],
        description: "Ceremonial green tea.",
        id: "ITEM_TEA",
        name: "Matcha Tea",
        variations: [{ ...variation, id: "VAR_TEA", name: "Ceremonial" }],
      },
    ],
  };
}

describe("MenuBrowser", () => {
  beforeEach(() => {
    window.localStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const endpoint = String(input);
      if (endpoint.startsWith("/api/locations")) {
        return Promise.resolve(response(success({ locations: [representativeMenuSnapshot.location, secondLocation] })));
      }
      return Promise.resolve(response(success(menuWithTea())));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("combines normalized search and category filtering", async () => {
    const user = userEvent.setup();
    render(<MenuBrowser locationId="LOC_DOWNTOWN" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Downtown" })).toBeInTheDocument();
    expect(screen.getAllByText("House Latte")).toHaveLength(1);
    expect(screen.getByText("Matcha Tea")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search menu" }), "matcha");
    await waitFor(() => expect(screen.queryByText("House Latte")).not.toBeInTheDocument());
    expect(screen.getByText("Matcha Tea")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Coffee" }));
    expect(await screen.findByText("No items match this search and category filter.")).toBeInTheDocument();
  });

  it("renders a direct item detail route with its visible options and customizations", async () => {
    render(<MenuBrowser itemId="ITEM_LATTE" locationId="LOC_DOWNTOWN" />);

    expect(await screen.findByText("Item details")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "House Latte" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Options" })).toBeInTheDocument();
    expect(screen.getAllByText("Small")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: "Customizations" })).toBeInTheDocument();
  });

  it("shows notices for stale/degraded data and an actionable retry error", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const endpoint = String(input);
      if (endpoint.startsWith("/api/locations")) {
        return Promise.resolve(response(success({ locations: [representativeMenuSnapshot.location] })));
      }
      return Promise.resolve(response(success(
        representativeMenuSnapshot,
        "server-stale",
        [{ code: "INVENTORY_UNAVAILABLE", message: "Inventory could not be refreshed." }],
      )));
    }));
    const { unmount } = render(<MenuBrowser locationId="LOC_DOWNTOWN" />);

    expect(await screen.findByText(/server-stale menu snapshot/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Menu notices" })).toHaveTextContent("Inventory could not be refreshed.");
    unmount();

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Menu service is unavailable.",
        requestId,
        retryable: true,
      },
    }, 503))));
    render(<MenuBrowser locationId="LOC_DOWNTOWN" />);

    expect(await screen.findByRole("heading", { level: 1, name: "We could not load this menu." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("requires confirmation before a nonempty location cart is cleared", async () => {
    const user = userEvent.setup();
    const item = representativeMenuSnapshot.items[0];
    if (item === undefined) {
      throw new Error("Representative fixture must include a latte");
    }
    const built = createCartLine(item, "VAR_LATTE_SMALL", createDefaultModifierDraft(item));
    if (!built.valid) {
      throw new Error("Default latte configuration must be valid");
    }
    window.localStorage.setItem("per-diem:cart:v1", JSON.stringify({
      currency: "USD",
      lines: [built.line],
      locationId: "LOC_DOWNTOWN",
      schemaVersion: 1,
    }));
    render(<MenuBrowser locationId="LOC_DOWNTOWN" />);

    await screen.findByRole("button", { name: "Clear cart" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Choose location" }), "LOC_UPTOWN");
    expect(screen.getByRole("dialog", { name: "Clear cart and change location?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear cart and change" }));
    expect(router.push).toHaveBeenCalledWith("/locations/LOC_UPTOWN");
  });
});
