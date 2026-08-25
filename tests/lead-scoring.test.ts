// Pure-function tests for the lead scoring heuristic (no DB — same no-DB
// pattern as tests/dedup.test.ts).
import { describe, expect, it } from "vitest";
import { scoreLead, type ScorableLead } from "../src/lib/lead-scoring";

function lead(overrides: Partial<ScorableLead>): ScorableLead {
  return {
    status: "New",
    budget: null,
    contactPhone: null,
    contactEmail: null,
    nextActionAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("scoreLead", () => {
  it("scores a bare-minimum new lead as 0", () => {
    expect(scoreLead(lead({}))).toBe(0);
  });

  it("adds points for having both phone and email", () => {
    expect(scoreLead(lead({ contactPhone: "9876543210", contactEmail: "a@b.com" }))).toBe(20);
  });

  it("does not award phone+email points for only one of them", () => {
    expect(scoreLead(lead({ contactPhone: "9876543210" }))).toBe(0);
    expect(scoreLead(lead({ contactEmail: "a@b.com" }))).toBe(0);
  });

  it("adds points for a specified budget", () => {
    expect(scoreLead(lead({ budget: "50L" }))).toBe(20);
  });

  it("adds points once status has progressed past New", () => {
    expect(scoreLead(lead({ status: "FollowUp" }))).toBe(30);
    expect(scoreLead(lead({ status: "Booked" }))).toBe(30);
  });

  it("adds points for a future scheduled next action", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(scoreLead(lead({ nextActionAt: future }))).toBe(30);
  });

  it("does not award recency points for a next action already in the past with no other signal", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(scoreLead(lead({ nextActionAt: past }))).toBe(0);
  });

  it("adds points for recent activity (within 7 days) when there's no future next action", () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(scoreLead(lead({ lastActivityAt: recent }))).toBe(30);
  });

  it("does not award recency points for stale activity", () => {
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(scoreLead(lead({ lastActivityAt: stale }))).toBe(0);
  });

  it("does not double-count recency when both a future next action and recent activity exist", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const recent = new Date(Date.now() - 3600_000).toISOString();
    expect(scoreLead(lead({ nextActionAt: future, lastActivityAt: recent }))).toBe(30);
  });

  it("sums to 100 for a fully engaged lead", () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    expect(
      scoreLead(
        lead({
          contactPhone: "9876543210",
          contactEmail: "a@b.com",
          budget: "50L",
          status: "SiteVisit",
          nextActionAt: soon,
        }),
      ),
    ).toBe(100);
  });
});
