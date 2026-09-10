/**
 * Mirror of the Worker's response shape (worker/src/types.ts).
 *
 * Kept as a small hand-written copy rather than a shared package: two files to
 * update is a smaller maintenance cost for a volunteer than a build step and a
 * workspace, and this surface changes rarely.
 */

export type AccountStatus = "ok" | "unavailable" | "not_configured";

export interface AccountSnapshot {
  key: "operating" | "rebuild_fund";
  label: string;
  status: AccountStatus;
  balance: number | null;
  hasSubAccounts: boolean;
  note?: string;
}

export interface FundsSnapshot {
  accounts: AccountSnapshot[];
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
}

export type ReimbursableStatus = "reimbursable" | "not_reimbursable" | "unknown";

export interface ReimbursableBucket {
  status: ReimbursableStatus;
  label: string;
  amount: number;
  recordCount: number;
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
