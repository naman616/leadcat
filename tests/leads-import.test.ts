// Pure-function tests for the bulk lead upload parser (no DB — unlike
// tenant-isolation.test.ts, these run without TEST_DATABASE_URL).
import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "../src/lib/csv";
import { LEAD_IMPORT_TEMPLATE_CSV, parseLeadImportCsv } from "../src/lib/leads-import";

describe("parseCsv", () => {
  it("splits plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    expect(parseCsv('name,note\nAsha,"Rao, likes ""2BHK"""')).toEqual([
      ["name", "note"],
      ["Asha", 'Rao, likes "2BHK"'],
    ]);
  });

  it("handles a quoted field with an embedded newline", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("tolerates a missing trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("stringifyCsv", () => {
  it("joins plain rows with \\r\\n line endings", () => {
    expect(
      stringifyCsv([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]),
    ).toBe("a,b,c\r\n1,2,3\r\n");
  });

  it("quotes a field containing a comma, quote, or newline", () => {
    expect(stringifyCsv([['Rao, likes "2BHK"']])).toBe('"Rao, likes ""2BHK"""\r\n');
    expect(stringifyCsv([["line1\nline2"]])).toBe('"line1\nline2"\r\n');
  });

  it("does not quote fields that don't need it", () => {
    expect(stringifyCsv([["Asha Rao", "Pune"]])).toBe("Asha Rao,Pune\r\n");
  });

  it("renders null/undefined as an empty field", () => {
    expect(stringifyCsv([["Asha", null, undefined]])).toBe("Asha,,\r\n");
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["Full Name", "Note"],
      ["Asha", 'Likes "2BHK", quiet street'],
    ];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
});

describe("parseLeadImportCsv", () => {
  it("parses the generated template as one valid row", () => {
    const { rows, fileError } = parseLeadImportCsv(LEAD_IMPORT_TEMPLATE_CSV);
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ fullName: "Asha Rao", phone: "9876543210" });
    expect(rows[0]!.errors).toEqual([]);
  });

  it("rejects a file missing a required column", () => {
    const { fileError } = parseLeadImportCsv("Full Name,Email\nAsha,a@example.com\n");
    expect(fileError).toMatch(/Phone/);
  });

  it("flags a row with an invalid email but keeps the valid ones", () => {
    const csv =
      "Full Name,Phone,Email\n" +
      "Asha,9876543210,not-an-email\n" +
      "Ravi,9123456789,ravi@example.com\n";
    const { rows, fileError } = parseLeadImportCsv(csv);
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data).toBeNull();
    expect(rows[0]!.errors.length).toBeGreaterThan(0);
    expect(rows[1]!.data).toMatchObject({ fullName: "Ravi" });
  });

  it("skips blank trailing rows instead of reporting them as errors", () => {
    const csv = "Full Name,Phone\nAsha,9876543210\n\n";
    const { rows } = parseLeadImportCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("matches headers case-insensitively and ignores surrounding whitespace", () => {
    const csv = " full name , PHONE \nAsha,9876543210\n";
    const { rows, fileError } = parseLeadImportCsv(csv);
    expect(fileError).toBeNull();
    expect(rows[0]!.data).toMatchObject({ fullName: "Asha", phone: "9876543210" });
  });

  it("rejects a file over the row cap", () => {
    const header = "Full Name,Phone\n";
    const body = Array.from({ length: 501 }, (_, i) => `Lead ${i},900000${i}`).join("\n");
    const { fileError } = parseLeadImportCsv(header + body);
    expect(fileError).toMatch(/500 or fewer/);
  });
});
