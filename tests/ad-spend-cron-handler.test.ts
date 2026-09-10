import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAdSpendSyncCron } from "../src/lib/ad-spend/cron-handler";

const CRON_SECRET = "test-cron-secret";

describe("handleAdSpendSyncCron", () => {
  const originalCronSecret = process.env["CRON_SECRET"];
  const originalSystemUserId = process.env["AD_SPEND_SYNC_SYSTEM_USER_ID"];

  beforeEach(() => {
    process.env["CRON_SECRET"] = CRON_SECRET;
    delete process.env["AD_SPEND_SYNC_SYSTEM_USER_ID"];
  });

  afterEach(() => {
    process.env["CRON_SECRET"] = originalCronSecret;
    process.env["AD_SPEND_SYNC_SYSTEM_USER_ID"] = originalSystemUserId;
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await handleAdSpendSyncCron(
      new Request("http://localhost/api/cron/sync-ad-spend"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await handleAdSpendSyncCron(
      new Request("http://localhost/api/cron/sync-ad-spend", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("500s when CRON_SECRET itself is not configured, even with a matching header", async () => {
    delete process.env["CRON_SECRET"];
    const response = await handleAdSpendSyncCron(
      new Request("http://localhost/api/cron/sync-ad-spend", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(response.status).toBe(500);
  });

  it("500s when AD_SPEND_SYNC_SYSTEM_USER_ID is not configured, even with a correct secret", async () => {
    const response = await handleAdSpendSyncCron(
      new Request("http://localhost/api/cron/sync-ad-spend", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(response.status).toBe(500);
  });

  it("rejects non-GET/POST methods", async () => {
    const response = await handleAdSpendSyncCron(
      new Request("http://localhost/api/cron/sync-ad-spend", {
        method: "DELETE",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(response.status).toBe(405);
  });
});
