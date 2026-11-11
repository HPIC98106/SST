/**
 * The Membership tab: members from LGL's membership records, donors and giving
 * from its gift records.
 *
 * Pinned: members are LGL's active list, never counted from dues gifts; "new"
 * means a first membership this year; only cash gift types count; dues, grant
 * payments and purchases do not make a donor or count as giving; a membership is
 * one dues payment and its type comes from the amount; a member's latest dues gift says how
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
});

describe("dues-paying memberships", () => {
  const RATED = communityConfig({
    LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
    LGL_MEMBERSHIP_CATEGORY_IDS: "6081",
    LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS: "6096",
    LGL_DUES_RATES: "Classic individual=20,20.60;Classic household=40,41.20;Champion individual=100,103;Champion household=200,206",
    LGL_UI_BASE_URL: "https://lgl.test",
  } as Env);
  const classic = (id: number, relationships: LglMember["relationships"] = []): LglMember => ({
    ...member(id, ["Classic", "2026-02-01", "2027-02-01"]),
    relationships,
  });
  const paid = (who: number, amount: number, category = 6096, date = "2026-02-01") =>
    gift({ constituent_id: who, gift_category_id: category, campaign_id: 846, received_amount: amount, received_date: date });
  const credited = (who: number, payment: LglGift) =>
    gift({
      constituent_id: who,
      gift_type_name: "Soft Credit",
      gift_category_id: payment.gift_category_id,
      parent_gift_id: payment.id,
      received_amount: payment.received_amount,
      received_date: payment.received_date,
    });
  const memberships = (gifts: LglGift[], active: LglMember[], config = RATED) =>
    assembleCommunity(gifts, active, "2026-10-30", config, BASE).members!.memberships;
  const type = (m: NonNullable<ReturnType<typeof memberships>>, level: string, kind: string) =>
    m.types.find((t) => t.level === level && t.type === kind)!;
  const finding = (m: NonNullable<ReturnType<typeof memberships>>, key: string) => m.findings.find((f) => f.key === key)!;

  it("counts one membership per dues payment, with everyone credited on it", () => {
    const household = paid(1, 41.2);
    const m = memberships(
      [household, credited(2, household), credited(3, household), paid(4, 20), paid(5, 103)],
      [classic(1), classic(2), classic(3), classic(4), classic(5)],
    )!;
    // Five people on three payments: one household of three and two individuals.
    expect(m.total).toBe(3);
    expect(type(m, "Classic", "household")).toMatchObject({ count: 1, rate: 40, expected: 40 });
    expect(type(m, "Classic", "individual")).toMatchObject({ count: 1, rate: 20, expected: 20 });
    // The card fee is not dues: $103 is a $100 membership.
    expect(type(m, "Champion", "individual")).toMatchObject({ count: 1, rate: 100, expected: 100 });
    expect(m.expectedDues).toBe(160);
  });

  it("takes the type from what was paid, not from who is linked to whom", () => {
    // Paid the household rate, but nobody in LGL is linked to them: still a household membership.
    const unlinked = memberships([paid(1, 40)], [classic(1)])!;
    expect(type(unlinked, "Classic", "household").count).toBe(1);
    expect(finding(unlinked, "household_one_member").records).toMatchObject([{ kind: "gift", amount: 40 }]);

    // Linked partners who each paid the individual rate: two memberships, not one household.
    const link = (to: number) => [{ name: "Spouse/Partner", related_constituent_id: to }];
    const partners = memberships([paid(1, 20), paid(2, 20)], [classic(1, link(2)), classic(2, link(1))])!;
    expect(partners.total).toBe(2);
    expect(type(partners, "Classic", "individual").count).toBe(2);
    expect(finding(partners, "separate_individual").records.map((r) => [r.kind, r.id])).toEqual([["member", 1], ["member", 2]]);
  });

  it("uses each member's latest dues payment", () => {
    // Was an individual last year, a household this year.
    const m = memberships([paid(1, 20, 6081, "2025-02-01"), paid(1, 40, 6096, "2026-02-01")], [classic(1)])!;
    expect(m.total).toBe(1);
    expect(type(m, "Classic", "household").count).toBe(1);
    expect(type(m, "Classic", "individual").count).toBe(0);
  });

  it("counts a payment matching no rate, but in no type and not in expected dues", () => {
    const odd = paid(1, 80);
    const m = memberships([odd, paid(2, 20)], [classic(1), classic(2)])!;
    expect(m).toMatchObject({ total: 2, unmatched: 1, expectedDues: 20 });
    expect(finding(m, "unmatched_amount").records).toEqual([{ id: odd.id, kind: "gift", amount: 80, url: `https://lgl.test/gifts/${odd.id}` }]);
  });

  it("leaves a member with no dues payment out of every membership", () => {
    const m = memberships([paid(1, 20)], [classic(1), classic(2)])!;
    expect(m.total).toBe(1);
  });

  it("ignores a payment by someone who is not an active member", () => {
    expect(memberships([paid(9, 40)], [classic(1)])!.total).toBe(0);
  });

  it("flags an individual-rate payment with several members credited", () => {
    const single = paid(1, 20);
    const m = memberships([single, credited(2, single)], [classic(1), classic(2)])!;
    expect(finding(m, "individual_several_members").records.map((r) => r.id)).toEqual([single.id]);
  });

  it("reports every check, so an empty one reads as checked", () => {
    const m = memberships([paid(1, 20)], [classic(1)])!;
    expect(m.findings.map((f) => [f.key, f.records.length])).toEqual([
      ["household_one_member", 0],
      ["individual_several_members", 0],
      ["separate_individual", 0],
      ["unmatched_amount", 0],
    ]);
  });

  it("still counts memberships when relationships did not come back", () => {
    const { relationships: _, ...bare } = classic(1);
    expect(memberships([paid(1, 20)], [bare])!.total).toBe(1);
  });

  it("shows nothing without rates, or with a rate it cannot read", () => {
    const gifts = [paid(1, 20)];
    expect(memberships(gifts, [classic(1)], { ...RATED, duesRates: null })).toBeNull();
    expect(communityConfig({ LGL_DUES_RATES: "Classic individual=20;Classic family=40" } as Env).duesRates).toBeNull();
    expect(communityConfig({ LGL_DUES_RATES: "Classic individual=twenty" } as Env).duesRates).toBeNull();
    expect(communityConfig({} as Env).duesRates).toBeNull();
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
    // The Overview's renew-by-hand search (7 for 7 on 2026-11-01), one month at a time.
    expect(row.manualUrl).toBe(`${UI}/constituents/search/comb/and:and/gift_from/2026-01-01/gift_to/2026-02-28/in-gct/6081/in-gifts_type/1,7,8,9,12/md_fl/latest/md_type/end/me_from/2027-02-01/me_to/2027-02-28/memberd/1/members/1`);
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
    expect(snapshot.renewals!.rows[0]).toMatchObject({ url: null, autoRenewUrl: null, manualUrl: null });
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
      state.storage.put("community-v6", { snapshot, cachedAt: Date.now() - age }),
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

describe("the last thirty days", () => {
  const TODAY = "2026-11-01";
  const recent = (gifts: LglGift[], active: LglMember[] = []) => assembleCommunity(gifts, active, TODAY, LINKED, BASE).recent!;
  const LINKED = communityConfig({
    LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
    LGL_GRANT_CAMPAIGN_IDS: "871",
    LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
    LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
    LGL_NON_DONATION_CATEGORY_IDS: "6134",
    LGL_UI_BASE_URL: "https://lgl.test",
  } as Env);

  it("counts thirty days including today, and nothing older", () => {
    // October 3 is the thirtieth day back; October 2 is the thirty-first.
    const window = recent([dues(1, "2026-10-03", 40), dues(2, "2026-10-02", 100), dues(3, TODAY, 20)]);
    expect(window.from).toBe("2026-10-03");
    expect(window.dues).toMatchObject({ count: 2, amount: 60 });
  });

  it("keeps dues, grant payments and purchases out of gifts", () => {
    const window = recent([
      dues(1, "2026-10-20"),
      gift({ constituent_id: 2, campaign_id: 882, received_amount: 50, received_date: "2026-10-20" }),
      gift({ constituent_id: 3, campaign_id: 887, gift_category_id: 6134, received_amount: 500, received_date: "2026-10-20" }),
      gift({ constituent_id: 4, campaign_id: 841, gift_category_id: 6076, received_amount: 7000, received_date: "2026-10-20" }),
    ]);
    expect(window.gifts).toMatchObject({ count: 1, amount: 50 });
    expect(window.programGrantPayments).toMatchObject({ count: 1, amount: 7000 });
    expect(window.dues).toMatchObject({ count: 1, amount: 40 });
  });

  it("leaves rebuild grant payments out: they are on the Rebuild tab", () => {
    const rebuildAward = gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: 871, received_amount: 100000, received_date: "2025-01-01" });
    const window = recent([
      rebuildAward,
      gift({ constituent_id: 4, gift_category_id: 6076, parent_gift_id: rebuildAward.id, received_amount: 38000, received_date: "2026-10-20" }),
      gift({ constituent_id: 5, campaign_id: 841, gift_category_id: 6076, received_amount: 7000, received_date: "2026-10-20" }),
    ]);
    expect(window.programGrantPayments).toMatchObject({ count: 1, amount: 7000 });
  });

  it("calls a member new only if their first record began in the window", () => {
    const window = recent([], [
      member(1, ["Classic", "2026-10-15", "2027-10-15"]),
      member(2, ["Classic", "2026-09-01", "2027-09-01"]),
      // Came back after years away: a record in the window, but not their first.
      member(3, ["Classic", "2019-03-01", "2020-03-01"], ["Classic", "2026-10-15", "2027-10-15"]),
    ]);
    expect(window.newMembers?.count).toBe(1);
  });

  it("will not count new members when one has no dated record", () => {
    expect(recent([], [{ id: 1, memberships: [] }]).newMembers).toBeNull();
  });

  it("opens each figure's own records in LGL", () => {
    const paid = gift({ constituent_id: 4, campaign_id: 841, gift_category_id: 6076, received_amount: 7000, received_date: "2026-10-20" });
    const window = recent([paid]);
    expect(window.newMembers?.url).toBe(
      "https://lgl.test/constituents/search/comb/and:and/md_fl/first/md_type/start/me_from/2026-10-03/me_to/2026-11-01/memberd/1/members/1",
    );
    expect(window.dues?.url).toBe("https://lgl.test/fundraising/search/gt/gift/phase/1,12/campaign/846/from/2026-10-03/to/2026-11-01");
    expect(window.gifts?.url).toBe(
      "https://lgl.test/fundraising/search/gt/gift/phase/1,12/ni-campaign/846/ni-category/6076,6134/from/2026-10-03/to/2026-11-01",
    );
    expect(window.programGrantPayments?.url).toBe(`https://lgl.test/fundraising/search/gt/gift/gids/${paid.id}`);
  });
});

describe("memberships ending soon", () => {
  const ending = (id: number, finish: string): LglMember => member(id, ["Classic", "2025-06-01", finish]);
  const recurring = (who: number) => gift({ constituent_id: who, gift_category_id: 6096, received_amount: 40, received_date: "2026-01-05" });
  const manual = (who: number) => gift({ constituent_id: who, gift_category_id: 6081, received_amount: 40, received_date: "2026-01-05" });

  it("counts ninety days including today, by how each renews", () => {
    const soon = assemble([recurring(1), manual(2), recurring(4)], "2026-11-01", [
      ending(1, "2026-11-20"),
      ending(2, "2027-01-29"), // The ninetieth day.
      ending(3, "2026-12-01"), // No dues gift on record.
      ending(4, "2027-01-30"), // The ninety-first.
    ]).renewals!.soon;
    expect(soon).toMatchObject({ from: "2026-11-01", through: "2027-01-29", total: 3, autoRenew: 1, manual: 1, noDues: 1 });
  });

  it("lists every member with no dues by LGL record, soonest ending first", () => {
    const linked = communityConfig({ ...CONFIG_ENV, LGL_MEMBERSHIP_CATEGORY_IDS: "6081", LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS: "6096", LGL_UI_BASE_URL: "https://lgl.test" } as Env);
    const renewals = assembleCommunity([manual(2)], [ending(5, "2027-08-01"), ending(2, "2027-01-29"), ending(3, "2026-12-01")], "2026-11-01", linked, BASE).renewals!;
    expect(renewals.noDuesMembers).toEqual([
      { id: 3, level: "Classic", finish: "2026-12-01", url: "https://lgl.test/constituents/3" },
      { id: 5, level: "Classic", finish: "2027-08-01", url: "https://lgl.test/constituents/5" },
    ]);
    expect(renewals.noDuesMembers.length).toBe(renewals.noDues);
  });

  it("links renew by hand to the search that matched it in LGL", () => {
    const linked = communityConfig({ ...CONFIG_ENV, LGL_MEMBERSHIP_CATEGORY_IDS: "6081", LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS: "6096", LGL_UI_BASE_URL: "https://lgl.test" } as Env);
    const soon = assembleCommunity([manual(2)], [ending(2, "2027-01-29")], "2026-11-01", linked, BASE).renewals!.soon;
    // Run on 2026-11-01: 7 against the dashboard's 7, and 33 for 33 with category 6096.
    expect(soon.manualUrl).toBe(
      "https://lgl.test/constituents/search/comb/and:and/gift_from/2025-10-01/gift_to/2026-01-29/in-gct/6081/in-gifts_type/1,7,8,9,12/md_fl/latest/md_type/end/me_from/2026-11-01/me_to/2027-01-29/memberd/1/members/1",
    );
  });
});
