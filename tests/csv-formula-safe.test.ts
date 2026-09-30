import { describe, expect, it } from "vitest";
import { neutralizeFormula } from "../src/lib/csv";

describe("neutralizeFormula", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tx", "\rx"])(
    "prefixes %j so Excel reads it as text",
    (s) => {
      expect(neutralizeFormula(s)).toBe(`'${s}`);
    },
  );

  it("leaves ordinary names alone", () => {
    expect(neutralizeFormula("Diwali Campaign")).toBe("Diwali Campaign");
    expect(neutralizeFormula("Tower A - Balcony")).toBe("Tower A - Balcony");
    expect(neutralizeFormula("")).toBe("");
  });
});
