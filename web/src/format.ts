/**
 * Shared formatting. Both panels show money and a retrieval time, and those
 * two things have to look and behave the same on a screen the board reads
 * together.
 */

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Formats the timestamp the source system reported for the data itself.
 *
 * This is never the current clock. A dashboard that always shows today's date
 * regardless of data freshness is worse than showing no date at all.
 *
 * QuickBooks supplies an ISO timestamp in its response body; Little Green
 * Light has none, so its HTTP `Date` header stands in. Both parse here.
 */
export function formatRetrievedAt(value: string | null): string {
  if (!value) return "No data retrieved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Retrieval time unavailable";
  // Explicit component options rather than dateStyle/timeStyle: Intl rejects
  // combining those shorthands with timeZoneName, and the zone matters here.
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "3 records" / "1 record" — always shown beside a total, never on its own. */
export function recordCountLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "record" : "records"} in LGL`;
}

/**
 * "September 30, 2026" from "2026-09-30". Read as a calendar date, not an
 * instant: parsed in the browser's zone it would show the day before for
 * anyone west of UTC.
 */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** "Sep" from "2026-09". */
export function monthAbbrev(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
}

/** Axis ticks: $0, $5K, $1.2M. */
export function compactUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Whole dollars, for projections and community figures where cents are noise. */
export const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "+74" / "−12" / "no change", for a count against last year. */
export function signed(n: number): string {
  if (n === 0) return "no change";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US")}`;
}
