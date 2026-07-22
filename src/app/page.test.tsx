import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("identifies the application and its foundation status", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /multi-location menu/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Foundation status" }),
    ).toBeInTheDocument();
  });
});
