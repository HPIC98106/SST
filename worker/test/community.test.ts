/**
 * The Membership tab: members from LGL's membership records, donors and giving
 * from its gift records.
 *
 * Pinned: members are LGL's active list, never counted from dues gifts; "new"
 * means a first membership this year; only cash gift types count; dues, grant
 * payments and purchases do not make a donor; "same period last year" stops at
 * the same day; the next quarter wraps into the new year correctly; operating
 * awards report what is still to arrive; a page walk that stops early reports
 * nothing at all; and the cached snapshot outlasts the cron that rewrites it.
 */

import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleCommunity, communityConfig, getCommunity, seattleDate, type LglMember } from "../src/community";
import worker from "../src/index";
import type { LglGift } from "../src/lgl";
import type { CommunitySnapshot, Env } from "../src/types";

const CONFIG = communityConfig({
  LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
  LGL_ANNUAL_FUND_CAMPAIGN_IDS: "872",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
  LGL_NON_DONATION_CATEGORY_IDS: "6134",
} as Env);

let next = 1;
const gift = (fields: Partial<LglGift>): LglGift =>
  ({ id: next++, gift_type_name: "Gift", received_amount: 0, ...fields }) as LglGift;
const dues = (who: number, date: string, amount = 40) =>
  gift({ constituent_id: who, campaign_id: 846, campaign_name: "Memberships", received_amount: amount, received_date: date });

const BASE = { retrievedAt: "Fri, 30 Oct 2026 17:00:00 GMT", connection: "ok" } as const;
const member = (id: number, ...records: [level: string, start: string, finish: string][]): LglMember => ({
  id,
  memberships: records.map(([membership_level_name, date_start, finish_date]) => ({ membership_level_name, date_start, finish_date })),
});
const assemble = (gifts: LglGift[], today = "2026-10-30", active: LglMember[] = []) =>
  assembleCommunity(gifts, active, today, CONFIG, BASE);

describe("members", () => {
  it("counts LGL's active members, including those who paid no dues themselves", () => {
    // Person 1 paid; person 2 is their household, credited on the same payment.
    const snapshot = assemble([dues(1, "2026-05-01", 40)], "2026-10-30", [
      member(1, ["Classic", "2026-05-01", "2027-05-01"]),
      member(2, ["Classic", "2026-05-01", "2027-05-01"]),
    ]);
    expect(snapshot.members).toMatchObject({ total: 2, dues: { payers: 1, amount: 40 } });
  });

  it("does not make someone a member by paying into the dues campaign", () => {
    const snapshot = assemble([dues(1, "2026-05-01")], "2026-10-30", []);
    expect(snapshot.members?.total).toBe(0);
  });

  it("calls a member new only if their first membership began this year", () => {
    const snapshot = assemble([], "2026-10-30", [
      member(1, ["Classic", "2026-02-01", "2027-02-01"]),
      member(2, ["Classic", "2025-06-01", "2026-06-01"], ["Classic", "2026-06-01", "2027-06-01"]),
      // Lapsed for years, then came back: returning, not new.
      member(3, ["Classic", "2019-03-01", "2020-03-01"], ["Classic", "2026-03-01", "2027-03-01"]),
    ]);
    expect(snapshot.members?.newThisYear).toBe(1);
  });

  it("will not say who is new when a member has no dated record", () => {
    const snapshot = assemble([], "2026-10-30", [member(1, ["Classic", "2026-02-01", "2027-02-01"]), { id: 2, memberships: [] }]);
    expect(snapshot.members?.total).toBe(2);
    expect(snapshot.members?.newThisYear).toBeNull();
  });

  it("reports each member at the level of the record running latest", () => {
    const snapshot = assemble([], "2026-10-30", [
      member(1, ["Classic", "2025-06-01", "2026-06-01"], ["Champion", "2026-06-01", "2027-06-01"]),
      member(2, ["Classic", "2026-01-01", "2027-01-01"]),
      member(3, ["Classic", "2026-01-01", "2027-01-01"]),
    ]);
    expect(snapshot.members?.byLevel).toEqual([{ level: "Classic", count: 2 }, { level: "Champion", count: 1 }]);
  });

  it("counts dues from cash only, and only up to LGL's own today", () => {
    const snapshot = assemble([
      dues(1, "2026-03-01"),
      dues(5, "2026-11-02"),
      gift({ gift_type_name: "Soft Credit", constituent_id: 2, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "In Kind", constituent_id: 3, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "Pledge", constituent_id: 4, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
    ]);
    expect(snapshot.members?.dues).toEqual({ payers: 1, amount: 40 });
    expect(snapshot.giftCount).toBe(1);
  });
});

describe("donors and campaigns", () => {
  it("never counts a grant payment as a donor or as campaign giving", () => {
    const snapshot = assemble([
      gift({ constituent_id: 10, campaign_id: 882, campaign_name: "Individual Giving", received_amount: 50, received_date: "2026-02-01" }),
      gift({ constituent_id: 11, gift_category_id: 6076, campaign_id: 871, campaign_name: "Rebuild Project", received_amount: 100000, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.donors?.thisYear).toBe(1);
    expect(snapshot.byCampaign.map((c) => c.campaign)).toEqual(["Individual Giving"]);
  });

  it("does not make a donor of someone who only paid dues or bought something", () => {
    const snapshot = assemble([
      dues(1, "2026-05-01"),
      gift({ constituent_id: 2, gift_category_id: 6134, campaign_id: 887, campaign_name: "Pot Auction", received_amount: 300, received_date: "2026-04-18" }),
      gift({ constituent_id: 3, campaign_id: 882, campaign_name: "Individual Giving", received_amount: 50, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.donors?.thisYear).toBe(1);
    // The sale is still money received, so it stays in giving by campaign.
    expect(snapshot.byCampaign.map((c) => c.campaign)).toContain("Pot Auction");
  });

  it("counts a member who also made a gift as a donor, once", () => {
    const snapshot = assemble([
      dues(1, "2026-05-01"),
      gift({ constituent_id: 1, campaign_id: 882, received_amount: 50, received_date: "2026-02-01" }),
      gift({ constituent_id: 1, campaign_id: 872, received_amount: 50, received_date: "2026-03-01" }),
    ]);
    expect(snapshot.donors?.thisYear).toBe(1);
  });

  it("only counts donors from this year", () => {
    const snapshot = assemble([
      gift({ constituent_id: 10, campaign_id: 882, received_amount: 50, received_date: "2025-02-01" }),
      gift({ constituent_id: 11, campaign_id: 882, received_amount: 50, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.donors).toEqual({ thisYear: 1 });
  });

  it("will not count donors when dues cannot be told apart from gifts", () => {
    const config = communityConfig({ LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076" } as Env);
    const snapshot = assembleCommunity([dues(1, "2026-05-01")], [], "2026-10-30", config, BASE);
    expect(snapshot.donors).toBeNull();
    expect(snapshot.members?.dues).toBeNull();
  });

  it("compares a campaign with the same days last year, not the whole of it", () => {
    const snapshot = assemble([dues(1, "2025-10-30", 40), dues(2, "2025-10-31", 100), dues(3, "2026-10-01", 40)]);
    expect(snapshot.byCampaign[0]).toMatchObject({ lastYearSamePeriod: 40, lastYearTotal: 140 });
  });
});

describe("the next three months", () => {
  it("reads the same months a year earlier, wrapping into the new year", () => {
    const snapshot = assemble([
      gift({ constituent_id: 1, campaign_id: 872, received_amount: 500, received_date: "2025-12-10" }),
      dues(2, "2026-01-05", 40),
      dues(3, "2025-10-05", 999),
    ]);
    expect(snapshot.nextQuarter?.months).toEqual(["2026-11", "2026-12", "2027-01"]);
    const amount = (key: string) => snapshot.nextQuarter?.items.find((i) => i.key === key)?.amount;
    expect(amount("annual_fund")).toBe(500);
    // January 2026 is "a year earlier" than January 2027.
    expect(amount("memberships")).toBe(40);
  });
});

describe("operating grants", () => {
  it("reports what is still to arrive on awards outside the rebuild", () => {
    const award = gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: 841, received_amount: 15000, received_date: "2026-02-01" });
    const rebuild = gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: 871, received_amount: 500000, received_date: "2026-02-01" });
    const snapshot = assemble([
      award,
      rebuild,
      gift({ gift_category_id: 6076, parent_gift_id: award.id, received_amount: 6000, received_date: "2026-03-01" }),
    ]);
    expect(snapshot.operatingGrants).toMatchObject({ awarded: 15000, received: 6000, remaining: 9000 });
    expect(snapshot.operatingGrants?.awards.map((a) => a.id)).toEqual([award.id]);
  });
});

describe("reading LGL", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows nothing when the page walk stops before the last gift", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i })), total_items: 99999 }), {
        status: 200,
        headers: { "content-type": "application/json", date: "Fri, 30 Oct 2026 17:00:00 GMT" },
      }),
    );
    const snapshot = await getCommunity({ ...env, LGL_MODE: "live", LGL_API_KEY: "test" } as Env);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.members).toBeNull();
    expect(snapshot.note).toContain("more gifts than one read allows");
  });

  const pages = (route: (url: URL) => { items: unknown[]; total_items: number }) =>
    vi.stubGlobal("fetch", async (input: string) =>
      new Response(JSON.stringify(route(new URL(input))), {
        status: 200,
        headers: { "content-type": "application/json", date: "Fri, 30 Oct 2026 17:00:00 GMT" },
      }),
    );
  const live = { ...env, LGL_MODE: "live", LGL_API_KEY: "test" } as Env;

  it("shows nothing when the active members stop before the last one", async () => {
    pages((url) =>
      url.pathname.endsWith("gifts/search")
        ? { items: [], total_items: 0 }
        : { items: Array.from({ length: 100 }, (_, i) => ({ id: i })), total_items: 99999 },
    );
    const snapshot = await getCommunity(live);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.members).toBeNull();
    expect(snapshot.note).toContain("more active members than one read allows");
  });

  it("asks LGL itself who is active, with their membership records", async () => {
    const asked: URL[] = [];
    pages((url) => {
      asked.push(url);
      return url.pathname.endsWith("constituents/search")
        ? { items: [member(1, ["Classic", "2026-02-01", "2027-02-01"])], total_items: 1 }
        : { items: [], total_items: 0 };
    });
    const snapshot = await getCommunity(live);
    const search = asked.find((u) => u.pathname.endsWith("constituents/search"))!;
    expect(search.searchParams.getAll("q[]")).toEqual(["membership_status=1"]);
    expect(search.searchParams.get("expand")).toBe("memberships");
    expect(snapshot.members).toMatchObject({ total: 1, newThisYear: 1 });
  });

  it("dates the year by LGL's clock in Seattle, not UTC", () => {
    // 3 a.m. UTC on January 1 is still December 31 in Seattle.
    expect(seattleDate("Thu, 01 Jan 2026 03:00:00 GMT")).toBe("2025-12-31");
  });

  it("renders the fixture company end to end", async () => {
    const snapshot = await getCommunity({ ...env, LGL_MODE: "fixture", ...CONFIG_ENV } as Env);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.members!.total).toBeGreaterThan(snapshot.members!.dues!.payers);
    expect(snapshot.monthly!.dues.thisYear[11]).toBeNull();
  });
});

describe("the cached snapshot", () => {
  afterEach(() => vi.unstubAllGlobals());

  const live = { ...env, LGL_MODE: "live", LGL_API_KEY: "test", ACCESS_PASSPHRASE: "test" } as Env;
  const minutes = 60_000;

  /** Seeds a snapshot of the given age, then asks the Worker for it. */
  async function readAged(age: number) {
    const stub = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName("qbo"));
    const snapshot = assemble([dues(1, "2026-05-01")]);
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.put("community-v2", { snapshot, cachedAt: Date.now() - age }),
    );
    const lgl = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], total_items: 0 }), {
        status: 200,
        headers: { "content-type": "application/json", date: "Fri, 30 Oct 2026 17:00:00 GMT" },
      }),
    );
    vi.stubGlobal("fetch", lgl);
    const response = await worker.fetch(
      new Request("https://worker.test/api/community", { headers: { "X-HPIC-Auth": "test" } }),
      live,
    );
    return { body: (await response.json()) as CommunitySnapshot, lgl };
  }

  it("outlasts the hourly cron, including one run that failed", async () => {
    const { body, lgl } = await readAged(119 * minutes);
    expect(body.cached).toBe(true);
    expect(lgl).not.toHaveBeenCalled();
  });

  it("reads LGL again once two runs have been missed", async () => {
    const { body, lgl } = await readAged(121 * minutes);
    expect(body.cached).toBe(false);
    expect(lgl).toHaveBeenCalled();
  });
});

const CONFIG_ENV = {
  LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
  LGL_ANNUAL_FUND_CAMPAIGN_IDS: "872",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
  LGL_NON_DONATION_CATEGORY_IDS: "6134",
};
