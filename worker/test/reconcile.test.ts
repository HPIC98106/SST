/**
 * LGL against QuickBooks.
 *
 * Pinned: a difference of one cent is a difference; an incomplete read on either
 * side means nothing was compared, never an empty list that looks like agreement;
 * only the completed months count, on both sides; a payment takes its award's scope,
 * and one with no award says so; a renamed QuickBooks line reports "not compared"
 * rather than comparing against nothing.
 */

import { describe, expect, it } from "vitest";
import { assembleCommunity, communityConfig } from "../src/community";
import { assembleReconciliation } from "../src/reconcile";
import type { LglGift } from "../src/lgl";
import type { CommunitySnapshot, Env, OperationsSnapshot } from "../src/types";

const CONFIG = communityConfig({
  LGL_MEMBERSHIP_CAMPAIGN_IDS: "846",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
  LGL_UI_BASE_URL: "https://lgl.test",
} as Env);

let next = 1;
const gift = (fields: Partial<LglGift>): LglGift => ({ id: next++, gift_type_name: "Gift", received_amount: 0, ...fields }) as LglGift;
const dues = (amount: number, date: string) => gift({ constituent_id: 1, campaign_id: 846, received_amount: amount, received_date: date });
const award = (campaign: number) => gift({ gift_type_name: "Pledge", gift_category_id: 6031, campaign_id: campaign, received_amount: 100000, received_date: "2025-01-01" });
const payment = (fields: Partial<LglGift>) => gift({ gift_category_id: 6076, ...fields });

const community = (gifts: LglGift[], today = "2026-11-01"): CommunitySnapshot =>
  assembleCommunity(gifts, [], today, CONFIG, { retrievedAt: "Sun, 01 Nov 2026 08:00:00 GMT", connection: "ok" });

const operations = (fields: Partial<OperationsSnapshot> = {}, dueAmount = 100, grantsAmount = 0, rebuildAmount = 0): OperationsSnapshot =>
  ({
    status: "ok",
    period: { fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31", through: "2026-10-31", completedMonths: 10, showingPriorYear: false },
    groups: [
      { side: "income", label: "Membership dues", actual: dueAmount, url: "https://qbo.test/dues", accounts: [] },
      { side: "income", label: "Grants", actual: grantsAmount, url: "https://qbo.test/grants", accounts: [] },
      { side: "spending", label: "Grants", actual: 999, url: null, accounts: [] },
    ],
    excluded: { income: rebuildAmount, spending: 0, accounts: [], url: "https://qbo.test/rebuild" },
    retrievedAt: "2026-11-01T01:00:00-07:00",
    ...fields,
  }) as OperationsSnapshot;

const row = (snapshot: ReturnType<typeof assembleReconciliation>, key: string) => snapshot.rows.find((r) => r.key === key)!;

describe("comparing LGL with QuickBooks", () => {
  it("calls equal amounts a match, and a single cent a difference", () => {
    const matched = assembleReconciliation(community([dues(100, "2026-03-01")]), operations({}, 100), CONFIG);
    expect(row(matched, "dues")).toMatchObject({ status: "match", lgl: 100, qbo: 100, difference: 0 });

    const off = assembleReconciliation(community([dues(100.01, "2026-03-01")]), operations({}, 100), CONFIG);
    expect(row(off, "dues")).toMatchObject({ status: "differs", difference: 0.01 });
  });

  it("reports the difference as LGL less QuickBooks", () => {
    const snapshot = assembleReconciliation(community([dues(17558.8, "2026-10-01")]), operations({}, 16612.4), CONFIG);
    expect(row(snapshot, "dues")).toMatchObject({ status: "differs", difference: 946.4 });
  });

  it("counts only the completed months QuickBooks reports, not the month in progress", () => {
    const snapshot = assembleReconciliation(community([dues(100, "2026-10-31"), dues(40, "2026-11-01")]), operations({}, 100), CONFIG);
    expect(row(snapshot, "dues").lgl).toBe(100);
    expect(row(snapshot, "dues").status).toBe("match");
  });

  it("sorts a payment by its award's campaign, even when it carries none of its own", () => {
    const rebuild = award(871);
    const operating = award(841);
    const gifts = [
      rebuild,
      operating,
      payment({ parent_gift_id: rebuild.id, campaign_id: 0, received_amount: 5000, received_date: "2026-02-01" }),
      payment({ parent_gift_id: operating.id, campaign_id: 841, received_amount: 700, received_date: "2026-02-01" }),
    ];
    const snapshot = assembleReconciliation(community(gifts), operations({}, 0, 700, 5000), CONFIG);
    expect(row(snapshot, "rebuild_grants")).toMatchObject({ status: "match", lgl: 5000, qbo: 5000 });
    expect(row(snapshot, "operating_grants")).toMatchObject({ status: "match", lgl: 700, qbo: 700 });
  });

  it("says when a payment linked to no award was sorted by its own campaign", () => {
    const gifts = [payment({ campaign_id: 871, received_amount: 2500, received_date: "2026-02-01" })];
    const snapshot = assembleReconciliation(community(gifts), operations({}, 0, 0, 2500), CONFIG);
    expect(row(snapshot, "rebuild_grants").note).toContain("linked to no award");
    expect(row(snapshot, "operating_grants").note).toBeUndefined();
  });

  it("ignores a spending line that shares an income line's name", () => {
    const snapshot = assembleReconciliation(community([]), operations({}, 0, 12), CONFIG);
    expect(row(snapshot, "operating_grants").qbo).toBe(12);
  });

  it("reports not compared, not zero, when QuickBooks has no such line", () => {
    const renamed = operations({ groups: [{ side: "income", label: "Memberships", actual: 100, accounts: [] }] as never });
    const snapshot = assembleReconciliation(community([dues(100, "2026-03-01")]), renamed, CONFIG);
    expect(row(snapshot, "dues")).toMatchObject({ status: "not_compared", qbo: null, difference: null });
    expect(row(snapshot, "dues").note).toContain("Membership dues");
  });

  it("links each side to its own records for the same months", () => {
    const paid = payment({ campaign_id: 871, received_amount: 1, received_date: "2026-02-01" });
    const snapshot = assembleReconciliation(community([paid, dues(100, "2026-03-01")]), operations(), CONFIG);
    expect(row(snapshot, "dues").lglUrl).toBe("https://lgl.test/fundraising/search/gt/gift/phase/1,12/campaign/846/from/2026-01-01/to/2026-10-31");
    expect(row(snapshot, "dues").qboUrl).toBe("https://qbo.test/dues");
    expect(row(snapshot, "rebuild_grants").lglUrl).toBe(`https://lgl.test/fundraising/search/gt/gift/gids/${paid.id}`);
    expect(row(snapshot, "rebuild_grants").qboUrl).toBe("https://qbo.test/rebuild");
  });
});

describe("refusing to compare", () => {
  it("compares nothing when LGL's read was incomplete", () => {
    const failed = { ...community([]), status: "unavailable", monthly: null } as CommunitySnapshot;
    const snapshot = assembleReconciliation(failed, operations(), CONFIG);
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [], period: null });
    expect(snapshot.note).toContain("LGL");
  });

  it("compares nothing when QuickBooks' read was incomplete", () => {
    const snapshot = assembleReconciliation(community([]), operations({ status: "unavailable", period: null }), CONFIG);
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [] });
    expect(snapshot.note).toContain("QuickBooks");
  });

  it("compares last year's full year in a new year's first month, from last year's gifts", () => {
    const period = { fiscalYearStart: "2025-01-01", fiscalYearEnd: "2025-12-31", through: "2025-12-31", completedMonths: 12, showingPriorYear: true };
    const snapshot = assembleReconciliation(
      community([dues(60, "2025-12-15"), dues(5, "2026-01-02")], "2026-01-10"),
      operations({ period }, 60),
      CONFIG,
    );
    expect(row(snapshot, "dues")).toMatchObject({ status: "match", lgl: 60 });
  });

  it("will not set a year it does not hold against QuickBooks", () => {
    const period = { fiscalYearStart: "2024-01-01", fiscalYearEnd: "2024-12-31", through: "2024-12-31", completedMonths: 12, showingPriorYear: true };
    const snapshot = assembleReconciliation(community([]), operations({ period }), CONFIG);
    expect(snapshot.status).toBe("unavailable");
  });
});
