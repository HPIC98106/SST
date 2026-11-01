/**
 * Mirror of the Worker's response shape (worker/src/types.ts).
 *
 * Kept as a small hand-written copy rather than a shared package: two files to
 * update is a smaller maintenance cost for a volunteer than a build step and a
 * workspace, and this surface changes rarely.
 */

export type AccountStatus = "ok" | "unavailable" | "not_configured";

export type AccountPurpose = "rebuild" | "programming";

export interface AccountSnapshot {
  /** QuickBooks account ID, or the raw config entry if it could not be parsed. */
  key: string;
  /** Null only for a config entry that could not be parsed. */
  purpose: AccountPurpose | null;
  label: string;
  status: AccountStatus;
  balance: number | null;
  hasSubAccounts: boolean;
  note?: string;
  /** This account's register in QuickBooks. */
  url?: string | null;
}

export interface PurposeSubtotal {
  purpose: AccountPurpose;
  label: string;
  total: number | null;
  note?: string;
}

export interface FundsSnapshot {
  accounts: AccountSnapshot[];
  /** Optional only because a snapshot cached before this field existed may still be served. */
  subtotals?: PurposeSubtotal[];
  totalCash: number | null;
  totalCashNote?: string;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "needs_reauth" | "not_connected" | "fixture";
  environment: "sandbox" | "production";
}

// --- Phase 2: the Little Green Light grant funnel ---

/**
 * "provisional" is a figure computed from Little Green Light that the books
 * have not confirmed. It is deliberately not a weaker "ok": QuickBooks is the
 * system of record for cash, so the status carries the caveat rather than
 * leaving it to a footnote the reader may skip.
 */
export type FunnelStatus = "ok" | "provisional" | "unavailable";

/**
 * Where a figure comes from. Built by the Worker beside the code that computes
 * the figure, never written here — a label claiming the wrong system would be
 * worse than a wrong number, because nothing on the page would look off.
 */
export interface FigureProvenance {
  system: string;
  records: string;
  authority?: string;
  gap?: string;
}

export interface FunnelStage {
  key: "pledged" | "received" | "outstanding";
  label: string;
  status: FunnelStatus;
  amount: number | null;
  recordCount: number | null;
  note?: string;
  provenance: FigureProvenance;
  /**
   * The same records as a search in LGL. Optional because the page and the
   * Worker deploy separately, and a page newer than its Worker must still
   * render.
   */
  search?: LglSearchLink | null;
  /** The records behind the amount itself, in LGL. */
  figureUrl?: string | null;
}

/** `note` says how the search differs from the figure; null when it does not. */
export interface LglSearchLink {
  url: string;
  note: string | null;
}

export interface AwardLink {
  id: number;
  amount: number;
  url: string | null;
}

export type ReimbursableStatus = "reimbursable" | "not_reimbursable" | "unknown";

export interface ReimbursableBucket {
  status: ReimbursableStatus;
  label: string;
  amount: number;
  recordCount: number;
  /** Provisional, from LGL payment records. Null when payments were unreadable. */
  received?: number | null;
  /** `amount - received`: still to arrive. Null whenever `received` is. */
  remaining?: number | null;
  /** Optional for the same reason as `FunnelStage.search`. */
  awards?: AwardLink[];
  url?: string | null;
  /** Those with money still to arrive, in LGL. */
  remainingUrl?: string | null;
}

export interface DataQualityRecord {
  id: number;
  amount: number | null;
  date: string | null;
  who: string | null;
  note: string | null;
  url: string | null;
}

export interface DataQualityException {
  key: string;
  label: string;
  detail: string;
  severity: "blocking" | "advisory";
  recordCount: number;
  amount: number | null;
  records: DataQualityRecord[];
}

/** The construction phase the readiness panel measures against. */
export interface PhaseTarget {
  name: string | null;
  targetCost: number | null;
  source: string | null;
  /** YYYY-MM-DD. Optional so a page newer than its Worker still renders. */
  pricesValidUntil?: string | null;
}

export interface GrantSnapshot {
  phaseTarget: PhaseTarget;
  stages: FunnelStage[];
  exceptions: DataQualityException[];
  scope: {
    campaignIds: number[];
    awardCategoryIds: number[];
    paymentCategoryIds: number[];
  };
  awardsByReimbursable: ReimbursableBucket[];
  unscoped: boolean;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
  completenessNote: string;
}

// --- Operations: the year's income and spending against budget ---

export type PlSide = "income" | "spending";

/**
 * Every figure covers the same completed months. `projectedYearEnd` is a
 * projection (actual to date plus budget for the months left), never a record,
 * and is null whenever the budget was not entered by month.
 */
export interface OperationsLine {
  label: string;
  actual: number;
  budgetToDate: number | null;
  budgetFullYear: number | null;
  projectedYearEnd: number | null;
  lastYearToDate: number | null;
  /** The report behind `actual` in QuickBooks, and behind `lastYearToDate`. */
  url?: string | null;
  lastYearUrl?: string | null;
}

export interface OperationsGroup extends OperationsLine {
  side: PlSide;
  accounts: OperationsLine[];
}

export interface MonthlySide {
  actual: (number | null)[];
  budget: number[] | null;
  lastYear: number[] | null;
}

export interface OperationsSnapshot {
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  ungrouped: { id: string; name: string; side: PlSide }[];
  invalidConfig: string[];
  period: {
    fiscalYearStart: string;
    fiscalYearEnd: string;
    through: string;
    completedMonths: number;
    showingPriorYear: boolean;
  } | null;
  basis: "Accrual";
  groups: OperationsGroup[];
  totals: { income: OperationsLine; spending: OperationsLine; net: OperationsLine } | null;
  excluded: { income: number; spending: number; accounts: string[]; url?: string | null } | null;
  budget: {
    status: "ok" | "none" | "ambiguous" | "not_monthly" | "unavailable";
    name: string | null;
    note?: string;
    /** Operating accounts budgeted the same every month, of those budgeted at all. */
    evenLines?: { even: number; total: number };
    /** QuickBooks' Budget vs. Actuals for this budget. */
    url?: string | null;
  };
  lastYear: { status: "ok" | "unavailable"; note?: string };
  monthly: { months: string[]; income: MonthlySide; spending: MonthlySide; urls?: (string | null)[] } | null;
  trailingTwelveMonthSpending: number | null;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "needs_reauth" | "not_connected" | "fixture";
  environment: "sandbox" | "production";
}

// --- Grant details: each award on its own ---

export type GrantStatus = "awaiting" | "partial" | "full" | "over" | "unknown";

export interface GrantDetail {
  id: number;
  name: string;
  /** False when the funder and award year stand in for a Grant Name field in LGL. */
  named: boolean;
  funder: string | null;
  scope: "rebuild" | "operating";
  awardDate: string | null;
  awarded: number;
  /** Null until QuickBooks can say which grant an expense belongs to. Never $0 in the meantime. */
  spent: number | null;
  /** Provisional, from LGL payment records. Null when they could not be read completely. */
  received: number | null;
  stillToArrive: number | null;
  receivedUrl: string | null;
  overBy: number | null;
  status: GrantStatus;
  terms: ReimbursableStatus;
  termsUnreadable: string | null;
  payments: { id: number; date: string; amount: number; url: string | null }[];
  /** Undated installments in LGL. Never counted as received. */
  scheduled: number[];
  url: string | null;
}

export interface GrantTotals {
  count: number;
  awarded: number;
  received: number | null;
  stillToArrive: number | null;
  awardedUrl: string | null;
  receivedUrl: string | null;
}

export interface GrantDetailsSnapshot {
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  grants: GrantDetail[];
  totals: { rebuild: GrantTotals; operating: GrantTotals };
  unlinkedPayments: { count: number; amount: number; url: string | null } | null;
  retrievedAt: string | null;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
}

// --- Membership tab: members, donors and giving, from LGL ---

export interface CampaignGiving {
  campaign: string;
  thisYear: number;
  lastYearTotal: number;
  gifts: number;
  thisYearUrl: string | null;
  lastYearUrl: string | null;
}

export interface MemberLevel {
  level: string;
  count: number;
  /** Null when LGL's relationships did not come back with the members. */
  inHousehold: number | null;
  individual: number | null;
  url: string | null;
}

/** Members whose membership ends in one month, by how it renews. Counts people. */
export interface RenewalRow {
  /** "2026-11". Null for the row holding everything past the last month listed. */
  month: string | null;
  total: number;
  autoRenew: number;
  manual: number;
  noDues: number;
  url: string | null;
  autoRenewUrl: string | null;
}

/** What the same three months brought in a year earlier: a projection. */
export interface ExpectedInflow {
  key: "annual_fund" | "memberships" | "other_giving";
  label: string;
  amount: number;
  url: string | null;
}

export interface OperatingAward {
  id: number;
  date: string | null;
  amount: number;
  received: number;
  remaining: number;
  url: string | null;
}

/** Some gifts over a stretch of days, and those gifts in LGL. */
export interface RecentActivity {
  count: number;
  amount: number;
  url: string | null;
}

/** One grant payment in LGL. `linked` is false when it hangs off no award. */
export interface GrantPayment {
  id: number;
  date: string;
  amount: number;
  scope: "rebuild" | "operating";
  linked: boolean;
}

export interface CommunitySnapshot {
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  year: number | null;
  through: string | null;
  members: {
    /** LGL's own count of active members, never derived from dues gifts. */
    total: number;
    /** First membership began this year. Null if a member has no dated record. */
    newThisYear: number | null;
    byLevel: MemberLevel[];
    /** Households of two or more active members. Null like `MemberLevel.inHousehold`. */
    households: number | null;
    /** Who paid dues this year: fewer than `total`, since a household shares one. */
    dues: { payers: number; amount: number; url: string | null } | null;
    url: string | null;
    newUrl: string | null;
  } | null;
  /** Null when the dues categories are not configured. */
  renewals: {
    rows: RenewalRow[];
    autoRenew: number;
    manual: number;
    noDues: number;
    undated: number;
    /** Every active member counted in `noDues`, soonest ending first. */
    noDuesMembers: NoDuesMember[];
    /** Those ending within the next ninety days. Counts people. */
    soon: {
      from: string;
      through: string;
      total: number;
      autoRenew: number;
      manual: number;
      noDues: number;
      url: string | null;
      autoRenewUrl: string | null;
      /** Members who paid dues by hand when the membership now ending began. */
      manualUrl: string | null;
    };
  } | null;
  /** Distinct givers, leaving out dues, grant payments and purchases. */
  donors: { thisYear: number; gifts: number; giftsUrl: string | null } | null;
  monthly: {
    months: string[];
    dues: { thisYear: (number | null)[]; lastYear: number[] };
    giving: { thisYear: (number | null)[]; lastYear: number[] };
  } | null;
  byCampaign: CampaignGiving[];
  purchasesThisYear: number;
  nextQuarter: { months: string[]; items: ExpectedInflow[] } | null;
  /** Provisional: from LGL payment records linked to their award. */
  operatingGrants: {
    awarded: number;
    received: number;
    remaining: number;
    awards: OperatingAward[];
    awardedUrl: string | null;
    receivedUrl: string | null;
    remainingUrl: string | null;
  } | null;
  /**
   * The last thirty days, for the Overview. Counts and totals, never names. A part is
   * null when it cannot be told: an undated member, or campaigns not configured.
   */
  recent: {
    from: string;
    through: string;
    newMembers: { count: number; url: string | null } | null;
    dues: RecentActivity | null;
    gifts: RecentActivity | null;
    /** Provisional, like every LGL payment figure. */
    grantPayments: RecentActivity | null;
  } | null;
  /** Grant payments this year and last, to set against QuickBooks. Null if not configured. */
  grantPayments: GrantPayment[] | null;
  giftCount: number;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
}

/**
 * One kind of money as each system has it, over the same months. `difference` is
 * LGL less QuickBooks. A difference is reported, never explained away: it can be
 * timing, since QuickBooks books by accrual and LGL by date received.
 */
export interface ReconciliationRow {
  key: "dues" | "operating_grants" | "rebuild_grants";
  label: string;
  status: "match" | "differs" | "not_compared";
  lgl: number | null;
  qbo: number | null;
  difference: number | null;
  lglUrl: string | null;
  qboUrl: string | null;
  note?: string;
}

export interface ReconciliationSnapshot {
  /** "ok" only when both systems read completely. Otherwise nothing was compared. */
  status: "ok" | "unavailable";
  note?: string;
  /** Completed months only, the same as Operations. */
  period: { from: string; through: string } | null;
  rows: ReconciliationRow[];
  lglRetrievedAt: string | null;
  qboRetrievedAt: string | null;
}

/**
 * An active member with no dues gift on record, for the Reconciliation tab. Usually
 * a household member whose soft credit on the shared payment was never entered, or
 * a membership issued with a gift outside the dues categories. Identified by LGL
 * record number only: names stay behind LGL's own login.
 */
export interface NoDuesMember {
  id: number;
  level: string | null;
  /** When their current membership ends. */
  finish: string;
  /** Their record in LGL. Null when LGL_UI_BASE_URL is unset. */
  url: string | null;
}
