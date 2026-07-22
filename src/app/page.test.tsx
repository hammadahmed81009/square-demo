import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("Home", () => {
  it("starts with an accessible location-loading state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<Home />);

    expect(screen.getByText("Loading the location menu.")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
