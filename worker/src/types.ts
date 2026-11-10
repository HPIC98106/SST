/**
 * Shared types for the HPIC single-source-of-truth Worker.
 *
 * Phase 1 covers QuickBooks Online cash balances. Phase 2 adds the Little
 * Green Light grant funnel. Phase readiness arrives in Phase 3.
 */

import type { TokenStore } from "./tokens";

export interface Env {
  // Secrets — set with `wrangler secret put`, never in wrangler.toml.
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  ACCESS_PASSPHRASE: string;

  // Plain vars — safe to keep in wrangler.toml.
  QBO_ENV: "sandbox" | "production";
  QBO_MODE: "fixture" | "live";
  /**
   * QuickBooks' web interface, for links into a register or report. Not a secret.
   * Unset, and in fixture or sandbox mode, the figures simply carry no links.
   */
  QBO_UI_BASE_URL?: string;
  QBO_REALM_ID: string;
  QBO_REDIRECT_URI: string;

  /**
   * Every QuickBooks account that counts as cash, each tagged with what the
   * money is for: `rebuild:106,rebuild:185,programming:101`. A secret, like the
   * realm ID, because the repository is public.
   *
   * A list rather than one slot per purpose because HPIC's rebuild money sits
   * in two accounts. An account left out of this list is left out of every
   * total, so the list is the whole of "cash on hand". Unset renders "not
   * configured" rather than failing.
   */
  QBO_ACCOUNTS?: string;

  /**
   * How profit-and-loss accounts roll up into the board's lines on the
   * Operations tab: `Memberships=45;Events and programs=50,60;exclude=80`.
   * A secret, like `QBO_ACCOUNTS`, because it names HPIC's accounts.
   *
   * Groups are separated by `;`, each a label, `=`, and comma-separated
   * account IDs. Listing a parent account takes its sub-accounts with it
   * unless one is listed elsewhere. One group can hold income and spending
   * accounts both, and shows on each side it has accounts on. The reserved
   * label `exclude` keeps accounts out of operating figures entirely (rebuild
   * money, chiefly) while still naming what was kept out. Unset renders "not
   * configured": without it nothing says which accounts are operating ones.
   */
  QBO_PL_GROUPS?: string;

  // --- Little Green Light (Phase 2) ---

  /**
   * Secret. A freshly issued key scoped to this tool — deliberately not the
   * one the membership lookup tool uses.
   */
  LGL_API_KEY?: string;

  /** "fixture" serves recorded data and never calls LGL. Defaults to fixture. */
  LGL_MODE?: "fixture" | "live";

  /**
   * Which LGL records count as grant activity, as comma-separated IDs.
   *
   * LGL holds every pledge, most of which are individual donor activity
   * rather than grants. Without a scope, a "grant funnel" would
   * quietly be an "everything funnel". Unset is a valid state — the figures
   * still render, but each one carries a visible caveat saying it is not
   * scoped to grants.
   */
  LGL_GRANT_CAMPAIGN_IDS?: string;
  LGL_GRANT_GIFT_CATEGORY_IDS?: string;

  /**
   * Which gift categories hold grant *payments*, as opposed to awards.
   *
   * These are different categories that both display as "Grant" in LGL — 6031
   * holds the type-7 award pledges, 6076 holds the type-1 gifts carrying
   * actual cash. `/gift_categories` tells them apart by `gift_type_id` (7 vs
   * 1); the display name is on `display_name`, not `name`, which is what made
   * an earlier reading of that endpoint look empty. Unset means Received
   * cannot be computed at all, which renders as unavailable rather than zero.
   */
  LGL_GRANT_PAYMENT_CATEGORY_IDS?: string;

  /**
   * Base URL of HPIC's Little Green Light tenant, used to deep-link the
   * records named in the data-quality panel. Not a secret and not required:
   * unset simply means the panel lists record IDs without links.
   */
  LGL_UI_BASE_URL?: string;

  /**
   * Which LGL campaigns hold membership dues, and which the Annual Fund Drive,
   * for the Membership tab. Not secrets: campaign IDs name nothing outside LGL.
   * Unset leaves that line out rather than guessing at it by name.
   */
  LGL_MEMBERSHIP_CAMPAIGN_IDS?: string;
  LGL_ANNUAL_FUND_CAMPAIGN_IDS?: string;
  /** Gift categories that are purchases, not gifts, so buyers are not donors. */
  LGL_NON_DONATION_CATEGORY_IDS?: string;
  /**
   * Gift categories that hold dues: paid by hand, and paid by automatic renewal.
   * Unset leaves the renewals table off the tab rather than calling everyone manual.
   */
  LGL_MEMBERSHIP_CATEGORY_IDS?: string;
  LGL_RECURRING_MEMBERSHIP_CATEGORY_IDS?: string;

  /**
   * The construction phase the readiness panel is measured against, and what
   * it is estimated to cost.
   *
   * Both are typed in by a human, because no system HPIC runs holds them: the
   * figure comes from the general contractor in an email or a bid document.
   * That is exactly why `PhaseTarget` carries a `source` string and the panel
   * prints it. A number whose provenance is "somebody typed it" is fine as
   * long as the page says so, and dangerous as soon as it looks like a read.
   *
   * Unset is the normal state today. The panel then shows what it can and
   * reports the target as awaited rather than guessing at one.
   */
  CURRENT_PHASE_NAME?: string;
  CURRENT_PHASE_TARGET_COST?: string;
  /** Where the target cost came from, e.g. "Metis bid, 2026-09-15". */
  CURRENT_PHASE_TARGET_SOURCE?: string;
  /**
   * The last day the estimate's prices hold, as YYYY-MM-DD. Metis prices for
   * 30 days from the estimate date. The panel prints it and says so plainly
   * once it has passed: a lapsed estimate is still the best figure available,
   * but re-pricing can move it, and a reader should not have to know that.
   */
  CURRENT_PHASE_PRICES_VALID_UNTIL?: string;

  // Origin of the GitHub Pages frontend, for CORS.
  ALLOWED_ORIGIN?: string;

  TOKEN_STORE: DurableObjectNamespace<TokenStore>;
}

/** Why an account has no number, when it has no number. */
export type AccountStatus = "ok" | "unavailable" | "not_configured";

/**
 * What an account's money is for. Rebuild cash is what the readiness panel
 * measures against a phase; programming cash is unrestricted and pays for
 * everything else, so it is never counted toward construction.
 */
export type AccountPurpose = "rebuild" | "programming";

export interface AccountSnapshot {
  /** The QuickBooks account ID, or the raw config entry if it could not be parsed. */
  key: string;
  /** Null only for a config entry that could not be parsed. */
  purpose: AccountPurpose | null;
  /** The account's name in QuickBooks, so the card matches what the books call it. */
  label: string;
  status: AccountStatus;
  /** QuickBooks book balance. Null unless status is "ok". */
  balance: number | null;
  /** True when the account rolls up sub-accounts, so the mapping gets reviewed. */
  hasSubAccounts: boolean;
  /** This account's register in QuickBooks. Null or absent when no link applies. */
  url?: string | null;
  /** Human-readable explanation, shown inline on the panel. */
  note?: string;
}

/** Cash for one purpose, under the same completeness rule as the total. */
export interface PurposeSubtotal {
  purpose: AccountPurpose;
  label: string;
  /** Null unless every account with this purpose is "ok". */
  total: number | null;
  note?: string;
}

export interface FundsSnapshot {
  accounts: AccountSnapshot[];
  subtotals: PurposeSubtotal[];
  /**
   * Null whenever any account is not "ok". A total that silently omits a
   * failed account overstates cash on hand, which is the exact failure this
   * dashboard exists to prevent.
   */
  totalCash: number | null;
  totalCashNote?: string;
  /** QuickBooks' own response timestamp. Never the browser or Worker clock. */
  retrievedAt: string | null;
  /** Whether this response came from the Worker's cache, and how old it is. */
  cached: boolean;
  source: string;
  connection: "ok" | "needs_reauth" | "not_connected" | "fixture";
  /**
   * Which QuickBooks company these figures came from.
   *
   * A sandbox company returns real balances from a fake business, and without
   * this the panel renders them exactly like production figures. Every other
   * caveat on this dashboard is visible on the page; this one was not.
   */
  environment: "sandbox" | "production";
}

// --- Phase 2: the Little Green Light grant funnel ---

/**
 * Why a funnel figure reads the way it does.
 *
 * "provisional" is not a weaker "ok". It marks a figure computed from Little
 * Green Light that has *not* been reconciled against QuickBooks, which is the
 * system of record for cash. It exists so the dashboard can show a useful
 * number during the prototype without ever implying the books agree with it —
 * the caveat travels with the figure instead of living in a footnote.
 */
export type FunnelStatus = "ok" | "provisional" | "unavailable";

/**
 * Where a figure comes from, and what stands between it and being trusted.
 *
 * Emitted by the code that computes the figure rather than written alongside
 * it in the UI. A label describing provenance is exactly the kind of thing
 * that goes quietly stale — and a confident, wrong claim about which system a
 * number came from would be worse than a wrong number, because nobody would
 * think to check it.
 */
export interface FigureProvenance {
  /** The system this number is actually computed from, today. */
  system: string;
  /** What is being counted, in the reader's terms rather than the API's. */
  records: string;
  /**
   * The system that *should* answer this, when it differs from `system`.
   * Present on any provisional figure; absent when `system` is authoritative.
   */
  authority?: string;
  /** What has to change before `system` and `authority` agree. */
  gap?: string;
}

/**
 * The funnel starts at Pledged, not at an application. This tool covers money
 * awarded or promised, not money requested (confirmed with Alex, 2026-08-14).
 */
export interface FunnelStage {
  key: "pledged" | "received" | "outstanding";
  label: string;
  status: FunnelStatus;
  /** Null when status is "unavailable". */
  amount: number | null;
  /**
   * How many LGL records the figure draws on. Rendered beside every total:
   * LGL is a partial picture during the prototype, so a grant that was never
   * entered shows up as a count discrepancy long before anyone would notice a
   * total being quietly low.
   */
  recordCount: number | null;
  /** Human-readable explanation, shown inline on the panel. */
  note?: string;
  /** Where this figure came from. Always present, including when unavailable. */
  provenance: FigureProvenance;
  /**
   * The same records, opened as a search in LGL's own interface, so a reader
   * can click through and check the figure against the system it came from.
   * Null when no search can reproduce them: no UI base URL, no scope, or a
   * scope LGL's search URL is not known to express.
   */
  search: LglSearchLink | null;
  /** The records behind the amount itself, in LGL. */
  figureUrl?: string | null;
}

/**
 * A search in LGL's web interface.
 *
 * `note` says how the search differs from the figure it sits under, and is
 * null only when the two are the same set of records. A link that silently
 * opens a different count from the one beside it would invite exactly the
 * "which number is right" question it exists to answer.
 */
export interface LglSearchLink {
  url: string;
  note: string | null;
}

/** One award, linked to its record in LGL. */
export interface AwardLink {
  id: number;
  amount: number;
  /** Null when LGL_UI_BASE_URL is unset. */
  url: string | null;
}

/**
 * Whether an award is cost-reimbursement.
 *
 * Derived from LGL's "Payment Terms" field, which carries more detail than
 * this: "Payment in full" and "Distribution payments" both land on
 * `not_reimbursable`, because the only distinction that changes a number here
 * is whether HPIC has to spend before the money arrives. LGL stays the record
 * of what the funder actually agreed to.
 *
 * "unknown" is a first-class value, not a placeholder — a reimbursable award
 * defaulted to spendable is the specific error this dashboard exists to
 * prevent. It covers two situations that the data-quality panel reports
 * separately: no value set, and a value set that this code cannot read. See
 * `PaymentTermsReading` in `lgl.ts`.
 */
export type ReimbursableStatus = "reimbursable" | "not_reimbursable" | "unknown";

export interface ReimbursableBucket {
  status: ReimbursableStatus;
  label: string;
  amount: number;
  recordCount: number;
  /**
   * Payments received against the awards in this bucket, from the same walk
   * that produces the Received stage, so it carries the same provisional
   * caveat. Null when payments could not be read completely: a partial sum
   * would understate cash received and so overstate `remaining`.
   */
  received: number | null;
  /**
   * `amount - received`: what is still to arrive from these awards. Money
   * already received has been spent or is sitting in cash, so counting it again
   * here would double-count it. Null whenever `received` is. Provisional, and
   * an overstatement if a payment is not linked to its award.
   */
  remaining: number | null;
  /**
   * The awards in this bucket, each linked to LGL.
   */
  awards: AwardLink[];
  /** All these awards in LGL. Null when LGL_UI_BASE_URL is unset or there are none. */
  url: string | null;
  /** Those with money still to arrive. Null like `remaining`, and when there are none. */
  remainingUrl: string | null;
}

/**
 * One record that fails a data-quality rule, named so it can be fixed.
 *
 * The panel exists to be acted on, so a record has to be identifiable by a
 * human: the note usually says what the money was for, and the URL opens the
 * record in Little Green Light.
 */
export interface DataQualityRecord {
  id: number;
  amount: number | null;
  date: string | null;
  /** Funder name. Best-effort — null when it could not be resolved. */
  who: string | null;
  note: string | null;
  /** Null when LGL_UI_BASE_URL is unset. */
  url: string | null;
}

/**
 * A data-quality rule that some records violate.
 *
 * These are first-class output, not error handling. The prototype's whole
 * strategy is that the dashboard makes the cost of a broken record visible in
 * dollars, so that the rules can be introduced with evidence rather than
 * asserted. An exception with no records is omitted entirely.
 */
export interface DataQualityException {
  key: string;
  label: string;
  /** Why it matters, in terms a board member can act on. */
  detail: string;
  /**
   * "blocking" means a figure on this page is wrong or missing because of it.
   * "advisory" means the dashboard copes, but something else — usually LGL's
   * own reporting — does not.
   */
  severity: "blocking" | "advisory";
  recordCount: number;
  /** Total money involved, or null where money is not the unit. */
  amount: number | null;
  /** Capped for display; recordCount is the true total. */
  records: DataQualityRecord[];
}

/**
 * The construction phase the readiness panel measures against.
 *
 * `targetCost` is null whenever it has not been supplied, which is the state
 * today: the figure comes from the general contractor and has not arrived. The
 * panel renders the phase anyway, because "we do not know what it costs yet"
 * is a real and reportable answer, and a more useful one than an empty panel.
 */
export interface PhaseTarget {
  /** Null when CURRENT_PHASE_NAME is unset. */
  name: string | null;
  /** Null when unset or unparseable. Never defaulted to zero. */
  targetCost: number | null;
  /**
   * Where the figure came from, printed beside it. Null when no target is set.
   * This is the only number on the dashboard not read from a system, so it is
   * the one that most needs to say where it came from.
   */
  source: string | null;
  /**
   * The last day the estimate's prices hold (YYYY-MM-DD). Null when unset,
   * unparseable, or when there is no target to qualify.
   */
  pricesValidUntil: string | null;
}

export interface GrantSnapshot {
  stages: FunnelStage[];
  /**
   * The phase readiness panel's target. Always present; its fields are null
   * until someone configures them.
   */
  phaseTarget: PhaseTarget;
  /**
   * The scope actually in force, echoed so the lifecycle view can quote real
   * configuration rather than repeating IDs that would drift from it.
   */
  scope: {
    campaignIds: number[];
    awardCategoryIds: number[];
    paymentCategoryIds: number[];
  };
  /**
   * Records failing a data-quality rule. Empty is the goal state, not the
   * normal one.
   */
  exceptions: DataQualityException[];
  /**
   * Awarded amounts split by reimbursable status, never added together. A
   * cost-reimbursement award is not cash available to start work, so a single
   * combined "available" figure would overstate readiness to the board.
   */
  awardsByReimbursable: ReimbursableBucket[];
  /**
   * True when no grant scope is configured, so the figures cover every pledge
   * in LGL rather than grants specifically.
   */
  unscoped: boolean;
  /** LGL's own response clock, never the browser or Worker clock. */
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
  /** Data-completeness caveat. Removed at go-live, once reconciliation is done. */
  completenessNote: string;
}

// --- Operations: the year's income and spending against budget ---

/** Which side of the books a line sits on. */
export type PlSide = "income" | "spending";

/**
 * One line of the year-so-far table, in dollars.
 *
 * Every figure covers the same months: the completed months of the fiscal
 * year, so an October 30 read reports through September 30. A month still in
 * progress is never compared with a full month's budget.
 */
export interface OperationsLine {
  label: string;
  /** Actual, from QuickBooks' profit and loss report, accrual basis. */
  actual: number;
  /**
   * The budget for the same completed months. Null unless the budget was
   * entered by month: dividing a yearly figure evenly would make every
   * seasonal month look wrong, which is the comparison this exists to avoid.
   */
  budgetToDate: number | null;
  /** Null when no budget covers this fiscal year. */
  budgetFullYear: number | null;
  /**
   * A projection, not a record: actual to date plus the budget for every
   * month not yet complete. Null whenever `budgetToDate` is. Never added to
   * cash or to any funded figure.
   */
  projectedYearEnd: number | null;
  /** The same months of the previous fiscal year. Null when that read failed. */
  lastYearToDate: number | null;
  /** The report behind `actual` in QuickBooks. Null or absent when no link applies. */
  url?: string | null;
  /** The same report for the months behind `lastYearToDate`. */
  lastYearUrl?: string | null;
}

/** A board-level line, with the QuickBooks accounts underneath it. */
export interface OperationsGroup extends OperationsLine {
  side: PlSide;
  accounts: OperationsLine[];
}

/** Monthly figures for the cumulative chart, one entry per fiscal month. */
export interface OperationsMonthly {
  /** Twelve "YYYY-MM" keys, in fiscal order. */
  months: string[];
  income: MonthlySide;
  spending: MonthlySide;
  /** Each completed month's profit and loss in QuickBooks. Absent when no link applies. */
  urls?: (string | null)[];
}

export interface MonthlySide {
  /** Null for months not yet complete. */
  actual: (number | null)[];
  /** Null when no monthly budget covers the year. */
  budget: number[] | null;
  /** Null when last year's read failed. */
  lastYear: number[] | null;
}

/** Why a budget column reads the way it does. */
export interface BudgetState {
  status: "ok" | "none" | "ambiguous" | "not_monthly" | "unavailable";
  /** The QuickBooks budget's name, when one was used. */
  name: string | null;
  note?: string;
  /**
   * Operating accounts budgeted with the same amount every month, of those
   * budgeted at all. An even split is how a seasonal line comes to look far over
   * or under budget partway through a year, so the page says how much of it there is.
   */
  evenLines?: { even: number; total: number };
  /** QuickBooks' Budget vs. Actuals for this budget, month by month for the whole year. */
  url?: string | null;
}

/** An account with activity that no group claims. */
export interface UngroupedAccount {
  id: string;
  name: string;
  side: PlSide;
}

export interface OperationsSnapshot {
  /**
   * "ok" means every figure below came from a complete read in which every
   * account with activity is either grouped or deliberately kept out. Any
   * other status carries no figures, and `note` says why.
   */
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  /**
   * Accounts with activity this year, last year, or in the budget that no
   * group claims. Operating figures are withheld while any exist: an
   * ungrouped account might be rebuild money, and counting it as day-to-day
   * income would overstate how the year is going.
   */
  ungrouped: UngroupedAccount[];
  /** `QBO_PL_GROUPS` entries that could not be used, and why. */
  invalidConfig: string[];
  /** The months every figure covers. Null when nothing was read. */
  period: {
    fiscalYearStart: string;
    fiscalYearEnd: string;
    /** Last day of the last completed month. */
    through: string;
    completedMonths: number;
    /**
     * True in a fiscal year's first month, when no month of it has completed:
     * the previous year is shown, in full, instead of an empty table.
     */
    showingPriorYear: boolean;
  } | null;
  /** The accounting basis every figure is reported on. */
  basis: "Accrual";
  groups: OperationsGroup[];
  totals: { income: OperationsLine; spending: OperationsLine; net: OperationsLine } | null;
  /**
   * What `exclude` kept out of every figure above, over the same months, so
   * leaving rebuild money out is visible rather than silent.
   */
  excluded: { income: number; spending: number; accounts: string[]; url?: string | null } | null;
  budget: BudgetState;
  lastYear: { status: "ok" | "unavailable"; note?: string };
  monthly: OperationsMonthly | null;
  /**
   * Operating spending over the last twelve completed months, the basis for
   * "months of operating cash". Null unless all twelve months were read.
   */
  trailingTwelveMonthSpending: number | null;
  /** QuickBooks' own report timestamp. Never the browser or Worker clock. */
  retrievedAt: string | null;
  cached: boolean;
  source: string;
  connection: "ok" | "needs_reauth" | "not_connected" | "fixture";
  environment: "sandbox" | "production";
}

/** Token payload as returned by Intuit's token endpoint. */
export interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type: string;
}

/** What the Durable Object hands back to the Worker. */
export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "needs_reauth" | "not_seeded"; detail?: string };

// --- Membership tab: members, donors and giving, from Little Green Light ---

/** One campaign's giving, this year to date against the same days last year. */
export interface CampaignGiving {
  campaign: string;
  thisYear: number;
  lastYearTotal: number;
  /** Gifts this year, so a total can be read against how many people gave. */
  gifts: number;
  /** The same gifts in LGL. Null with no campaign to search on, or no LGL_UI_BASE_URL. */
  thisYearUrl: string | null;
  lastYearUrl: string | null;
}

/** One membership level, split by whether the member shares a household. */
export interface MemberLevel {
  level: string;
  count: number;
  /** Null when LGL's relationships did not come back with the members. */
  inHousehold: number | null;
  individual: number | null;
  /** Null when LGL_UI_BASE_URL is unset. */
  url: string | null;
}

/**
 * Active members whose membership runs out in one month, by how it renews. Counts
 * people, so the rows add up to total members; a household renews on one payment.
 */
export interface RenewalRow {
  /** "2026-11". Null for the row holding everything past the last month listed. */
  month: string | null;
  total: number;
  /** Their latest dues gift is in a recurring category. */
  autoRenew: number;
  /** Their latest dues gift was paid by hand. */
  manual: number;
  /** No dues gift on record, so nothing says how they renew. Never counted as either. */
  noDues: number;
  /** Null when LGL_UI_BASE_URL is unset, and for the row past the last month. */
  url: string | null;
  autoRenewUrl: string | null;
  /** Members ending that month who paid dues by hand when it began. */
  manualUrl: string | null;
}

/**
 * What the next three months brought in a year earlier. A projection, not a
 * record or a pledge: it says what this season looked like last time.
 */
export interface ExpectedInflow {
  key: "annual_fund" | "memberships" | "other_giving";
  label: string;
  amount: number;
  /** Those gifts in LGL: the same months a year earlier. */
  url: string | null;
}

// --- Grant details: each award on its own ---

export type GrantScope = "rebuild" | "operating";

/** Only what the records say. Whether a grant is healthy needs Spent, which is not tracked yet. */
export type GrantStatus = "awaiting" | "partial" | "full" | "over" | "unknown";

export interface GrantDetail {
  id: number;
  /** The Grant Name field in LGL, or the funder and award year until it is filled in. */
  name: string;
  named: boolean;
  /** An organization's name. Individuals are never named, and null means it could not be read. */
  funder: string | null;
  scope: GrantScope;
  /** The award's date in LGL, which is not always the real award date. */
  awardDate: string | null;
  awarded: number;
  /** Null until QuickBooks can say which grant an expense belongs to. Never $0 in the meantime. */
  spent: number | null;
  /** Provisional, from LGL payment records. Null when they could not be read completely. */
  received: number | null;
  stillToArrive: number | null;
  /** The payments behind Received, in LGL. Null with none, or no LGL_UI_BASE_URL. */
  receivedUrl: string | null;
  /** How far payments linked to this award exceed it, when they do. */
  overBy: number | null;
  status: GrantStatus;
  terms: ReimbursableStatus;
  /** A Payment Terms value this code cannot map, quoted back. Null when simply unset. */
  termsUnreadable: string | null;
  payments: { id: number; date: string; amount: number; url: string | null }[];
  /** Undated installments in LGL. Never counted as received, and may include one already paid. */
  scheduled: number[];
  url: string | null;
}

/** Rebuild and programs are totalled apart and never added together. */
export interface GrantTotals {
  count: number;
  awarded: number;
  received: number | null;
  stillToArrive: number | null;
  /** These awards and their payments in LGL. Null when LGL_UI_BASE_URL is unset or there are none. */
  awardedUrl: string | null;
  receivedUrl: string | null;
}

export interface GrantDetailsSnapshot {
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  grants: GrantDetail[];
  totals: { rebuild: GrantTotals; operating: GrantTotals };
  /** Grant payments linked to no award, so on no grant. Null when they could not be read. */
  unlinkedPayments: { count: number; amount: number; url: string | null } | null;
  retrievedAt: string | null;
  source: string;
  connection: "ok" | "not_configured" | "unavailable" | "fixture";
}

/** A grant award outside the rebuild, and what is still to arrive on it. */
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
  /**
   * "ok" only for a complete read of every gift. A walk that stopped at its
   * page cap would undercount members and giving, so it shows nothing.
   */
  status: "ok" | "unavailable" | "not_configured";
  note?: string;
  year: number | null;
  /** The last day counted this year: LGL's own clock, as a Seattle date. */
  through: string | null;
  members: {
    /** LGL's own count of active members, never derived from dues gifts. */
    total: number;
    /** First membership began this year. Null if a member has no dated record. */
    newThisYear: number | null;
    byLevel: MemberLevel[];
    /** Households of two or more active members. Null like `MemberLevel.inHousehold`. */
    households: number | null;
    /**
     * Memberships: one per household plus one per member who is in none. Null like
     * `households`. No LGL search lists these, so the figure has no link.
     */
    memberships: number | null;
    /** Who paid dues this year: fewer than `total`, since a household shares one. */
    dues: { payers: number; amount: number; url: string | null } | null;
    /** These searches in LGL. Null when LGL_UI_BASE_URL is unset. */
    url: string | null;
    newUrl: string | null;
  } | null;
  /** Null when the dues categories are not configured. */
  renewals: {
    rows: RenewalRow[];
    autoRenew: number;
    manual: number;
    noDues: number;
    /** Members whose record has no end date, so they fall in no month. */
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
  /**
   * Distinct givers, leaving out dues, grant payments and purchases. LGL can list
   * the gifts behind this but not these people: its closest constituent search
   * returned 27 for 25, so the link goes to the gifts and says so.
   */
  donors: { thisYear: number; gifts: number; giftsUrl: string | null } | null;
  /** Monthly, for the charts. This year's months after `through` are null. */
  monthly: {
    months: string[];
    dues: { thisYear: (number | null)[]; lastYear: number[] };
    /** Gifts by the same definition as `donors`: no dues, grants or purchases. */
    giving: { thisYear: (number | null)[]; lastYear: number[] };
  } | null;
  /** Gifts only: dues, grant payments and purchases each have their own place. */
  byCampaign: CampaignGiving[];
  /** Sales left out of giving this year, so the page can say how much and where it went. */
  purchasesThisYear: number;
  nextQuarter: { months: string[]; items: ExpectedInflow[] } | null;
  /**
   * Provisional, like every LGL payment figure: computed from payment records
   * linked to their award, so an unlinked payment makes `remaining` too high.
   */
  operatingGrants: {
    awarded: number;
    received: number;
    remaining: number;
    awards: OperatingAward[];
    /** Those records in LGL, by gift ID. Null when LGL_UI_BASE_URL is unset or there are none. */
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
  /** Cash gifts read, beside every figure drawn from them. */
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
