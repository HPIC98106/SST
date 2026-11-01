/**
 * The Membership tab: members from LGL's membership records, donors and giving
 * from its gift records.
 *
 * Pinned: members are LGL's active list, never counted from dues gifts; "new"
 * means a first membership this year; only cash gift types count; dues, grant
 * payments and purchases do not make a donor or count as giving; households are
 * people linked to another active member; a member's latest dues gift says how
 * they renew, and no gift means nothing says so; the next quarter wraps into the
 * new year correctly; operating awards report what is still to arrive; a page walk
 * that stops early reports nothing at all; the cached snapshot outlasts the cron
 * that rewrites it; and each link uses the search that was checked against LGL.
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
  LGL_MEMBERSHIP_CATEGORY_IDS: "6081",
  LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS: "6096",
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
  relationships: [],
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
    expect(snapshot.members?.byLevel.map((l) => [l.level, l.count])).toEqual([["Classic", 2], ["Champion", 1]]);
  });

  const linked = (id: number, to: number, name = "Household"): LglMember => ({
    ...member(id, ["Classic", "2026-02-01", "2027-02-01"]),
    relationships: [{ name, related_constituent_id: to }],
  });

  it("makes one household of people linked through each other", () => {
    const snapshot = assemble([], "2026-10-30", [
      // 2 is linked to both 1 and 3, who are not linked to each other.
      linked(1, 2),
      linked(2, 3),
      member(3, ["Classic", "2026-02-01", "2027-02-01"]),
      linked(4, 5, "Spouse/Partner"),
      member(5, ["Champion", "2026-02-01", "2027-02-01"]),
      member(6, ["Classic", "2026-02-01", "2027-02-01"]),
    ]);
    expect(snapshot.members?.households).toBe(2);
    const classic = snapshot.members?.byLevel.find((l) => l.level === "Classic");
    expect(classic).toMatchObject({ count: 5, inHousehold: 4, individual: 1 });
    expect(snapshot.members?.byLevel.find((l) => l.level === "Champion")).toMatchObject({ inHousehold: 1, individual: 0 });
  });

  it("does not count a link to someone who is not an active member", () => {
    const snapshot = assemble([], "2026-10-30", [linked(1, 99)]);
    expect(snapshot.members?.households).toBe(0);
    expect(snapshot.members?.byLevel[0]).toMatchObject({ inHousehold: 0, individual: 1 });
  });

  it("does not count a relationship that is not a household", () => {
    const snapshot = assemble([], "2026-10-30", [linked(1, 2, "Employer"), member(2, ["Classic", "2026-02-01", "2027-02-01"])]);
    expect(snapshot.members?.households).toBe(0);
  });

  it("says nothing about households when relationships did not come back", () => {
    const { relationships: _, ...bare } = member(1, ["Classic", "2026-02-01", "2027-02-01"]);
    const snapshot = assemble([], "2026-10-30", [bare]);
    expect(snapshot.members?.households).toBeNull();
    expect(snapshot.members?.byLevel[0]).toMatchObject({ count: 1, inHousehold: null, individual: null });
  });

  it("counts dues from cash only, and only up to LGL's own today", () => {
    const snapshot = assemble([
      dues(1, "2026-03-01"),
      dues(5, "2026-11-02"),
      gift({ gift_type_name: "Soft Credit", constituent_id: 2, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "In Kind", constituent_id: 3, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
      gift({ gift_type_name: "Pledge", constituent_id: 4, campaign_id: 846, received_amount: 40, received_date: "2026-03-01" }),
    ]);
    expect(snapshot.members?.dues).toMatchObject({ payers: 1, amount: 40 });
    expect(snapshot.giftCount).toBe(1);
  });
});

describe("renewals", () => {
  const paid = (who: number, date: string, category: number, type = "Gift") =>
    gift({ constituent_id: who, gift_type_name: type, gift_category_id: category, received_date: date, received_amount: 40 });
  const ending = (id: number, finish: string) => member(id, ["Classic", "2026-01-01", finish]);

  it("sorts each member into the month they run out, by how their latest dues gift was paid", () => {
    const snapshot = assemble(
      [paid(1, "2025-11-05", 6096), paid(2, "2025-11-09", 6081)],
      "2026-10-30",
      [ending(1, "2026-11-05"), ending(2, "2026-11-09"), ending(3, "2026-11-20")],
    );
    expect(snapshot.renewals?.rows[0]).toMatchObject({ month: "2026-11", total: 3, autoRenew: 1, manual: 1, noDues: 1 });
    expect(snapshot.renewals).toMatchObject({ autoRenew: 1, manual: 1, noDues: 1 });
  });

  it("goes by the latest gift when a member changed how they pay", () => {
    const snapshot = assemble(
      [paid(1, "2024-11-05", 6096), paid(1, "2025-11-05", 6081), paid(2, "2024-11-05", 6081), paid(2, "2025-11-05", 6096)],
      "2026-10-30",
      [ending(1, "2026-11-05"), ending(2, "2026-11-05")],
    );
    expect(snapshot.renewals).toMatchObject({ autoRenew: 1, manual: 1 });
  });

  it("counts a household member by the soft credit on the shared payment", () => {
    const snapshot = assemble([paid(2, "2025-11-05", 6096, "Soft Credit")], "2026-10-30", [ending(2, "2026-11-05")]);
    expect(snapshot.renewals).toMatchObject({ autoRenew: 1, noDues: 0 });
  });

  it("does not read a gift outside the dues categories as a renewal", () => {
    const snapshot = assemble([paid(1, "2025-11-05", 6011)], "2026-10-30", [ending(1, "2026-11-05")]);
    expect(snapshot.renewals).toMatchObject({ noDues: 1, manual: 0, autoRenew: 0 });
  });

  it("lists the next twelve months, even empty ones, and rolls anything later into one row", () => {
    const snapshot = assemble([], "2026-10-30", [ending(1, "2028-09-01")]);
    const rows = snapshot.renewals!.rows;
    expect(rows.map((r) => r.month)).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", null,
    ]);
    expect(rows.at(-1)).toMatchObject({ total: 1, url: null });
  });

  it("keeps this month's row when someone still runs out in it", () => {
    const snapshot = assemble([], "2026-10-30", [ending(1, "2026-10-31")]);
    expect(snapshot.renewals!.rows[0]).toMatchObject({ month: "2026-10", total: 1 });
  });

  it("adds up to total members, and owns up to anyone with no end date", () => {
    const snapshot = assemble([], "2026-10-30", [ending(1, "2026-11-05"), { id: 2, memberships: [{ membership_level_name: "Classic" }], relationships: [] }]);
    expect(snapshot.renewals?.undated).toBe(1);
    expect(snapshot.renewals!.rows.reduce((s, r) => s + r.total, 0) + snapshot.renewals!.undated).toBe(snapshot.members!.total);
  });

  it("leaves the table off rather than calling everyone manual when the categories are unset", () => {
    const config = communityConfig({ LGL_MEMBERSHIP_CAMPAIGN_IDS: "846" } as Env);
    expect(assembleCommunity([], [ending(1, "2026-11-05")], "2026-10-30", config, BASE).renewals).toBeNull();
  });
});

describe("links into LGL", () => {
  const UI = "https://example.littlegreenlight.com";
  const config = communityConfig({
    LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
    LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
    LGL_NON_DONATION_CATEGORY_IDS: "6134",
    LGL_MEMBERSHIP_CATEGORY_IDS: "6081",
    LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS: "6096",
    LGL_UI_BASE_URL: UI,
  } as Env);
  const withLinks = (gifts: LglGift[], active: LglMember[] = []) => assembleCommunity(gifts, active, "2026-10-30", config, BASE);

  // Each of these was run in LGL on 2026-10-31 and landed on the dashboard's count.
  it("opens members, new members and a level with the searches checked against LGL", () => {
    const active: LglMember[] = [{ id: 1, relationships: [], memberships: [{ membership_level_id: 396, membership_level_name: "Classic", date_start: "2026-02-01", finish_date: "2027-02-01" }] }];
    const { members } = withLinks([], active);
    expect(members?.url).toBe(`${UI}/constituents/search/comb/and:and/members/1`);
    expect(members?.newUrl).toBe(`${UI}/constituents/search/comb/and:and/md_fl/first/md_type/start/me_from/2026-01-01/me_to/2026-12-31/memberd/1/members/1`);
    expect(members?.byLevel[0].url).toBe(`${UI}/constituents/search/comb/and:and/member_type/396/members/1`);
  });

  it("opens a renewal month, and its automatic ones, by the month's real last day", () => {
    const active: LglMember[] = [{ id: 1, relationships: [], memberships: [{ membership_level_name: "Classic", date_start: "2025-11-05", finish_date: "2027-02-05" }] }];
    const row = withLinks([], active).renewals!.rows.find((r) => r.month === "2027-02")!;
    expect(row.url).toBe(`${UI}/constituents/search/comb/and:and/md_fl/latest/md_type/end/me_from/2027-02-01/me_to/2027-02-28/memberd/1/members/1`);
    expect(row.autoRenewUrl).toBe(`${UI}/constituents/search/comb/and:and/in-gct/6096/in-gifts_type/1,7,8,9,12/md_fl/latest/md_type/end/me_from/2027-02-01/me_to/2027-02-28/memberd/1/members/1`);
  });

  it("opens a campaign's gifts for each year, leaving out what giving leaves out", () => {
    const { byCampaign } = withLinks([gift({ constituent_id: 1, campaign_id: 882, campaign_name: "Individual Giving", received_amount: 50, received_date: "2026-02-01" })]);
    expect(byCampaign[0].thisYearUrl).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/campaign/882/ni-category/6076,6134/from/2026-01-01/to/2026-10-30`);
    expect(byCampaign[0].lastYearUrl).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/campaign/882/ni-category/6076,6134/from/2025-01-01/to/2025-12-31`);
  });

  it("opens the gifts behind the donor count", () => {
    const { donors } = withLinks([gift({ constituent_id: 1, campaign_id: 882, received_amount: 50, received_date: "2026-02-01" })]);
    expect(donors).toMatchObject({ thisYear: 1, gifts: 1 });
    expect(donors?.giftsUrl).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/ni-campaign/846/ni-category/6076,6134/from/2026-01-01/to/2026-10-30`);
  });

  it("opens gifts with no campaign through LGL's blank-campaign search", () => {
    const { byCampaign } = withLinks([gift({ constituent_id: 1, received_amount: 50, received_date: "2026-02-01" })]);
    expect(byCampaign[0].campaign).toBe("No campaign");
    expect(byCampaign[0].thisYearUrl).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/bl-campaign/1/ni-category/6076,6134/from/2026-01-01/to/2026-10-30`);
  });

  it("opens what the next three months brought last year, across the new year", () => {
    const annual = communityConfig({
      LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
      LGL_ANNUAL_FUND_CAMPAIGN_IDS: "872",
      LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
      LGL_UI_BASE_URL: UI,
    } as Env);
    const items = assembleCommunity([], [], "2026-10-30", annual, BASE).nextQuarter!.items;
    const url = (key: string) => items.find((i) => i.key === key)?.url;
    const range = "from/2025-11-01/to/2026-01-31";
    expect(url("annual_fund")).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/campaign/872/ni-category/6076/${range}`);
    expect(url("memberships")).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/campaign/846/ni-category/6076/${range}`);
    expect(url("other_giving")).toBe(`${UI}/fundraising/search/gt/gift/phase/1,12/ni-campaign/846,872/ni-category/6076/${range}`);
  });

  it("opens operating grants by gift ID, the open ones and their payments apart", () => {
    const grantConfig = communityConfig({ LGL_GRANT_GIFT_CATEGORY_IDS: "6031", LGL_GRANT_CAMPAIGN_IDS: "871", LGL_UI_BASE_URL: UI } as Env);
    const open = gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: 841, received_amount: 100, received_date: "2026-01-01" });
    const paid = gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: 841, received_amount: 50, received_date: "2026-01-01" });
    const payment = gift({ parent_gift_id: paid.id, received_amount: 50, received_date: "2026-02-01" });
    const scheduled = gift({ gift_type_name: "Installment", parent_gift_id: open.id, received_amount: 100, received_date: null });
    const grants = assembleCommunity([open, paid, payment, scheduled], [], "2026-10-30", grantConfig, BASE).operatingGrants!;
    expect(grants.awardedUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${open.id},${paid.id}`);
    expect(grants.receivedUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${payment.id}`);
    expect(grants.remainingUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${open.id}`);
  });

  it("offers no links without the LGL address", () => {
    const snapshot = assemble([gift({ constituent_id: 1, campaign_id: 882, received_amount: 50, received_date: "2026-02-01" })], "2026-10-30", [
      member(1, ["Classic", "2026-02-01", "2027-02-01"]),
    ]);
    expect(snapshot.members).toMatchObject({ url: null, newUrl: null });
    expect(snapshot.byCampaign[0].thisYearUrl).toBeNull();
    expect(snapshot.renewals!.rows[0]).toMatchObject({ url: null, autoRenewUrl: null });
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
  });

  it("keeps dues and purchases out of giving, and says how much was sold", () => {
    const snapshot = assemble([
      dues(1, "2026-05-01"),
      gift({ constituent_id: 2, gift_category_id: 6134, campaign_id: 887, campaign_name: "Pot Auction", received_amount: 300, received_date: "2026-04-18" }),
      gift({ constituent_id: 2, gift_category_id: 6134, campaign_id: 887, campaign_name: "Pot Auction", received_amount: 999, received_date: "2025-04-18" }),
      gift({ constituent_id: 3, campaign_id: 882, campaign_name: "Individual Giving", received_amount: 50, received_date: "2026-02-01" }),
    ]);
    expect(snapshot.byCampaign.map((c) => c.campaign)).toEqual(["Individual Giving"]);
    expect(snapshot.purchasesThisYear).toBe(300);
    expect(snapshot.monthly!.giving.thisYear[1]).toBe(50);
    expect(snapshot.monthly!.giving.thisYear[3]).toBe(0);
    expect(snapshot.monthly!.dues.thisYear[4]).toBe(40);
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
    expect(snapshot.donors).toMatchObject({ thisYear: 1, gifts: 1 });
  });

  it("will not count donors when dues cannot be told apart from gifts", () => {
    const config = communityConfig({ LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076" } as Env);
    const snapshot = assembleCommunity([dues(1, "2026-05-01")], [], "2026-10-30", config, BASE);
    expect(snapshot.donors).toBeNull();
    expect(snapshot.members?.dues).toBeNull();
  });

  it("reports a campaign's whole last year beside this year so far", () => {
    const given = (date: string, amount: number) =>
      gift({ constituent_id: 1, campaign_id: 882, campaign_name: "Individual Giving", received_amount: amount, received_date: date });
    const snapshot = assemble([given("2025-10-30", 40), given("2025-12-31", 100), given("2026-10-01", 25)]);
    expect(snapshot.byCampaign[0]).toMatchObject({ thisYear: 25, lastYearTotal: 140, gifts: 1 });
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
    expect(search.searchParams.get("expand")).toBe("memberships,relationships");
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
      state.storage.put("community-v3", { snapshot, cachedAt: Date.now() - age }),
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
