import { describe, expect, it } from "vitest";
import { adReportInputSchema } from "../src/lib/ad-reports-input";

describe("adReportInputSchema", () => {
  it("accepts a valid range, including a single day", () => {
    expect(adReportInputSchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success).toBe(
      true,
    );
    expect(adReportInputSchema.safeParse({ from: "2026-09-01", to: "2026-09-01" }).success).toBe(
      true,
    );
  });

  it("rejects from after to", () => {
    expect(adReportInputSchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(
      false,
    );
  });

  it("rejects malformed and impossible dates", () => {
    expect(adReportInputSchema.safeParse({ from: "30/09/2026", to: "2026-09-30" }).success).toBe(
      false,
    );
    expect(adReportInputSchema.safeParse({ from: "2026-02-31", to: "2026-03-05" }).success).toBe(
      false,
    );
    expect(adReportInputSchema.safeParse({ from: "", to: "" }).success).toBe(false);
  });
});
