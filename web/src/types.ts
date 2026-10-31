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
  excluded: { income: number; spending: number; accounts: string[] } | null;
  budget: { status: "ok" | "none" | "ambiguous" | "not_monthly" | "unavailable"; name: string | null; note?: string };
  lastYear: { status: "ok" | "unavailable"; note?: string };
  monthly: { months: string[]; income: MonthlySide; spending: MonthlySide } | null;
  trailingTwelveMonthSpending: number | null;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "needs_reauth" | "not_connected" | "fixture";
  environment: "sandbox" | "production";
}

// --- Membership tab: members, donors and giving, from LGL ---

export interface CampaignGiving {
  campaign: string;
  thisYear: number;
  lastYearSamePeriod: number;
  lastYearTotal: number;
  gifts: number;
}

/** What the same three months brought in a year earlier: a projection. */
export interface ExpectedInflow {
  key: "annual_fund" | "memberships" | "other_giving";
  label: string;
  amount: number;
}

export interface OperatingAward {
  id: number;
  date: string | null;
  amount: number;
  received: number;
  remaining: number;
  url: string | null;
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
    byLevel: { level: string; count: number }[];
    /** Who paid dues this year: fewer than `total`, since a household shares one. */
    dues: { payers: number; amount: number } | null;
  } | null;
  /** Distinct givers, leaving out dues, grant payments and purchases. */
  donors: { thisYear: number } | null;
  monthly: {
    months: string[];
    dues: { thisYear: (number | null)[]; lastYear: number[] };
    giving: { thisYear: (number | null)[]; lastYear: number[] };
  } | null;
  byCampaign: CampaignGiving[];
  nextQuarter: { months: string[]; items: ExpectedInflow[] } | null;
  /** Provisional: from LGL payment records linked to their award. */
  operatingGrants: { awarded: number; received: number; remaining: number; awards: OperatingAward[] } | null;
  giftCount: number;
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
}
