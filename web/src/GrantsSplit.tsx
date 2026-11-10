/**
 * Grants, split in two: the rebuild, and program operating grants. Asked for on
 * 2026-11-09 (Kyle and Galen), so the operating grants can be handed to a
 * volunteer on their own and each side shows what is still to come.
 *
 * Both columns come from one read (Grant details), whose rebuild totals a test
 * pins to the funnel. The two are never added together: rebuild money is
 * restricted to the rebuild, and a combined total would read as one pot.
 */

import { LglLink } from "./LglLink";
import { usd } from "./format";
import type { GrantDetailsSnapshot, GrantTotals } from "./types";

/** Section ids below on the Summary view, for the "see" buttons. */
export const REBUILD_SECTION_ID = "grants-rebuild";
export const OPERATING_SECTION_ID = "grants-operating";

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Side({ title, blurb, totals, sectionId, more }: {
  title: string;
  blurb: string;
  totals: GrantTotals;
  sectionId: string;
  more: string;
}) {
  return (
    <section className="card card-pad">
      <h2>{title}</h2>
      <p className="muted">
        {blurb} {totals.count.toLocaleString("en-US")} {totals.count === 1 ? "award" : "awards"}.
      </p>
      <ul className="line-list">
        <li>
          <span>Awarded</span>
          <span className="num">
            <LglLink url={totals.awardedUrl}>{usd.format(totals.awarded)}</LglLink>
          </span>
        </li>
        <li>
          <span>
            Received <span className="tag tag-warn">Provisional</span>
          </span>
          <span className="num">
            {totals.received === null ? (
              <span className="unavailable">Not shown</span>
            ) : (
              <LglLink url={totals.receivedUrl}>{usd.format(totals.received)}</LglLink>
            )}
          </span>
        </li>
        <li className="split-still">
          <span>
            <strong>Still to come</strong>
          </span>
          <strong className="num">
            {totals.stillToArrive === null ? (
              <span className="unavailable">Not shown</span>
            ) : (
              usd.format(totals.stillToArrive)
            )}
          </strong>
        </li>
      </ul>
      <button type="button" className="hero-more split-more" onClick={() => scrollTo(sectionId)}>
        {more}
      </button>
    </section>
  );
}

export function GrantsSplit({ snapshot }: { snapshot: GrantDetailsSnapshot }) {
  if (snapshot.status !== "ok") return null;
  const { rebuild, operating } = snapshot.totals;
  return (
    <section className="panel">
      <h1>Grants: rebuild and program operating</h1>
      <div className="grants-split">
        <Side
          title="Rebuild"
          blurb="Awards for rebuilding the clubhouse."
          totals={rebuild}
          sectionId={REBUILD_SECTION_ID}
          more="See the rebuild funnel"
        />
        <Side
          title="Program operating"
          blurb="Awards for programs and day-to-day operations."
          totals={operating}
          sectionId={OPERATING_SECTION_ID}
          more="See each operating award"
        />
      </div>
      <p className="note">
        Kept apart and never added together: rebuild money can only go to the rebuild. Received and still to come are
        worked out from LGL payment records linked to each award, so they are provisional until QuickBooks confirms them;
        a payment not linked to its award makes "still to come" too high.
      </p>
    </section>
  );
}
