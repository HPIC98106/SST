/**
 * The Community tab: members, supporters and giving from LGL gift records.
 *
 * Pinned: only cash gift types count; grant payments are never supporters;
 * "same period last year" stops at the same day; the next quarter wraps into
 * the new year correctly; operating awards report what is still to arrive; and
 * a page walk that stops early reports nothing at all.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleCommunity, communityConfig, getCommunity, seattleDate } from "../src/community";
import type { LglGift } from "../src/lgl";
import type { Env } from "../src/types";

const CONFIG = communityConfig({
  LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
  LGL_ANNUAL_FUND_CAMPAIGN_IDS: "872",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
} as Env);

let next = 1;
const gift = (fields: Partial<LglGift>): LglGift =>
  ({ id: next++, gift_type_name: "Gift", received_amount: 0, ...fields }) as LglGift;
const dues = (who: number, date: string, amount = 40) =>
  gift({ constituent_id: who, campaign_id: 846, campaign_name: "Memberships", received_amount: amount, received_date: date });

const BASE = { retrievedAt: "Fri, 30 Oct 2026 17:00:00 GMT", connection: "ok" } as const;
const assemble = (gifts: LglGift[], today = "2026-10-30") => assembleCommunity(gifts, today, CONFIG, BASE);

describe("members", () => {
  it("counts renewals, newcomers and who is still to renew", () => {
    const snapshot = assemble([
      dues(1, "2025-05-01"), dues(2, "2025-06-01"), dues(3, "2025-09-01", 100),
      dues(1, "2026-05-01"), dues(2, "2026-09-15"), dues(4, "2026-06-01"),
    ]);
    expect(snapshot.members).toMatchObject({
      thisYear: 3,
      lastYear: 3,
      renewed: 2,
      newThisYear: 1,
      dueToRenew: 1,
      dueToRenewAmount: 100,
      duesThisYear: 120,
    });
  });

  it("compares dues with the same days last year, not the whole of it", () => {
    const snapshot = assemble([dues(1, "2025-10-30", 40), dues(2, "2025-10-31", 100), dues(3, "2026-10-01", 40)]);
    expect(snapshot.members?.duesLastYearSamePeriod).toBe(40);
  });

  it("ignores pledges, soft credits and in-kind gifts", () => {
    const snapshot = assemble([
      dues(1, "2026-03-01"),
      gift({ gift_type_name: "Soft Credit", constituent_id: 2, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "In Kind", constituent_id: 3, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "Pledge", constituent_id: 4, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
    ]);
    expect(snapshot.members?.thisYear).toBe(1);
    expect(snapshot.giftCount).toBe(1);
  });

  it("does not count a gift dated after LGL's own today", () => {
    const snapshot = assemble([dues(1, "2026-10-29"), dues(2, "2026-11-02")]);
    expect(snapshot.members?.thisYear).toBe(1);
  });
});

describe("supporters and campaigns", () => {
  it("never counts a grant payment as a supporter or as campaign giving", () => {
    const snapshot = assemble([
      gift({ constituent_id: 10, campaign_id: 882, campaign_name: "Individual Giving", received_amount: 50, received_date: "2026-02-01" }),
      gift({ constituent_id: 11, gift_category_id: 6076, campaign_id: 871, campaign_name: "Rebuild Project", received_amount: 100000, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.supporters?.thisYear).toBe(1);
    expect(snapshot.byCampaign.map((c) => c.campaign)).toEqual(["Individual Giving"]);
  });

  it("counts who gave last year but not yet this year", () => {
    const snapshot = assemble([
      gift({ constituent_id: 10, campaign_id: 882, received_amount: 50, received_date: "2025-02-01" }),
      gift({ constituent_id: 11, campaign_id: 882, received_amount: 50, received_date: "2025-02-01" }),
      gift({ constituent_id: 10, campaign_id: 882, received_amount: 50, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.supporters).toEqual({ thisYear: 1, lastYear: 2, gaveLastYearNotYetThisYear: 1 });
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

  it("dates the year by LGL's clock in Seattle, not UTC", () => {
    // 3 a.m. UTC on January 1 is still December 31 in Seattle.
    expect(seattleDate("Thu, 01 Jan 2026 03:00:00 GMT")).toBe("2025-12-31");
  });

  it("renders the fixture company end to end", async () => {
    const snapshot = await getCommunity({ ...env, LGL_MODE: "fixture", ...CONFIG_ENV } as Env);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.members!.thisYear).toBeGreaterThan(snapshot.members!.lastYear);
    expect(snapshot.monthly!.dues.thisYear[11]).toBeNull();
  });
});

const CONFIG_ENV = {
  LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
  LGL_ANNUAL_FUND_CAMPAIGN_IDS: "872",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
};
