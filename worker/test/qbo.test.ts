/**
 * QuickBooks read path: what happens when Intuit answers with an error.
 *
 * Two things are pinned. First, that a failed read degrades one account to
 * "unavailable" and suppresses the total rather than producing a smaller
 * number. Second, that every failure leaves a log line carrying the status and
 * `intuit_tid` (what Intuit support asks for) and nothing that must stay
 * private: not the access token, not the company ID.
 *
 * Every outbound request is intercepted; nothing here reaches Intuit.
 */

import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthEndpoints } from "../src/endpoints";
import { getFunds } from "../src/qbo";
import type { Env } from "../src/types";

const ENDPOINTS: OAuthEndpoints = {
  authorization: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

const ACCESS_TOKEN = "secret-access-token-value";
const REALM_ID = "9130000000000001";

/** What the stubbed Intuit should return for a request URL. Null means unreachable. */
let respond: ((url: string) => Response) | null = null;
let logged: string[] = [];

beforeEach(() => {
  respond = null;
  logged = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!respond) throw new TypeError("Network connection lost.");
    return respond(url);
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function liveEnv(): Env {
  return {
    ...env,
    QBO_MODE: "live",
    QBO_ENV: "sandbox",
    QBO_REALM_ID: REALM_ID,
    QBO_OPERATING_ACCOUNT_ID: "35",
    QBO_REBUILD_FUND_ACCOUNT_ID: "36",
  } as Env;
}

async function connectedStore(name: string) {
  const stub = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName(name));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAll();
    await state.storage.put("endpoints", { endpoints: ENDPOINTS, at: Date.now() });
  });
  await stub.seed({
    access_token: ACCESS_TOKEN,
    refresh_token: "refresh-token-value",
    expires_in: 3600,
    token_type: "bearer",
  });
  return stub;
}

function accountJson(id: string, balance: number): Response {
  return new Response(
    JSON.stringify({
      Account: { Id: id, Name: `Account ${id}`, CurrentBalance: balance, SubAccount: false },
      time: "2026-10-08T09:00:00.000-07:00",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function fault(status: number, tid: string): Response {
  return new Response(
    JSON.stringify({ Fault: { Error: [{ Message: "Something went wrong", code: "6000" }], type: "ValidationFault" } }),
    { status, headers: { "content-type": "application/json", intuit_tid: tid } },
  );
}

describe("QuickBooks error handling", () => {
  it("marks one failed account unavailable, suppresses the total, and logs the intuit_tid", async () => {
    const store = await connectedStore("one-account-fails");
    respond = (url) => (url.includes("/account/35") ? accountJson("35", 1000) : fault(500, "tid-abc-123"));

    const snapshot = await getFunds(liveEnv(), store);

    const byKey = Object.fromEntries(snapshot.accounts.map((a) => [a.key, a]));
    expect(byKey.operating.status).toBe("ok");
    expect(byKey.rebuild_fund.status).not.toBe("ok");
    // A total quietly missing an account overstates cash.
    expect(snapshot.totalCash).toBeNull();

    expect(logged).toHaveLength(1);
    const entry = JSON.parse(logged[0]);
    expect(entry).toMatchObject({
      event: "qbo_error",
      operation: "account_read",
      status: 500,
      intuitTid: "tid-abc-123",
    });
  });

  it("treats a 400 validation error as a failure of that account, not of the whole read", async () => {
    const store = await connectedStore("validation-error");
    respond = (url) => (url.includes("/account/36") ? fault(400, "tid-400") : accountJson("35", 1000));

    const snapshot = await getFunds(liveEnv(), store);

    expect(snapshot.accounts.find((a) => a.key === "operating")?.status).toBe("ok");
    expect(snapshot.accounts.find((a) => a.key === "rebuild_fund")?.status).not.toBe("ok");
    expect(snapshot.totalCash).toBeNull();
    expect(JSON.parse(logged[0])).toMatchObject({ status: 400, intuitTid: "tid-400" });
  });

  it("reports every account unavailable, and logs, when QuickBooks cannot be reached", async () => {
    const store = await connectedStore("unreachable");
    respond = null;

    const snapshot = await getFunds(liveEnv(), store);

    expect(snapshot.accounts.every((a) => a.status !== "ok")).toBe(true);
    expect(snapshot.totalCash).toBeNull();
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.parse(logged[0])).toMatchObject({ event: "qbo_error", operation: "account_read" });
  });

  it("never writes the access token or the company ID to the log", async () => {
    const store = await connectedStore("log-hygiene");
    respond = () => fault(500, "tid-secret-check");

    await getFunds(liveEnv(), store);

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain(ACCESS_TOKEN);
      expect(line).not.toContain(REALM_ID);
      expect(line).not.toContain("refresh-token-value");
    }
  });

  it("logs nothing when every read succeeds", async () => {
    const store = await connectedStore("all-good");
    respond = (url) => accountJson(url.includes("/account/35") ? "35" : "36", 500);

    const snapshot = await getFunds(liveEnv(), store);

    expect(snapshot.totalCash).toBe(1000);
    expect(logged).toEqual([]);
  });
});
