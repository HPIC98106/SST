/**
 * The Membership and Giving tabs: members, donors and giving, from Little Green
 * Light.
 *
 * Two reads. Members come from LGL's own membership records, using its Active
 * filter, so the count agrees with a membership report run in LGL. It is never
 * counted from dues gifts: only one person in a household pays, and the others
 * are soft-credited, so gifts find about half the members.
 *
 * Everything else comes from one read of every gift. Only cash gift types count
 * (Gift, Installment, Matching): a pledge is a promise, a soft credit is a second
 * record of a gift already counted, and in-kind is not money. Giving means gifts:
 * dues are on Membership, grant payments on Grants, and purchases such as Pot
 * Auction sales in Operations, so none of them is counted in it.
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
import type { CampaignGiving, CommunitySnapshot, Env, ExpectedInflow, MemberLevel, OperatingAward, RenewalRow } from "./types";

export const COMMUNITY_SOURCE = "LGL membership and gift records";

/** 50 pages of 100: room for several times HPIC's gift history today. */
const COMMUNITY_MAX_PAGES = 50;

const CASH_TYPES = new Set(["Gift", "Installment", "Matching"]);

/** Gifts as this module reads them: the shared shape plus the type's name. */
export type CommunityGift = LglGift;

/** One membership on a constituent, from `expand=memberships`. */
export interface LglMembership {
  membership_level_id?: number | null;
  membership_level_name?: string | null;
  date_start?: string | null;
  finish_date?: string | null;
}

/** One relationship on a constituent, from `expand=relationships`. */
export interface LglRelationship {
  /** The relationship type's name, such as "Household". */
  name?: string | null;
  related_constituent_id?: number | null;
}

/** An active member. Names come back on this record and are never read. */
export interface LglMember {
  id: number;
  memberships?: LglMembership[] | null;
  relationships?: LglRelationship[] | null;
}

export interface CommunityConfig {
  membershipCampaigns: number[];
  annualFundCampaigns: number[];
  grantCampaigns: number[];
  awardCategories: number[];
  paymentCategories: number[];
  nonDonationCategories: number[];
  membershipCategories: number[];
  recurringMembershipCategories: number[];
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
    membershipCategories: parseIds(env.LGL_MEMBERSHIP_CATEGORY_IDS),
    recurringMembershipCategories: parseIds(env.LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS),
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

// --- Links into LGL's own searches ---
//
// LGL has no documented URLs for these. They are what its Advanced Search builds,
// and each was checked on 2026-10-31 to land on the same count as the figure it
// sits on. A link that opened a different number would be worse than no link.

/** Active members meeting `criteria`, a run of LGL search path segments. */
function memberSearch(config: CommunityConfig, criteria = ""): string | null {
  if (!config.uiBaseUrl) return null;
  return `${config.uiBaseUrl}/constituents/search/comb/and:and/${criteria ? `${criteria}/` : ""}members/1`;
}

/** Members whose membership record's start or end falls in a date range. */
const membershipDates = (kind: "start" | "end", which: "first" | "latest", from: string, to: string) =>
  `md_fl/${which}/md_type/${kind}/me_from/${from}/me_to/${to}/memberd/1`;

/**
 * Cash gifts meeting `criteria` between two dates. Type 1 is Gift and 12 Matching;
 * 13 Installment is left out because asking for it also lists the pledges above
 * those installments, and HPIC's only installments are grant payments, which
 * giving excludes anyway.
 */
function giftSearch(config: CommunityConfig, criteria: string, from: string, to: string): string | null {
  if (!config.uiBaseUrl) return null;
  return `${config.uiBaseUrl}/fundraising/search/gt/gift/phase/1,12/${criteria}/from/${from}/to/${to}`;
}

// --- Members ---

/** The record running latest, which is the level a member holds and when it ends. */
function currentRecord(member: LglMember): LglMembership | undefined {
  return [...(member.memberships ?? [])].sort((a, b) => (b.finish_date ?? "").localeCompare(a.finish_date ?? ""))[0];
}

/** The relationship types that make people one household. */
const HOUSEHOLD_RELATIONSHIPS = new Set(["household", "spouse/partner"]);

/**
 * Who shares a household with another active member. Relationships are followed
 * through people, so a parent linked to each of two children makes all three one
 * household. A link to someone who is not an active member does not count: this
 * is about how the membership is made up. Decided 2026-10-31; the dues tiers
 * ($20 or $40, $100 or $200) agreed for all but 16 of the 555 members with a dues
 * gift on record that day.
 *
 * Null if relationships did not come back, rather than calling everyone single.
 */
function readHouseholds(active: LglMember[]) {
  if (active.some((m) => !Array.isArray(m.relationships))) return null;

  const parent = new Map(active.map((m) => [m.id, m.id]));
  const root = (id: number): number => {
    let at = id;
    while (parent.get(at) !== at) at = parent.get(at)!;
    parent.set(id, at);
    return at;
  };
  for (const member of active) {
    for (const r of member.relationships!) {
      const other = r.related_constituent_id;
      if (other == null || !parent.has(other)) continue;
      if (HOUSEHOLD_RELATIONSHIPS.has(r.name?.trim().toLowerCase() ?? "")) parent.set(root(member.id), root(other));
    }
  }

  const sizes = new Map<number, number>();
  for (const member of active) sizes.set(root(member.id), (sizes.get(root(member.id)) ?? 0) + 1);
  return {
    inHousehold: (member: LglMember) => sizes.get(root(member.id))! > 1,
    households: [...sizes.values()].filter((size) => size > 1).length,
  };
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
  config: CommunityConfig,
): Pick<NonNullable<CommunitySnapshot["members"]>, "total" | "newThisYear" | "byLevel" | "households" | "url" | "newUrl"> {
  const households = readHouseholds(active);
  const levels = new Map<string, MemberLevel>();
  let newThisYear: number | null = 0;

  for (const member of active) {
    const starts = (member.memberships ?? []).map((r) => r.date_start).filter((d): d is string => Boolean(d)).sort();
    if (starts.length === 0) newThisYear = null;
    else if (newThisYear !== null && starts[0].startsWith(`${year}-`)) newThisYear += 1;

    const current = currentRecord(member);
    const level = current?.membership_level_name?.trim() || "No level";
    const levelId = current?.membership_level_id;
    const row =
      levels.get(level) ??
      ({
        level,
        count: 0,
        inHousehold: households ? 0 : null,
        individual: households ? 0 : null,
        url: levelId != null ? memberSearch(config, `member_type/${levelId}`) : null,
      } satisfies MemberLevel);
    row.count += 1;
    if (households) {
      if (households.inHousehold(member)) row.inHousehold! += 1;
      else row.individual! += 1;
    }
    levels.set(level, row);
  }

  return {
    total: active.length,
    newThisYear,
    byLevel: [...levels.values()].sort((a, b) => b.count - a.count),
    households: households?.households ?? null,
    url: memberSearch(config),
    newUrl: memberSearch(config, membershipDates("start", "first", `${year}-01-01`, `${year}-12-31`)),
  };
}

/**
 * When memberships run out over the next twelve months, and how each renews.
 *
 * A member's latest dues gift says how they renew, whoever's it was: one soft-
 * credited on a household's payment renews the way that payment does. Dues gifts
 * are found by category rather than campaign, because the Annual Fund Drive issues
 * memberships too. Someone with no dues gift on record is reported as such, never
 * counted as either: it is exactly the question nothing can answer for them.
 *
 * LGL's own search for auto-renew asks for anyone who has ever had a recurring
 * gift, where this asks about the latest one, so someone who left auto-renew and
 * paid by hand would count differently. No active member does on 2026-10-31: both
 * say 508, the same as HPIC's saved search "Members- Recurring Billing".
 */
function countRenewals(
  active: LglMember[],
  gifts: LglGift[],
  today: string,
  config: CommunityConfig,
): CommunitySnapshot["renewals"] {
  const recurring = config.recurringMembershipCategories;
  const dues = [...config.membershipCategories, ...recurring];
  if (config.membershipCategories.length === 0 || recurring.length === 0) return null;

  // Latest wins; on the same day an automatic payment says more than a manual one.
  const latest = new Map<number, LglGift>();
  for (const g of gifts) {
    if (g.constituent_id == null || !g.received_date || !dues.includes(g.gift_category_id ?? -1)) continue;
    const held = latest.get(g.constituent_id);
    const newer =
      !held ||
      g.received_date > held.received_date! ||
      (g.received_date === held.received_date && recurring.includes(g.gift_category_id ?? -1));
    if (newer) latest.set(g.constituent_id, g);
  }

  const year = Number(today.slice(0, 4));
  const thisMonth = monthIndex(today);
  const keys = Array.from({ length: 13 }, (_, i) => monthKey(year, thisMonth, i));
  const lastDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  const row = (month: string | null): RenewalRow => {
    const range = month ? membershipDates("end", "latest", `${month}-01`, lastDay(month)) : null;
    return {
      month,
      total: 0,
      autoRenew: 0,
      manual: 0,
      noDues: 0,
      url: range ? memberSearch(config, range) : null,
      autoRenewUrl: range
        ? memberSearch(config, `in-gct/${recurring.join(",")}/in-gifts_type/1,7,8,9,12/${range}`)
        : null,
    };
  };
  const rows = new Map(keys.map((k) => [k, row(k)]));
  const later = row(null);
  const tally = { autoRenew: 0, manual: 0, noDues: 0 };
  let undated = 0;

  for (const member of active) {
    const finish = currentRecord(member)?.finish_date;
    if (!finish) {
      undated += 1;
      continue;
    }
    const month = finish.slice(0, 7);
    // LGL's Active means an unexpired record, so none should end before this month.
    const target = rows.get(month < keys[0] ? keys[0] : month) ?? later;
    const gift = latest.get(member.id);
    const how = !gift ? "noDues" : recurring.includes(gift.gift_category_id ?? -1) ? "autoRenew" : "manual";
    target.total += 1;
    target[how] += 1;
    tally[how] += 1;
  }

  // The month in progress usually has nothing left to run out, so it only shows if it does.
  const listed = keys.map((k) => rows.get(k)!).filter((r, i) => i > 0 || r.total > 0);
  return { rows: later.total > 0 ? [...listed, later] : listed, ...tally, undated };
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

  const isPurchase = (g: LglGift) => config.nonDonationCategories.includes(g.gift_category_id ?? -1);
  // Gifts: what was given, as distinct from paying dues or buying something.
  const donations = giving.filter((g) => !isDuesGift(g) && !isPurchase(g));
  // What giving leaves out by category, so an LGL search lands on the same gifts.
  const notGifts = [...config.paymentCategories, ...config.nonDonationCategories];
  const notGiftsCriteria = notGifts.length > 0 ? `ni-category/${notGifts.join(",")}` : "";

  const duesThisYear = giving.filter((g) => isDuesGift(g) && inYear(year)(g));
  const members: CommunitySnapshot["members"] = {
    ...countMembers(activeMembers, year, config),
    dues: haveDues
      ? {
          payers: people(duesThisYear).size,
          amount: dollars(sum(duesThisYear)),
          url: giftSearch(config, `campaign/${config.membershipCampaigns.join(",")}`, `${year}-01-01`, today),
        }
      : null,
  };

  // Without the dues campaigns, dues and gifts cannot be told apart.
  const donationsThisYear = donations.filter(inYear(year));
  const donors: CommunitySnapshot["donors"] = haveDues
    ? {
        thisYear: people(donationsThisYear).size,
        gifts: donationsThisYear.length,
        giftsUrl: giftSearch(
          config,
          [`ni-campaign/${config.membershipCampaigns.join(",")}`, notGiftsCriteria].filter(Boolean).join("/"),
          `${year}-01-01`,
          today,
        ),
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
    giving: series(donations),
  };

  // Giving by campaign: this year so far, and all of last year.
  const campaigns = new Map<string, { id: number | null; thisYear: number; total: number; gifts: number }>();
  for (const g of donations) {
    const key = g.campaign_name?.trim() || "No campaign";
    const row = campaigns.get(key) ?? { id: g.campaign_id || null, thisYear: 0, total: 0, gifts: 0 };
    if (inYear(year)(g)) {
      row.thisYear += amountOf(g);
      row.gifts += 1;
    } else if (inYear(lastYear)(g)) {
      row.total += amountOf(g);
    } else {
      continue;
    }
    campaigns.set(key, row);
  }
  const byCampaign: CampaignGiving[] = [...campaigns.entries()]
    .map(([campaign, r]) => {
      const criteria = [`campaign/${r.id}`, notGiftsCriteria].filter(Boolean).join("/");
      return {
        campaign,
        thisYear: dollars(r.thisYear),
        lastYearTotal: dollars(r.total),
        gifts: r.gifts,
        thisYearUrl: r.id ? giftSearch(config, criteria, `${year}-01-01`, today) : null,
        lastYearUrl: r.id ? giftSearch(config, criteria, `${lastYear}-01-01`, `${lastYear}-12-31`) : null,
      };
    })
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
    renewals: countRenewals(activeMembers, gifts, today, config),
    donors,
    monthly,
    byCampaign,
    purchasesThisYear: dollars(sum(giving.filter((g) => isPurchase(g) && !isDuesGift(g) && inYear(year)(g)))),
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
    renewals: null,
    donors: null,
    monthly: null,
    byCampaign: [],
    purchasesThisYear: 0,
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
    [["q[]", "membership_status=1"], ["expand", "memberships,relationships"]],
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
