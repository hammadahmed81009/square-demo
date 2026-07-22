import { describe, expect, it } from "vitest";

import { moneySchema, weeklyIntervalSchema } from "./common";

describe("common DTO primitives", () => {
  it("accepts canonical integer money strings for different currencies", () => {
    expect(
      moneySchema.safeParse({ amountMinor: "0", currency: "JPY" }).success,
    ).toBe(true);
    expect(
      moneySchema.safeParse({ amountMinor: "12345", currency: "KWD" }).success,
    ).toBe(true);
    expect(
      moneySchema.safeParse({ amountMinor: "-50", currency: "USD" }).success,
    ).toBe(true);
  });

  it("rejects noncanonical or non-string minor amounts", () => {
    for (const amountMinor of ["-0", "01", "+1", "1.5", 100, BigInt(100)]) {
      expect(moneySchema.safeParse({ amountMinor, currency: "USD" }).success).toBe(
        false,
      );
    }
  });

  it("uses normalized non-wrapping weekly minute ranges", () => {
    expect(
      weeklyIntervalSchema.safeParse({ startMinute: 0, endMinute: 10_080 })
        .success,
    ).toBe(true);
    expect(
      weeklyIntervalSchema.safeParse({ startMinute: 10_079, endMinute: 10_080 })
        .success,
    ).toBe(true);
  });
});
