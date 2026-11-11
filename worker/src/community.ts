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
import type { CampaignGiving, CommunitySnapshot, Env, ExpectedInflow, GrantPayment, MemberLevel, Memberships, NoDuesMember, OperatingAward, RenewalRow } from "./types";

export const COMMUNITY_SOURCE = "LGL membership and gift records";

/** How far back "lately" looks, and how far ahead "coming up" looks, counting today. */
const RECENT_DAYS = 30;
const RENEWALS_AHEAD_DAYS = 90;

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
  /** Null when `LGL_DUES_RATES` is unset or any entry in it cannot be read. */
  duesRates: DuesRate[] | null;
  uiBaseUrl: string | null;
}

/** One kind of membership, its annual rate in cents, and every amount that means it. */
export interface DuesRate {
  level: string;
  type: "individual" | "household";
  rate: number;
  amounts: number[];
}

/**
 * `Classic individual=20,20.60;Classic household=40,41.20`. The first amount is
 * the annual rate and the rest are the same dues with the card fee covered. An
 * entry that cannot be read blanks the lot rather than being skipped: a kind
 * silently missing would turn its payments into "matches no rate".
 */
export function parseDuesRates(raw: string | undefined): DuesRate[] | null {
  const entries = (raw ?? "").split(";").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const rates: DuesRate[] = [];
  for (const entry of entries) {
    const match = /^(.+)\s+(individual|household)\s*=\s*(.+)$/i.exec(entry);
    if (!match) return null;
    const amounts = match[3].split(",").map((a) => Math.round(Number(a.trim()) * 100));
    if (amounts.length === 0 || amounts.some((a) => !Number.isFinite(a) || a <= 0)) return null;
    rates.push({ level: match[1].trim(), type: match[2].toLowerCase() as DuesRate["type"], rate: amounts[0], amounts });
  }
  return rates;
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
    duesRates: parseDuesRates(env.LGL_DUES_RATES),
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

/** A calendar date `days` later (or earlier). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The same day a year earlier, less `months` more. */
function yearBefore(date: string, months = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y - 1, m - 1 - months, d)).toISOString().slice(0, 10);
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
export function giftSearch(config: CommunityConfig, criteria: string, from: string, to: string): string | null {
  if (!config.uiBaseUrl) return null;
  return `${config.uiBaseUrl}/fundraising/search/gt/gift/phase/1,12/${criteria}/from/${from}/to/${to}`;
}

/** Exactly these gifts, for a list no search criteria can describe. */
export function giftIds(config: CommunityConfig, ids: number[]): string | null {
  return config.uiBaseUrl && ids.length > 0 ? `${config.uiBaseUrl}/fundraising/search/gt/gift/gids/${ids.join(",")}` : null;
}

// --- Members ---

/** The record running latest, which is the level a member holds and when it ends. */
function currentRecord(member: LglMember): LglMembership | undefined {
  return [...(member.memberships ?? [])].sort((a, b) => (b.finish_date ?? "").localeCompare(a.finish_date ?? ""))[0];
}

/** When a member's first record began. Undefined if none of their records is dated. */
function firstStart(member: LglMember): string | undefined {
  return (member.memberships ?? []).map((r) => r.date_start).filter((d): d is string => Boolean(d)).sort()[0];
}

/** The relationship types that make people one household. */
const HOUSEHOLD_RELATIONSHIPS = new Set(["household", "spouse/partner"]);

/**
 * Each active member's latest dues gift, their own or a soft credit on someone
 * else's. Dues gifts are found by category rather than campaign, because the
 * Annual Fund Drive issues memberships too. Latest wins; on the same day an
 * automatic payment says more than a manual one.
 */
function latestDuesGifts(gifts: LglGift[], config: CommunityConfig): Map<number, LglGift> {
  const recurring = config.recurringMembershipCategories;
  const dues = [...config.membershipCategories, ...recurring];
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
  return latest;
}

/**
 * Dues-paying memberships, counted from what was paid (decided 2026-11-10).
 *
 * A membership is one dues payment: an active member's latest dues gift, and every
 * active member credited on it. A household member's latest dues gift is a soft
 * credit, which points at the payment through `parent_gift_id`. Individual or
 * household comes from the amount, since LGL's levels (Classic, Champion, Minor)
 * do not say. Relationship links decided this until then and got two things wrong:
 * a household-rate payer whose household was never linked counted as an
 * individual, and linked partners each paying the individual rate counted as one
 * household. On 2026-11-10 the change moved 17 of 307 memberships, to 294.
 *
 * Relationships are now only a cross-check. What the two cannot square is returned
 * as findings for the Reconciliation tab, by record number and never by name.
 * A member with no dues gift is in no membership, and is listed there too.
 *
 * Null without the dues categories and rates: nothing would say what a payment is.
 */
function countMemberships(active: LglMember[], gifts: LglGift[], config: CommunityConfig): Memberships | null {
  const rates = config.duesRates;
  if (!rates || config.membershipCategories.length === 0 || config.recurringMembershipCategories.length === 0) return null;

  const byId = new Map(gifts.map((g) => [g.id, g]));
  const latest = latestDuesGifts(gifts, config);
  const payments = new Map<number, { gift: LglGift; members: LglMember[] }>();
  const paymentOf = new Map<number, number>();
  for (const member of active) {
    const gift = latest.get(member.id);
    if (!gift) continue;
    // A soft credit whose payment was not read stands for itself, so the member still counts.
    const payment = (gift.gift_type_name === "Soft Credit" && gift.parent_gift_id != null && byId.get(gift.parent_gift_id)) || gift;
    const entry = payments.get(payment.id) ?? { gift: payment, members: [] };
    entry.members.push(member);
    payments.set(payment.id, entry);
    paymentOf.set(member.id, payment.id);
  }

  const rateOf = (gift: LglGift) => rates.find((r) => r.amounts.includes(amountOf(gift)));
  const giftRecord = (g: LglGift) => ({
    id: g.id,
    kind: "gift" as const,
    amount: dollars(amountOf(g)),
    url: config.uiBaseUrl ? `${config.uiBaseUrl}/gifts/${g.id}` : null,
  });

  const counts = new Map<DuesRate, number>(rates.map((r) => [r, 0]));
  const unmatched: LglGift[] = [];
  const householdOne: LglGift[] = [];
  const individualSeveral: LglGift[] = [];
  for (const { gift, members } of payments.values()) {
    const rate = rateOf(gift);
    if (!rate) {
      unmatched.push(gift);
      continue;
    }
    counts.set(rate, counts.get(rate)! + 1);
    if (rate.type === "household" && members.length === 1) householdOne.push(gift);
    if (rate.type === "individual" && members.length > 1) individualSeveral.push(gift);
  }

  // Linked as one household, yet on separate payments that are each an individual's.
  const separate: LglMember[] = [];
  const households = readHouseholds(active);
  if (households) {
    for (const group of households.groups) {
      const paying = group.filter((m) => paymentOf.has(m.id));
      const distinct = new Set(paying.map((m) => paymentOf.get(m.id)));
      if (distinct.size > 1 && paying.every((m) => rateOf(payments.get(paymentOf.get(m.id)!)!.gift)?.type === "individual")) {
        separate.push(...paying);
      }
    }
  }

  const types = rates.map((r) => ({
    level: r.level,
    type: r.type,
    rate: dollars(r.rate),
    count: counts.get(r)!,
    expected: dollars(counts.get(r)! * r.rate),
  }));
  const byId2 = (a: { id: number }, b: { id: number }) => a.id - b.id;

  return {
    total: payments.size,
    types,
    unmatched: unmatched.length,
    expectedDues: dollars(rates.reduce((sum, r) => sum + counts.get(r)! * r.rate, 0)),
    findings: [
      {
        key: "household_one_member",
        label: "Household-rate payment with one member credited",
        detail:
          "The payment is at a household rate, but only one active member is credited on it. Usually the rest of the household was never soft-credited, so they are missing from the member count or listed with no dues on record.",
        records: householdOne.map(giftRecord).sort(byId2),
      },
      {
        key: "individual_several_members",
        label: "Individual-rate payment with several members credited",
        detail: "The payment is at an individual rate, but more than one active member is credited on it.",
        records: individualSeveral.map(giftRecord).sort(byId2),
      },
      {
        key: "separate_individual",
        label: "Linked as a household, paying separately as individuals",
        detail:
          "LGL links these members as one household, but each is on their own individual-rate payment. They count as separate individual memberships.",
        records: separate
          .map((m) => ({
            id: m.id,
            kind: "member" as const,
            amount: null,
            url: config.uiBaseUrl ? `${config.uiBaseUrl}/constituents/${m.id}` : null,
          }))
          .sort(byId2),
      },
      {
        key: "unmatched_amount",
        label: "Dues payment that matches no rate",
        detail:
          "The amount is not one of the dues rates, with or without the card fee, so nothing says whether it is an individual or a household. It counts as a membership but is in no type and not in expected dues.",
        records: unmatched.map(giftRecord).sort(byId2),
      },
    ],
  };
}

/**
 * Who shares a household with another active member, by LGL's relationship links.
 * Followed through people, so a parent linked to each of two children makes all
 * three one household. A link to someone who is not an active member does not
 * count. Since 2026-11-10 this is only a cross-check on memberships, which are
 * counted from dues payments.
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

  const groups = new Map<number, LglMember[]>();
  for (const member of active) groups.set(root(member.id), [...(groups.get(root(member.id)) ?? []), member]);
  return { groups: [...groups.values()].filter((group) => group.length > 1) };
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
): Pick<
  NonNullable<CommunitySnapshot["members"]>,
  "total" | "newThisYear" | "byLevel" | "url" | "newUrl"
> {
  const levels = new Map<string, MemberLevel>();
  let newThisYear: number | null = 0;

  for (const member of active) {
    const first = firstStart(member);
    if (!first) newThisYear = null;
    else if (newThisYear !== null && first.startsWith(`${year}-`)) newThisYear += 1;

    const current = currentRecord(member);
    const level = current?.membership_level_name?.trim() || "No level";
    const levelId = current?.membership_level_id;
    const row =
      levels.get(level) ??
      ({
        level,
        count: 0,
        url: levelId != null ? memberSearch(config, `member_type/${levelId}`) : null,
      } satisfies MemberLevel);
    row.count += 1;
    levels.set(level, row);
  }

  return {
    total: active.length,
    newThisYear,
    byLevel: [...levels.values()].sort((a, b) => b.count - a.count),
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
  if (config.membershipCategories.length === 0 || recurring.length === 0) return null;

  const latest = latestDuesGifts(gifts, config);

  const year = Number(today.slice(0, 4));
  const thisMonth = monthIndex(today);
  const keys = Array.from({ length: 13 }, (_, i) => monthKey(year, thisMonth, i));
  const lastDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  // LGL cannot list people with no recurring gift, so this asks who paid dues by
  // hand when the membership now ending began: a year back, with a month's slack
  // for records that start after their payment. On 2026-11-01 the ninety-day
  // version returned 7 for 7, and the same search for the recurring category 33
  // for 33.
  const manualSearch = (from: string, to: string) =>
    memberSearch(
      config,
      `gift_from/${yearBefore(from, 1)}/gift_to/${yearBefore(to)}/in-gct/${config.membershipCategories.join(",")}/in-gifts_type/1,7,8,9,12/${membershipDates("end", "latest", from, to)}`,
    );
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
      manualUrl: month ? manualSearch(`${month}-01`, lastDay(month)) : null,
    };
  };
  const rows = new Map(keys.map((k) => [k, row(k)]));
  const later = row(null);
  const tally = { autoRenew: 0, manual: 0, noDues: 0 };
  let undated = 0;
  // Listed by LGL record number, never by name: names stay behind LGL's login.
  const noDuesMembers: NoDuesMember[] = [];

  // The Overview's "coming up": a range from today, where the rows above are whole months.
  const soonEnd = addDays(today, RENEWALS_AHEAD_DAYS - 1);
  const soonRange = membershipDates("end", "latest", today, soonEnd);
  const soon = {
    from: today,
    through: soonEnd,
    total: 0,
    autoRenew: 0,
    manual: 0,
    noDues: 0,
    url: memberSearch(config, soonRange),
    autoRenewUrl: memberSearch(config, `in-gct/${recurring.join(",")}/in-gifts_type/1,7,8,9,12/${soonRange}`),
    manualUrl: manualSearch(today, soonEnd),
  };

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
    if (how === "noDues") {
      noDuesMembers.push({
        id: member.id,
        level: currentRecord(member)?.membership_level_name ?? null,
        finish,
        url: config.uiBaseUrl ? `${config.uiBaseUrl}/constituents/${member.id}` : null,
      });
    }
    if (finish <= soonEnd) {
      soon.total += 1;
      soon[how] += 1;
    }
  }

  // The month in progress usually has nothing left to run out, so it only shows if it does.
  const listed = keys.map((k) => rows.get(k)!).filter((r, i) => i > 0 || r.total > 0);
  noDuesMembers.sort((a, b) => a.finish.localeCompare(b.finish) || a.id - b.id);
  return { rows: later.total > 0 ? [...listed, later] : listed, ...tally, undated, soon, noDuesMembers };
}

/**
 * Every grant payment this year and last, sorted into rebuild or operating so it
 * can be set against QuickBooks. A payment takes its award's campaign, because
 * payments often carry none of their own. One linked to no award falls back on its
 * own campaign and says so. Null when the grant categories are not configured.
 */
function readGrantPayments(cash: LglGift[], gifts: LglGift[], year: number, config: CommunityConfig): GrantPayment[] | null {
  if (config.awardCategories.length === 0 || config.paymentCategories.length === 0) return null;
  const byId = new Map(gifts.map((g) => [g.id, g]));
  const awardOf = (g: LglGift): LglGift | undefined => {
    let at = g.parent_gift_id != null ? byId.get(g.parent_gift_id) : undefined;
    for (let hop = 0; at && hop < 5; hop += 1) {
      if (at.gift_type_name === "Pledge" && config.awardCategories.includes(at.gift_category_id ?? -1)) return at;
      at = at.parent_gift_id != null ? byId.get(at.parent_gift_id) : undefined;
    }
    return undefined;
  };
  const payments: GrantPayment[] = [];
  for (const g of cash) {
    const date = g.received_date!;
    if (!date.startsWith(`${year}-`) && !date.startsWith(`${year - 1}-`)) continue;
    const award = awardOf(g);
    if (!award && !config.paymentCategories.includes(g.gift_category_id ?? -1)) continue;
    const campaign = award ? award.campaign_id : g.campaign_id;
    payments.push({
      id: g.id,
      date,
      amount: dollars(amountOf(g)),
      scope: config.grantCampaigns.includes(campaign ?? -1) ? "rebuild" : "operating",
      linked: Boolean(award),
    });
  }
  return payments;
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
    memberships: countMemberships(activeMembers, gifts, config),
    dues: haveDues
      ? {
          payers: people(duesThisYear).size,
          payments: duesThisYear.length,
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

  const grantPayments = readGrantPayments(cash, gifts, year, config);

  // What has happened lately, for the Overview. New members are people, so one
  // with no dated record blanks the count, as it does for the year.
  const recentFrom = addDays(today, 1 - RECENT_DAYS);
  const inRecent = (g: LglGift) => g.received_date! >= recentFrom;
  const recentDues = haveDues ? giving.filter((g) => isDuesGift(g) && inRecent(g)) : null;
  const recentGifts = haveDues ? donations.filter(inRecent) : null;
  // Program and operating awards only: rebuild payments are reported on the Rebuild tab.
  const recentPayments = grantPayments?.filter((p) => p.date >= recentFrom && p.scope === "operating") ?? null;
  const firsts = activeMembers.map(firstStart);
  const recent: CommunitySnapshot["recent"] = {
    from: recentFrom,
    through: today,
    newMembers: firsts.every(Boolean)
      ? {
          count: firsts.filter((d) => d! >= recentFrom && d! <= today).length,
          url: memberSearch(config, membershipDates("start", "first", recentFrom, today)),
        }
      : null,
    dues: recentDues && {
      count: recentDues.length,
      amount: dollars(sum(recentDues)),
      url: giftSearch(config, `campaign/${config.membershipCampaigns.join(",")}`, recentFrom, today),
    },
    gifts: recentGifts && {
      count: recentGifts.length,
      amount: dollars(sum(recentGifts)),
      url: giftSearch(
        config,
        [`ni-campaign/${config.membershipCampaigns.join(",")}`, notGiftsCriteria].filter(Boolean).join("/"),
        recentFrom,
        today,
      ),
    },
    programGrantPayments: recentPayments && {
      count: recentPayments.length,
      amount: recentPayments.reduce((s, p) => s + p.amount, 0),
      url: giftIds(config, recentPayments.map((p) => p.id)),
    },
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
      const criteria = [r.id ? `campaign/${r.id}` : "bl-campaign/1", notGiftsCriteria].filter(Boolean).join("/");
      return {
        campaign,
        thisYear: dollars(r.thisYear),
        lastYearTotal: dollars(r.total),
        gifts: r.gifts,
        thisYearUrl: giftSearch(config, criteria, `${year}-01-01`, today),
        lastYearUrl: giftSearch(config, criteria, `${lastYear}-01-01`, `${lastYear}-12-31`),
      };
    })
    .sort((a, b) => b.thisYear - a.thisYear || b.lastYearTotal - a.lastYearTotal);

  // The next three months, as the same months went a year earlier.
  const nextMonths = [1, 2, 3].map((n) => monthKey(year, thisMonth, n));
  const yearEarlier = new Set(nextMonths.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`));
  const inWindow = giving.filter((g) => yearEarlier.has(g.received_date!.slice(0, 7)));
  const isFund = inCampaigns(config.annualFundCampaigns);
  const items: ExpectedInflow[] = [];
  // Those gifts in LGL. The months run on from one another, so one range covers them.
  const earlier = [...yearEarlier].sort();
  const windowStart = `${earlier[0]}-01`;
  const windowEnd = new Date(Date.UTC(Number(earlier[2].slice(0, 4)), Number(earlier[2].slice(5, 7)), 0)).toISOString().slice(0, 10);
  const notPayments = config.paymentCategories.length > 0 ? `ni-category/${config.paymentCategories.join(",")}` : "";
  const windowUrl = (criteria: string) =>
    giftSearch(config, [criteria, notPayments].filter(Boolean).join("/"), windowStart, windowEnd);
  if (config.annualFundCampaigns.length > 0) {
    items.push({
      key: "annual_fund",
      label: "Annual Fund Drive",
      amount: dollars(sum(inWindow.filter(isFund))),
      url: windowUrl(`campaign/${config.annualFundCampaigns.join(",")}`),
    });
  }
  if (haveDues) {
    items.push({
      key: "memberships",
      label: "Membership dues",
      amount: dollars(sum(inWindow.filter(isDuesGift))),
      url: windowUrl(`campaign/${config.membershipCampaigns.join(",")}`),
    });
  }
  const others = [...config.membershipCampaigns, ...config.annualFundCampaigns];
  items.push({
    key: "other_giving",
    label: "Other giving",
    amount: dollars(sum(inWindow.filter((g) => !isDuesGift(g) && !isFund(g)))),
    url: windowUrl(others.length > 0 ? `ni-campaign/${others.join(",")}` : ""),
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
    const awardIds = new Set(rows.map((r) => r.id));
    operatingGrants = {
      awarded: rows.reduce((s, r) => s + r.amount, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      remaining: open.reduce((s, r) => s + r.remaining, 0),
      awards: open,
      awardedUrl: giftIds(config, rows.map((r) => r.id)),
      receivedUrl: giftIds(config, cash.filter((g) => awardIds.has(g.parent_gift_id ?? -1)).map((g) => g.id)),
      remainingUrl: giftIds(config, open.map((r) => r.id)),
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
    recent,
    grantPayments,
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
    recent: null,
    grantPayments: null,
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
