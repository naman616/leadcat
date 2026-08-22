// Pure-function tests for auto-assignment picking logic (no DB — same
// no-DB pattern as tests/dedup.test.ts).
import { describe, expect, it } from "vitest";
import { pickRoundRobinAgent, pickLoadBalancedAgent } from "../src/lib/auto-assignment";

describe("pickRoundRobinAgent", () => {
  it("picks the first agent when there's no prior assignment", () => {
    expect(pickRoundRobinAgent(["a", "b", "c"], null)).toBe("a");
  });

  it("advances past the last assigned agent", () => {
    expect(pickRoundRobinAgent(["a", "b", "c"], "a")).toBe("b");
  });

  it("wraps around after the last agent in the list", () => {
    expect(pickRoundRobinAgent(["a", "b", "c"], "c")).toBe("a");
  });

  it("falls back to the first agent if the last assignee is no longer eligible", () => {
    expect(pickRoundRobinAgent(["a", "b", "c"], "gone")).toBe("a");
  });

  it("returns null when there are no eligible agents", () => {
    expect(pickRoundRobinAgent([], null)).toBeNull();
    expect(pickRoundRobinAgent([], "a")).toBeNull();
  });

  it("cycles back to the only agent when there's just one", () => {
    expect(pickRoundRobinAgent(["a"], "a")).toBe("a");
  });
});

describe("pickLoadBalancedAgent", () => {
  it("picks the agent with the fewest open leads", () => {
    const agents = [
      { userId: "a", openLeadCount: 3 },
      { userId: "b", openLeadCount: 1 },
      { userId: "c", openLeadCount: 2 },
    ];
    expect(pickLoadBalancedAgent(agents)).toBe("b");
  });

  it("breaks ties by earliest position in the given order", () => {
    const agents = [
      { userId: "a", openLeadCount: 1 },
      { userId: "b", openLeadCount: 1 },
    ];
    expect(pickLoadBalancedAgent(agents)).toBe("a");
  });

  it("returns null for an empty candidate list", () => {
    expect(pickLoadBalancedAgent([])).toBeNull();
  });

  it("picks a zero-count agent over any nonzero one", () => {
    const agents = [
      { userId: "a", openLeadCount: 5 },
      { userId: "b", openLeadCount: 0 },
    ];
    expect(pickLoadBalancedAgent(agents)).toBe("b");
  });
});
