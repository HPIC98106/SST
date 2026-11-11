/**
 * The two pieces that keep fine print off the page (decided 2026-11-10).
 *
 * A panel shows its figure, a plain label and at most one sentence. How the
 * figure is worked out, where it comes from and what it leaves out go in `How`,
 * closed until someone asks. When each system was read goes in one `SourceLine`
 * at the foot of the tab, not under every panel.
 *
 * What never goes in here: a figure that could not be read, a sandbox or fixture
 * warning, or a record that needs fixing. Those are not fine print, and hiding
 * one would make a page that looks fine when it is not.
 */

import type { ReactNode } from "react";
import { formatRetrievedAt } from "./format";

export function How({ children, label = "How this is calculated" }: { children: ReactNode; label?: string }) {
  return (
    <details className="how">
      <summary>{label}</summary>
      <div className="how-body">{children}</div>
    </details>
  );
}

/**
 * "QuickBooks as of …, LGL as of …". Each time is the system's own clock, never
 * the browser's. Leave a system out by not passing it; null means it was not read.
 */
export function SourceLine({ qbo, lgl }: { qbo?: string | null; lgl?: string | null }) {
  const parts = [
    qbo !== undefined ? `QuickBooks as of ${qbo ? formatRetrievedAt(qbo) : "not read"}` : null,
    lgl !== undefined ? `LGL as of ${lgl ? formatRetrievedAt(lgl) : "not read"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="source-line">{parts.join(", ")}.</p>;
}
