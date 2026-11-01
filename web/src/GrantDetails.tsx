/**
 * Each grant on its own, so nobody has to open LGL to see where one stands.
 *
 * A status here says only what the records say: awaiting a first payment, partly
 * received, received in full. It never calls a grant healthy. That needs Spent,
 * which QuickBooks cannot yet give per grant, so Spent has its place on every card
 * and reads "Not tracked yet", never $0.
 *
 * A meter is that grant's own award, not a shared scale: the question is how far
 * along each one is, and on a shared scale a $2,750 grant beside a $500,000 one
 * would not show at all.
 */

import { formatDate, formatRetrievedAt, usd } from "./format";
import type { GrantDetail, GrantDetailsSnapshot, GrantStatus, GrantTotals } from "./types";

const STATUS_LABELS: Record<GrantStatus, string> = {
  awaiting: "Awaiting first payment",
  partial: "Partly received",
  full: "Received in full",
  over: "Received more than awarded",
  unknown: "Received not read",
};

function termsLabel(grant: GrantDetail): { text: string; warn: boolean } {
  if (grant.termsUnreadable) return { text: `Terms unreadable: "${grant.termsUnreadable}"`, warn: true };
  if (grant.terms === "reimbursable") return { text: "Reimbursable", warn: false };
  if (grant.terms === "not_reimbursable") return { text: "Not reimbursable", warn: false };
  return { text: "Terms not set", warn: true };
}

function Meter({ label, value, of, detail, tag }: { label: string; value: number | null; of: number; detail: string; tag?: string }) {
  const share = value !== null && of > 0 ? Math.min(100, (value / of) * 100) : 0;
  return (
    <div className="grant-meter">
      <span className="grant-meter-label">
        {label}
        {tag ? <span className="tag tag-warn">{tag}</span> : null}
      </span>
      <span className="grant-track" role="img" aria-label={`${label}: ${detail}`}>
        <span className="grant-fill" style={{ width: `${share}%` }} />
      </span>
      <span className={value === null ? "grant-meter-value muted" : "grant-meter-value"}>{detail}</span>
    </div>
  );
}

function GrantCard({ grant }: { grant: GrantDetail }) {
  const terms = termsLabel(grant);
  const percent = grant.received !== null && grant.awarded > 0 ? Math.round((grant.received / grant.awarded) * 100) : null;
  return (
    <article className="grant-card">
      <h3>{grant.name}</h3>
      <p className="grant-meta">
        {[
          grant.named ? grant.funder : null,
          grant.scope === "rebuild" ? "Rebuild" : "Programs",
          grant.awardDate ? `Award date in LGL: ${formatDate(grant.awardDate)}` : "No award date in LGL",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="grant-tags">
        <span className={grant.status === "over" ? "tag tag-warn" : "tag"}>{STATUS_LABELS[grant.status]}</span>
        <span className={terms.warn ? "tag tag-warn" : "tag"}>{terms.text}</span>
      </p>

      <p className="grant-awarded">
        <span>Awarded</span>
        <strong>{usd.format(grant.awarded)}</strong>
      </p>
      <Meter label="Spent" value={grant.spent} of={grant.awarded} detail={grant.spent === null ? "Not tracked yet" : usd.format(grant.spent)} />
      <Meter
        label="Received"
        value={grant.received}
        of={grant.awarded}
        detail={grant.received === null ? "Not shown" : `${usd.format(grant.received)} · ${percent}%`}
        tag="Provisional"
      />
      <p className="grant-awarded grant-remaining">
        <span>Still to arrive</span>
        <strong>{grant.stillToArrive === null ? "Not shown" : usd.format(grant.stillToArrive)}</strong>
      </p>
      {grant.overBy !== null ? (
        <p className="note warn-text">
          Payments linked to this award come to {usd.format(grant.overBy)} more than the award in LGL.
        </p>
      ) : null}

      <details className="grant-more">
        <summary>Payments and records</summary>
        {grant.payments.length > 0 ? (
          <ul className="line-list">
            {grant.payments.map((p) => (
              <li key={p.id}>
                <span>{formatDate(p.date)}</span>
                <span className="num">
                  {p.url ? (
                    <a className="lgl-link" href={p.url} target="_blank" rel="noreferrer" title="Open in LGL (needs an LGL login)">
                      {usd.format(p.amount)}
                    </a>
                  ) : (
                    usd.format(p.amount)
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No payment received in LGL yet.</p>
        )}
        {grant.scheduled.length > 0 ? (
          <p className="note">
            <strong>Scheduled in LGL:</strong> {grant.scheduled.map((n) => usd.format(n)).join(", ")}. LGL holds these with
            no date and does not mark one when a payment arrives, so this can include one already paid. None is counted as
            received.
          </p>
        ) : null}
        {grant.url ? (
          <p className="note">
            <a href={grant.url} target="_blank" rel="noreferrer">
              Open this award in LGL
            </a>
          </p>
        ) : null}
      </details>
    </article>
  );
}

function ScopeLine({ label, totals }: { label: string; totals: GrantTotals }) {
  return (
    <li>
      <span>
        {label}, {totals.count} {totals.count === 1 ? "grant" : "grants"}
      </span>
      <span className="num">
        {usd.format(totals.awarded)} awarded · {totals.received === null ? "received not shown" : `${usd.format(totals.received)} received`}
      </span>
    </li>
  );
}

export function GrantDetailsView({ snapshot }: { snapshot: GrantDetailsSnapshot }) {
  if (snapshot.status !== "ok") {
    return (
      <section className="panel">
        <h1>Grant details</h1>
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
          {snapshot.note ?? "LGL could not be read."}
        </p>
      </section>
    );
  }

  const { grants, totals, unlinkedPayments } = snapshot;
  const open = grants.filter((g) => g.status !== "full");
  const full = grants.filter((g) => g.status === "full");
  const unnamed = grants.filter((g) => !g.named).length;

  return (
    <section className="panel">
      <h1>Grant details</h1>
      <p className="muted">Every grant award in LGL, whether for the rebuild or for programs.</p>

      {snapshot.connection === "fixture" ? (
        <p className="banner banner-warn">
          Showing <strong>fixture data</strong>, not real LGL figures.
        </p>
      ) : null}
      {snapshot.note ? <p className="banner banner-error">{snapshot.note}</p> : null}

      <ul className="line-list grant-totals">
        <ScopeLine label="Rebuild" totals={totals.rebuild} />
        <ScopeLine label="Programs" totals={totals.operating} />
      </ul>

      {grants.length === 0 ? <p className="note">LGL holds no grant awards.</p> : null}

      {open.length > 0 ? (
        <>
          <h2 className="section-title">Money still to arrive</h2>
          <div className="grant-grid">
            {open.map((g) => (
              <GrantCard key={g.id} grant={g} />
            ))}
          </div>
        </>
      ) : null}

      {full.length > 0 ? (
        <details className="grant-full">
          <summary>
            Received in full ({full.length} {full.length === 1 ? "grant" : "grants"},{" "}
            {usd.format(full.reduce((sum, g) => sum + g.awarded, 0))})
          </summary>
          <div className="grant-grid">
            {full.map((g) => (
              <GrantCard key={g.id} grant={g} />
            ))}
          </div>
        </details>
      ) : null}

      <div className="panel-footer grant-notes">
        <p>
          <strong>Spent is not tracked yet.</strong> QuickBooks records spending by account, and does not yet say which
          grant an expense belongs to, so this reads "Not tracked yet" rather than $0. Whether a grant is on track needs
          that figure, so nothing here calls one healthy.
        </p>
        <p>
          <strong>Received is provisional.</strong> It comes from LGL payment records linked to each award, and has not
          been reconciled against QuickBooks.
          {unlinkedPayments && unlinkedPayments.count > 0 ? (
            <>
              {" "}
              {unlinkedPayments.count} grant {unlinkedPayments.count === 1 ? "payment" : "payments"} totalling{" "}
              {usd.format(unlinkedPayments.amount)} {unlinkedPayments.count === 1 ? "is" : "are"} linked to no award, so{" "}
              {unlinkedPayments.count === 1 ? "it is" : "they are"} on no grant here. See{" "}
              <a href="#housekeeping">Housekeeping</a>.
            </>
          ) : null}
        </p>
        <p>
          <strong>Award dates are as entered in LGL</strong>, and some were entered after the fact. Amounts are what LGL
          holds, which for some awards is after fees.
        </p>
        {unnamed > 0 ? (
          <p>
            <strong>Names:</strong> {unnamed} of {grants.length} show the funder and award year, because their Grant Name
            field in LGL is empty.
          </p>
        ) : null}
        <p>
          <strong>Data retrieved from {snapshot.source}:</strong> {formatRetrievedAt(snapshot.retrievedAt)}
        </p>
      </div>
    </section>
  );
}
