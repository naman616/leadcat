// Pure-function tests for the contact dedup engine (no DB — unlike
// tenant-isolation.test.ts, these run without TEST_DATABASE_URL).
import { describe, expect, it } from "vitest";
import {
  groupDuplicateContacts,
  normalizeEmail,
  normalizePhone,
  type DedupContact,
} from "../src/lib/dedup";

function contact(overrides: Partial<DedupContact> & { id: string }): DedupContact {
  return {
    fullName: "Someone",
    phone: null,
    email: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    leadCount: 0,
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail(" Asha@Example.com ")).toBe("asha@example.com");
  });

  it("returns null for empty/blank/missing input", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("strips formatting and country code down to the last 10 digits", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("091-98765-43210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });

  it("returns null for fewer than 10 digits rather than a short key", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("groupDuplicateContacts", () => {
  it("groups two contacts sharing a normalized phone", () => {
    const a = contact({ id: "a", phone: "+91 98765 43210" });
    const b = contact({ id: "b", phone: "09876543210" });
    const groups = groupDuplicateContacts([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.matchedOn).toEqual(["phone"]);
    expect(groups[0]!.contacts.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("groups two contacts sharing a normalized email", () => {
    const a = contact({ id: "a", email: "Asha@Example.com" });
    const b = contact({ id: "b", email: " asha@example.com " });
    const groups = groupDuplicateContacts([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.matchedOn).toEqual(["email"]);
  });

  it("does not group contacts with no shared key", () => {
    const a = contact({ id: "a", phone: "9876543210" });
    const b = contact({ id: "b", phone: "9123456789" });
    expect(groupDuplicateContacts([a, b])).toHaveLength(0);
  });

  it("transitively merges a chain: A~B on phone, B~C on email", () => {
    const a = contact({ id: "a", phone: "9876543210" });
    const b = contact({ id: "b", phone: "9876543210", email: "b@example.com" });
    const c = contact({ id: "c", email: "b@example.com" });
    const groups = groupDuplicateContacts([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contacts.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
    expect(groups[0]!.matchedOn.sort()).toEqual(["email", "phone"]);
  });

  it("does not flag a group as phone-matched just because one member has a phone", () => {
    // b and c share an email; a's phone is unique to a. The group should
    // report only "email", not "phone".
    const a = contact({ id: "a", phone: "9876543210", email: "shared@example.com" });
    const b = contact({ id: "b", email: "shared@example.com" });
    const groups = groupDuplicateContacts([a, b]);
    expect(groups[0]!.matchedOn).toEqual(["email"]);
  });

  it("orders group members oldest first", () => {
    const newer = contact({
      id: "newer",
      phone: "9876543210",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    const older = contact({
      id: "older",
      phone: "9876543210",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const groups = groupDuplicateContacts([newer, older]);
    expect(groups[0]!.contacts.map((c) => c.id)).toEqual(["older", "newer"]);
  });

  it("ignores contacts with no phone or email entirely", () => {
    const a = contact({ id: "a" });
    const b = contact({ id: "b" });
    expect(groupDuplicateContacts([a, b])).toHaveLength(0);
  });
});
