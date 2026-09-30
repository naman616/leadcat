import { describe, expect, it } from "vitest";
import { toLeadExportRow } from "../src/lib/leads-export";

const lead = {
  contact: {
    fullName: '=HYPERLINK("http://evil")',
    phone: "+919876543210",
    email: "-a@b.com",
    city: "Pune",
  },
  status: "New",
  subStatus: null,
  source: "@web",
  subSource: null,
  project: "Tower A",
  budget: "+50L",
  requirement: "=2+2",
  assignee: { fullName: "Asha" },
  createdAt: new Date("2026-09-30T00:00:00Z"),
};

describe("toLeadExportRow", () => {
  it("neutralizes formula-looking free text but leaves phone, status and dates alone", () => {
    expect(toLeadExportRow(lead)).toEqual([
      '\'=HYPERLINK("http://evil")',
      "+919876543210",
      "'-a@b.com",
      "Pune",
      "New",
      null,
      "'@web",
      null,
      "Tower A",
      "'+50L",
      "'=2+2",
      "Asha",
      "2026-09-30T00:00:00.000Z",
    ]);
  });

  it("uses an empty string when unassigned", () => {
    expect(toLeadExportRow({ ...lead, assignee: null })[11]).toBe("");
  });
});
