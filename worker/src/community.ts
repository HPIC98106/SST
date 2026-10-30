/**
 * Community: members, supporters and giving, from Little Green Light.
 *
 * One read of every gift, then everything is counted from it. Only cash gift
 * types count (Gift, Installment, Matching): a pledge is a promise, a soft
 * credit is a second record of a gift already counted, and in-kind is not
 * money. Grant payments are left out of supporters and campaign giving because
 * grants have their own tab and would swamp everything else.
 *
 * The rule from the grant funnel holds here too: a walk that stops at its page
 * cap reports nothing, because a partial walk undercounts members and giving
 * in a way nobody would notice.
 *
 * "This year" is the calendar year by LGL's own clock (its Date header, as a
 * Seattle date), never the Worker's.
 */

import { getAll, isFixtureMode, parseIds, type LglGift } from "./lgl";
import { communityFixtureGifts, COMMUNITY_FIXTURE_DATE } from "./community-fixtures";
import type { CampaignGiving, CommunitySnapshot, Env, ExpectedInflow, OperatingAward } from "./types";

export const COMMUNITY_SOURCE = "LGL gift records";

/** 50 pages of 100: room for several times HPIC's gift history today. */
const COMMUNITY_MAX_PAGES = 50;

const CASH_TYPES = new Set(["Gift", "Installment", "Matching"]);

/** Gifts as this module reads them: the shared shape plus the type's name. */
export type CommunityGift = LglGift;

export interface CommunityConfig {
  membershipCampaigns: number[];
  annualFundCampaigns: number[];
  grantCampaigns: number[];
  awardCategories: number[];
  paymentCategories: number[];
  uiBaseUrl: string | null;
}

export function communityConfig(env: Env): CommunityConfig {
  return {
    membershipCampaigns: parseIds(env.LGL_MEMBERSHIP_CAMPAIGN_IDS),
    annualFundCampaigns: parseIds(env.LGL_ANNUAL_FUND_CAMPAIGN_IDS),
    grantCampaigns: parseIds(env.LGL_GRANT_CAMPAIGN_IDS),
    awardCategories: parseIds(env.LGL_GRANT_GIFT_CATEGORY_IDS),
    paymentCategories: parseIds(env.LGL_GRANT_PAYMENT_CATEGORY_IDS),
    uiBaseUrl: env.LGL_UI_BASE_URL?.replace(/\/+$/, "") || null,
  };
}

/** A Seattle calendar date from an HTTP Date header. Null if it will not parse. */
export function seattleDate(httpDate: string | null): string | null {
  if (!httpDate) return null;
  const at = new Date(httpDate);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

const amountOf = (g: LglGift) => Math.round(Number(g.received_amount ?? g.amount ?? 0) * 100);
const dollars = (cents: number) => cents / 100;

function monthIndex(date: string): number {
  return Number(date.slice(5, 7)) - 1;
}

/** "2026-11" for the month `offset` months after `year`-`month0`+1. */
function monthKey(year: number, month0: number, offset = 0): string {
  const d = new Date(Date.UTC(year, month0 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Everything on the Community tab, from one list of gifts.
 *
 * Exported for tests: the arithmetic is where this tab can be wrong, and it
 * is easier to pin against a handful of hand-built gifts than a live walk.
 */
export function assembleCommunity(
  gifts: LglGift[],
  today: string,
  config: CommunityConfig,
  base: Pick<CommunitySnapshot, "retrievedAt" | "connection">,
): CommunitySnapshot {
  const year = Number(today.slice(0, 4));
  const lastYear = year - 1;
  const thisMonth = monthIndex(today);
  const sameDayLastYear = `${lastYear}${today.slice(4)}`;

  const cash = gifts.filter(
    (g) => CASH_TYPES.has(g.gift_type_name ?? "") && g.received_date && g.received_date <= today,
  );
  const isGrantPayment = (g: LglGift) => config.paymentCategories.includes(g.gift_category_id ?? -1);
  const inCampaigns = (ids: number[]) => (g: LglGift) => ids.includes(g.campaign_id ?? -1);
  const inYear = (y: number) => (g: LglGift) => g.received_date!.startsWith(`${y}-`);
  const sum = (list: LglGift[]) => list.reduce((s, g) => s + amountOf(g), 0);
  const people = (list: LglGift[]) => new Set(list.map((g) => g.constituent_id).filter((id) => id != null));

  const giving = cash.filter((g) => !isGrantPayment(g));

  // Members: anyone with a membership gift in the year.
  let members: CommunitySnapshot["members"] = null;
  if (config.membershipCampaigns.length > 0) {
    const dues = giving.filter(inCampaigns(config.membershipCampaigns));
    const now = people(dues.filter(inYear(year)));
    const before = people(dues.filter(inYear(lastYear)));
    const renewed = [...now].filter((id) => before.has(id)).length;
    const lapsed = [...before].filter((id) => !now.has(id));
    const lapsedSet = new Set(lapsed);
    members = {
      thisYear: now.size,
      lastYear: before.size,
      renewed,
      newThisYear: now.size - renewed,
      dueToRenew: lapsed.length,
      dueToRenewAmount: dollars(sum(dues.filter((g) => inYear(lastYear)(g) && lapsedSet.has(g.constituent_id!)))),
      duesThisYear: dollars(sum(dues.filter(inYear(year)))),
      duesLastYearSamePeriod: dollars(sum(dues.filter((g) => inYear(lastYear)(g) && g.received_date! <= sameDayLastYear))),
    };
  }

  // Supporters: distinct givers of any kind but grant payments.
  const givers = people(giving.filter(inYear(year)));
  const giversBefore = people(giving.filter(inYear(lastYear)));
  const supporters = {
    thisYear: givers.size,
    lastYear: giversBefore.size,
    gaveLastYearNotYetThisYear: [...giversBefore].filter((id) => !givers.has(id)).length,
  };

  // Monthly series for the charts.
  const months = Array.from({ length: 12 }, (_, i) => monthKey(year, i));
  const byMonth = (list: LglGift[], y: number) => {
    const out = Array<number>(12).fill(0);
    for (const g of list.filter(inYear(y))) out[monthIndex(g.received_date!)] += amountOf(g);
    return out;
  };
  const series = (list: LglGift[]) => ({
    thisYear: byMonth(list, year).map((c, i) => (i <= thisMonth ? dollars(c) : null)),
    lastYear: byMonth(list, lastYear).map(dollars),
  });
  const monthly = {
    months,
    dues: series(config.membershipCampaigns.length > 0 ? giving.filter(inCampaigns(config.membershipCampaigns)) : []),
    giving: series(giving),
  };

  // Giving by campaign, this year to date against the same days last year.
  const campaigns = new Map<string, { thisYear: number; same: number; total: number; gifts: number }>();
  for (const g of giving) {
    const key = g.campaign_name?.trim() || "No campaign";
    const row = campaigns.get(key) ?? { thisYear: 0, same: 0, total: 0, gifts: 0 };
    if (inYear(year)(g)) {
      row.thisYear += amountOf(g);
      row.gifts += 1;
    } else if (inYear(lastYear)(g)) {
      row.total += amountOf(g);
      if (g.received_date! <= sameDayLastYear) row.same += amountOf(g);
    } else {
      continue;
    }
    campaigns.set(key, row);
  }
  const byCampaign: CampaignGiving[] = [...campaigns.entries()]
    .map(([campaign, r]) => ({
      campaign,
      thisYear: dollars(r.thisYear),
      lastYearSamePeriod: dollars(r.same),
      lastYearTotal: dollars(r.total),
      gifts: r.gifts,
    }))
    .sort((a, b) => b.thisYear - a.thisYear || b.lastYearTotal - a.lastYearTotal);

  // The next three months, as the same months went a year earlier.
  const nextMonths = [1, 2, 3].map((n) => monthKey(year, thisMonth, n));
  const yearEarlier = new Set(nextMonths.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`));
  const inWindow = giving.filter((g) => yearEarlier.has(g.received_date!.slice(0, 7)));
  const isDues = inCampaigns(config.membershipCampaigns);
  const isFund = inCampaigns(config.annualFundCampaigns);
  const items: ExpectedInflow[] = [];
  if (config.annualFundCampaigns.length > 0) {
    items.push({ key: "annual_fund", label: "Annual Fund Drive", amount: dollars(sum(inWindow.filter(isFund))) });
  }
  if (config.membershipCampaigns.length > 0) {
    items.push({ key: "memberships", label: "Membership dues", amount: dollars(sum(inWindow.filter(isDues))) });
  }
  items.push({
    key: "other_giving",
    label: "Other giving",
    amount: dollars(sum(inWindow.filter((g) => !isDues(g) && !isFund(g)))),
  });

  // Grant awards outside the rebuild, and what is still to arrive on each.
  let operatingGrants: CommunitySnapshot["operatingGrants"] = null;
  if (config.awardCategories.length > 0) {
    const awards = gifts.filter(
      (g) =>
        g.gift_type_name === "Pledge" &&
        config.awardCategories.includes(g.gift_category_id ?? -1) &&
        !config.grantCampaigns.includes(g.campaign_id ?? -1),
    );
    const paid = new Map<number, number>();
    for (const g of cash) {
      if (g.parent_gift_id != null) paid.set(g.parent_gift_id, (paid.get(g.parent_gift_id) ?? 0) + amountOf(g));
    }
    const rows: OperatingAward[] = awards.map((a) => {
      const amount = amountOf(a);
      const received = paid.get(a.id) ?? 0;
      return {
        id: a.id,
        date: a.received_date ?? null,
        amount: dollars(amount),
        received: dollars(received),
        remaining: dollars(Math.max(amount - received, 0)),
        url: config.uiBaseUrl ? `${config.uiBaseUrl}/gifts/${a.id}` : null,
      };
    });
    const open = rows.filter((r) => r.remaining > 0).sort((a, b) => b.remaining - a.remaining);
    operatingGrants = {
      awarded: rows.reduce((s, r) => s + r.amount, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      remaining: open.reduce((s, r) => s + r.remaining, 0),
      awards: open,
    };
  }

  return {
    status: "ok",
    year,
    through: today,
    members,
    supporters,
    monthly,
    byCampaign,
    nextQuarter: { months: nextMonths, items },
    operatingGrants,
    giftCount: cash.length,
    cached: false,
    source: COMMUNITY_SOURCE,
    ...base,
  };
}

function empty(
  status: CommunitySnapshot["status"],
  connection: CommunitySnapshot["connection"],
  note: string,
): CommunitySnapshot {
  return {
    status,
    note,
    year: null,
    through: null,
    members: null,
    supporters: null,
    monthly: null,
    byCampaign: [],
    nextQuarter: null,
    operatingGrants: null,
    giftCount: 0,
    retrievedAt: null,
    cached: false,
    source: COMMUNITY_SOURCE,
    connection,
  };
}

export async function getCommunity(env: Env): Promise<CommunitySnapshot> {
  const config = communityConfig(env);

  if (isFixtureMode(env)) {
    return {
      ...assembleCommunity(communityFixtureGifts(), seattleDate(COMMUNITY_FIXTURE_DATE)!, config, {
        retrievedAt: COMMUNITY_FIXTURE_DATE,
        connection: "fixture",
      }),
      source: `${COMMUNITY_SOURCE} (fixture data)`,
    };
  }

  if (!env.LGL_API_KEY) {
    return empty("not_configured", "not_configured", "No LGL API key is set on the Worker.");
  }

  const read = await getAll<LglGift>(env, "gifts/search", [], COMMUNITY_MAX_PAGES);
  if (!read.ok) return empty("unavailable", "unavailable", read.detail);
  if (!read.complete) {
    return empty(
      "unavailable",
      "ok",
      `LGL holds more gifts than one read allows (${COMMUNITY_MAX_PAGES * 100}), so any count would be short. Nothing is shown.`,
    );
  }

  const today = seattleDate(read.date);
  if (!today) {
    return empty("unavailable", "ok", "LGL did not say what time it was, so this year cannot be told from last.");
  }

  return assembleCommunity(read.items, today, config, { retrievedAt: read.date, connection: "ok" });
}
