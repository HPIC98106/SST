/**
 * The Membership tab: members, donors and giving, from Little Green Light.
 *
 * Two reads. Members come from LGL's own membership records, using its Active
 * filter, so the count agrees with a membership report run in LGL. It is never
 * counted from dues gifts: only one person in a household pays, and the others
 * are soft-credited, so gifts find about half the members.
 *
 * Everything else comes from one read of every gift. Only cash gift types count
 * (Gift, Installment, Matching): a pledge is a promise, a soft credit is a second
 * record of a gift already counted, and in-kind is not money. Grant payments are
 * left out of donors and campaign giving because grants have their own tab and
 * would swamp everything else.
 *
 * The rule from the grant funnel holds here too: a walk that stops at its page
 * cap reports nothing, because a partial walk undercounts members and giving
 * in a way nobody would notice.
 *
 * "This year" is the calendar year by LGL's own clock (its Date header, as a
 * Seattle date), never the Worker's.
 */

import { getAll, isFixtureMode, parseIds, type LglGift } from "./lgl";
import { communityFixtureGifts, communityFixtureMembers, COMMUNITY_FIXTURE_DATE } from "./community-fixtures";
import type { CampaignGiving, CommunitySnapshot, Env, ExpectedInflow, OperatingAward } from "./types";

export const COMMUNITY_SOURCE = "LGL membership and gift records";

/** 50 pages of 100: room for several times HPIC's gift history today. */
const COMMUNITY_MAX_PAGES = 50;

const CASH_TYPES = new Set(["Gift", "Installment", "Matching"]);

/** Gifts as this module reads them: the shared shape plus the type's name. */
export type CommunityGift = LglGift;

/** One membership on a constituent, from `expand=memberships`. */
export interface LglMembership {
  membership_level_name?: string | null;
  date_start?: string | null;
  finish_date?: string | null;
}

/** An active member. Names come back on this record and are never read. */
export interface LglMember {
  id: number;
  memberships?: LglMembership[] | null;
}

export interface CommunityConfig {
  membershipCampaigns: number[];
  annualFundCampaigns: number[];
  grantCampaigns: number[];
  awardCategories: number[];
  paymentCategories: number[];
  nonDonationCategories: number[];
  uiBaseUrl: string | null;
}

export function communityConfig(env: Env): CommunityConfig {
  return {
    membershipCampaigns: parseIds(env.LGL_MEMBERSHIP_CAMPAIGN_IDS),
    annualFundCampaigns: parseIds(env.LGL_ANNUAL_FUND_CAMPAIGN_IDS),
    grantCampaigns: parseIds(env.LGL_GRANT_CAMPAIGN_IDS),
    awardCategories: parseIds(env.LGL_GRANT_GIFT_CATEGORY_IDS),
    paymentCategories: parseIds(env.LGL_GRANT_PAYMENT_CATEGORY_IDS),
    nonDonationCategories: parseIds(env.LGL_NON_DONATION_CATEGORY_IDS),
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
 * Who is a member today, from LGL's list of active members.
 *
 * New means a first membership that began this year, so someone returning after
 * a lapse is not new. A member with no dated record cannot be judged either way,
 * which blanks the count rather than quietly leaving them out of it.
 */
function countMembers(
  active: LglMember[],
  year: number,
): Pick<NonNullable<CommunitySnapshot["members"]>, "total" | "newThisYear" | "byLevel"> {
  const levels = new Map<string, number>();
  let newThisYear: number | null = 0;

  for (const member of active) {
    const records = member.memberships ?? [];
    const starts = records.map((r) => r.date_start).filter((d): d is string => Boolean(d)).sort();
    if (starts.length === 0) newThisYear = null;
    else if (newThisYear !== null && starts[0].startsWith(`${year}-`)) newThisYear += 1;

    // The record running latest is the level they hold now.
    const current = [...records].sort((a, b) => (b.finish_date ?? "").localeCompare(a.finish_date ?? ""))[0];
    const level = current?.membership_level_name?.trim() || "No level";
    levels.set(level, (levels.get(level) ?? 0) + 1);
  }

  return {
    total: active.length,
    newThisYear,
    byLevel: [...levels.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * Everything on the Membership tab, from the active members and every gift.
 *
 * Exported for tests: the arithmetic is where this tab can be wrong, and it
 * is easier to pin against a handful of hand-built gifts than a live walk.
 */
export function assembleCommunity(
  gifts: LglGift[],
  activeMembers: LglMember[],
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
  const haveDues = config.membershipCampaigns.length > 0;
  const isDuesGift = inCampaigns(config.membershipCampaigns);

  const duesThisYear = giving.filter((g) => isDuesGift(g) && inYear(year)(g));
  const members: CommunitySnapshot["members"] = {
    ...countMembers(activeMembers, year),
    dues: haveDues ? { payers: people(duesThisYear).size, amount: dollars(sum(duesThisYear)) } : null,
  };

  // Donors: people who gave a gift, as distinct from paying dues or buying
  // something. Without the dues campaigns the two cannot be told apart.
  const donors: CommunitySnapshot["donors"] = haveDues
    ? {
        thisYear: people(
          giving.filter(
            (g) => inYear(year)(g) && !isDuesGift(g) && !config.nonDonationCategories.includes(g.gift_category_id ?? -1),
          ),
        ).size,
      }
    : null;

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
    dues: series(haveDues ? giving.filter(isDuesGift) : []),
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
  const isFund = inCampaigns(config.annualFundCampaigns);
  const items: ExpectedInflow[] = [];
  if (config.annualFundCampaigns.length > 0) {
    items.push({ key: "annual_fund", label: "Annual Fund Drive", amount: dollars(sum(inWindow.filter(isFund))) });
  }
  if (haveDues) {
    items.push({ key: "memberships", label: "Membership dues", amount: dollars(sum(inWindow.filter(isDuesGift))) });
  }
  items.push({
    key: "other_giving",
    label: "Other giving",
    amount: dollars(sum(inWindow.filter((g) => !isDuesGift(g) && !isFund(g)))),
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
    donors,
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
    donors: null,
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
      ...assembleCommunity(communityFixtureGifts(), communityFixtureMembers(), seattleDate(COMMUNITY_FIXTURE_DATE)!, config, {
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

  const active = await getAll<LglMember>(
    env,
    "constituents/search",
    [["q[]", "membership_status=1"], ["expand", "memberships"]],
    COMMUNITY_MAX_PAGES,
  );
  if (!active.ok) return empty("unavailable", "unavailable", active.detail);
  if (!active.complete) {
    return empty(
      "unavailable",
      "ok",
      `LGL holds more active members than one read allows (${COMMUNITY_MAX_PAGES * 100}), so any count would be short. Nothing is shown.`,
    );
  }

  return assembleCommunity(read.items, active.items, today, config, { retrievedAt: read.date, connection: "ok" });
}
