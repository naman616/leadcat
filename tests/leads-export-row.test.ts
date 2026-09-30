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

describe("toLeadExportRow phone column", () => {
  const phone = (p: string) =>
    toLeadExportRow({ ...lead, contact: { ...lead.contact, phone: p } })[1];

  it.each(["+919876543210", "+91 98765-43210", "+1 (415) 555-0100", "9876543210"])(
    "keeps the real phone number %j intact",
    (p) => expect(phone(p)).toBe(p),
  );

  it.each(["=cmd|' /C calc'!A0", "+cmd|x", "@SUM(1)", "-1+1", "+91=1+1"])(
    "neutralizes formula payload %j in phone",
    (p) => expect(phone(p)).toBe(`'${p}`),
  );

  it("keeps a null phone null", () => {
    expect(toLeadExportRow({ ...lead, contact: { ...lead.contact, phone: null } })[1]).toBeNull();
  });
});
