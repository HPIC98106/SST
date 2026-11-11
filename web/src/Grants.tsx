/**
 * Grant awards, one at a time, in two places (decided 2026-11-10).
 *
 * Rebuild awards are a compact table on the Rebuild tab. Program and operating
 * awards are cards on the Grants tab, which is the working view for whoever owns
 * those grants: the awards with money still to come first, and that money as the
 * figure that stands out. The two are never mixed and never added together.
 *
 * A status says only what the records say: awaiting a first payment, partly
 * received, received in full. Nothing here calls a grant healthy. That needs
 * Spent, which waits on QuickBooks tagging each expense to its grant, so until
 * then Spent is not on the page at all rather than shown as $0.
 *
 * No notes are shown: they hold funder staff names and email addresses.
 */

import { useState } from "react";
import { How } from "./Disclosure";
import { formatDate, usd } from "./format";
import { LglLink } from "./LglLink";
import { Kpi } from "./Overview";
import type { GrantDetail, GrantDetailsSnapshot, GrantStatus } from "./types";

/** Where "Terms not set" and unlinked payments are listed on Reconciliation. */
export const TERMS_ANCHOR = "reconciliation/terms";
export const UNLINKED_ANCHOR = "reconciliation/unlinked";

const STATUS_LABELS: Record<GrantStatus, string> = {
  awaiting: "Awaiting first payment",
  partial: "Partly received",
  full: "Received in full",
  over: "Received more than awarded",
  unknown: "Received not read",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Money still to come, or not known to be all in: the awards someone has to watch. */
const isActive = (g: GrantDetail) => g.stillToArrive === null || g.stillToArrive > 0;

const money = (n: number | null) => (n === null ? <span className="unavailable">Not shown</span> : usd.format(n));

/** A short pointer to Reconciliation when a payment is on no award. Never the details. */
function UnlinkedPointer({ snapshot }: { snapshot: GrantDetailsSnapshot }) {
  const count = snapshot.unlinkedPayments?.count ?? 0;
  if (count === 0) return null;
  return (
    <a className="fix-link" href={`#${UNLINKED_ANCHOR}`}>
      {plural(count, "record")} to fix
    </a>
  );
}

function Unavailable({ title, snapshot }: { title: string; snapshot: GrantDetailsSnapshot }) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
        {snapshot.note ?? "LGL could not be read."}
      </p>
    </section>
  );
}

// --- Rebuild tab ---

function RebuildRow({ grant }: { grant: GrantDetail }) {
  return (
    <tr>
      <th scope="row">
        <LglLink url={grant.url}>{grant.name}</LglLink>
      </th>
      <td className="num">
        <LglLink url={grant.url}>{usd.format(grant.awarded)}</LglLink>
      </td>
      <td className="num">
        {grant.received === null ? money(null) : <LglLink url={grant.receivedUrl}>{usd.format(grant.received)}</LglLink>}
      </td>
      <td className="num">{grant.stillToArrive === null ? money(null) : <strong>{usd.format(grant.stillToArrive)}</strong>}</td>
      <td>{STATUS_LABELS[grant.status]}</td>
    </tr>
  );
}

/** One row per rebuild award, money still to come first, with those received in full folded into one line. */
export function RebuildGrants({ snapshot }: { snapshot: GrantDetailsSnapshot }) {
  const [showFull, setShowFull] = useState(false);
  if (snapshot.status !== "ok") return <Unavailable title="Rebuild grants" snapshot={snapshot} />;

  const grants = snapshot.grants.filter((g) => g.scope === "rebuild");
  const active = grants.filter(isActive);
  const full = grants.filter((g) => !isActive(g));
  const totals = snapshot.totals.rebuild;

  return (
    <section className="panel">
      <div className="card-head">
        <h1>Rebuild grants</h1>
        <UnlinkedPointer snapshot={snapshot} />
      </div>
      {snapshot.connection === "fixture" ? <p className="banner banner-warn">Fixture data, not HPIC's grant records.</p> : null}
      {snapshot.note ? <p className="banner banner-error">{snapshot.note}</p> : null}

      {grants.length === 0 ? (
        <p className="note">LGL holds no rebuild grant awards.</p>
      ) : (
        <div className="table-scroll">
          <table className="breakdown">
            <thead>
              <tr>
                <th scope="col">Funder and award year</th>
                <th scope="col" className="num">Awarded</th>
                <th scope="col" className="num">
                  Received <span className="tag tag-warn">Provisional</span>
                </th>
                <th scope="col" className="num">Still to come</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {active.map((g) => (
                <RebuildRow key={g.id} grant={g} />
              ))}
              {full.length > 0 ? (
                <tr className="fold-row">
                  <th scope="row" colSpan={5}>
                    <button type="button" className="fold-toggle" aria-expanded={showFull} onClick={() => setShowFull(!showFull)}>
                      {plural(full.length, "award")} received in full
                    </button>
                  </th>
                </tr>
              ) : null}
              {showFull ? full.map((g) => <RebuildRow key={g.id} grant={g} />) : null}
            </tbody>
            <tfoot>
              <tr className="ops-total">
                <th scope="row">Total, {plural(totals.count, "award")}</th>
                <td className="num">
                  <LglLink url={totals.awardedUrl}>{usd.format(totals.awarded)}</LglLink>
                </td>
                <td className="num">
                  {totals.received === null ? money(null) : <LglLink url={totals.receivedUrl}>{usd.format(totals.received)}</LglLink>}
                </td>
                <td className="num">{money(totals.stillToArrive)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <How>
        <p>
          <strong>Received</strong> is the payments LGL links to each award, and <strong>still to come</strong> is the
          award less those. Both are provisional: QuickBooks has not confirmed them, and a payment not linked to its
          award makes still to come too high.
        </p>
        <p>
          Each award is named by its funder and the year on its LGL record, which is the date it was entered and not
          always the date it was awarded. Every name and figure opens the record in LGL.
        </p>
        <p>
          Spending is not shown against rebuild awards. No rebuild grant money will be drawn until the rest of the cash
          is raised.
        </p>
      </How>
    </section>
  );
}

// --- Grants tab: program and operating grants ---

function Terms({ grant }: { grant: GrantDetail }) {
  if (grant.termsUnreadable) {
    return (
      <a className="tag tag-warn tag-link" href={`#${TERMS_ANCHOR}`}>
        Terms unreadable: "{grant.termsUnreadable}"
      </a>
    );
  }
  if (grant.termsValue) return <span className="tag">{grant.termsValue}</span>;
  return (
    <a className="tag tag-warn tag-link" href={`#${TERMS_ANCHOR}`}>
      Terms not set
    </a>
  );
}

function AwardCard({ grant }: { grant: GrantDetail }) {
  const share = grant.received !== null && grant.awarded > 0 ? Math.min(100, (grant.received / grant.awarded) * 100) : 0;
  return (
    <article className="grant-card">
      <h3>
        <LglLink url={grant.url}>{grant.name}</LglLink>
      </h3>
      <p className="grant-meta">
        {grant.named && grant.funder ? `${grant.funder} · ` : ""}
        {grant.awardDate ? `Award date in LGL: ${formatDate(grant.awardDate)}` : "No award date in LGL"}
      </p>
      <p className="grant-tags">
        <span className={grant.status === "over" ? "tag tag-warn" : "tag"}>{STATUS_LABELS[grant.status]}</span>
        <Terms grant={grant} />
      </p>

      <p className="grant-still">
        <span>Still to come</span>
        <strong>{money(grant.stillToArrive)}</strong>
      </p>
      <span
        className="grant-track"
        role="img"
        aria-label={grant.received === null ? "Received could not be read" : `${Math.round(share)}% of the award received`}
      >
        <span className="grant-fill" style={{ width: `${share}%` }} />
      </span>
      <p className="grant-awarded">
        <span>
          Received <span className="tag tag-warn">Provisional</span>
        </span>
        <strong>
          {grant.received === null ? money(null) : <LglLink url={grant.receivedUrl}>{usd.format(grant.received)}</LglLink>}
        </strong>
      </p>
      <p className="grant-awarded">
        <span>Awarded</span>
        <strong>
          <LglLink url={grant.url}>{usd.format(grant.awarded)}</LglLink>
        </strong>
      </p>
      {grant.overBy !== null ? (
        <p className="note warn-text">Payments linked to this award come to {usd.format(grant.overBy)} more than the award in LGL.</p>
      ) : null}

      <details className="grant-more">
        <summary>Payments</summary>
        {grant.payments.length > 0 ? (
          <ul className="line-list">
            {grant.payments.map((p) => (
              <li key={p.id}>
                <span>{formatDate(p.date)}</span>
                <span className="num">
                  <LglLink url={p.url}>{usd.format(p.amount)}</LglLink>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No payment received in LGL yet.</p>
        )}
        {grant.scheduled.length > 0 ? (
          <p className="note">
            <strong>Installments scheduled in LGL:</strong> {grant.scheduled.map((n) => usd.format(n)).join(", ")}. Each
            has a due date in LGL, but LGL does not pass due dates to the dashboard, so <LglLink url={grant.url}>open the
            award</LglLink> to see them. The dashboard cannot tell which have been paid either, so this can include one
            already paid, and none is counted as received.
          </p>
        ) : null}
      </details>
      {grant.url ? (
        <p className="grant-open">
          <LglLink url={grant.url}>Open the award in LGL ↗</LglLink>
        </p>
      ) : null}
    </article>
  );
}

export function ProgramGrantsView({ snapshot }: { snapshot: GrantDetailsSnapshot }) {
  if (snapshot.status !== "ok") return <Unavailable title="Program grants" snapshot={snapshot} />;

  const grants = snapshot.grants.filter((g) => g.scope === "operating");
  // Largest still to come first; an award whose payments could not be read leads, since nobody can say it is settled.
  const active = grants.filter(isActive).sort((a, b) => (b.stillToArrive ?? Infinity) - (a.stillToArrive ?? Infinity));
  const full = grants.filter((g) => !isActive(g));
  const sum = (pick: (g: GrantDetail) => number | null) =>
    active.some((g) => pick(g) === null) ? null : active.reduce((s, g) => s + pick(g)!, 0);
  const awarded = active.reduce((s, g) => s + g.awarded, 0);
  const received = sum((g) => g.received);
  const still = sum((g) => g.stillToArrive);
  const unnamed = grants.filter((g) => !g.named).length;

  return (
    <section className="panel">
      <div className="card-head">
        <h1>Program grants</h1>
        <UnlinkedPointer snapshot={snapshot} />
      </div>
      <p className="muted">Program and operating grants. Rebuild grants are on the Rebuild tab.</p>
      {snapshot.connection === "fixture" ? <p className="banner banner-warn">Fixture data, not HPIC's grant records.</p> : null}
      {snapshot.note ? <p className="banner banner-error">{snapshot.note}</p> : null}

      <div className="kpis">
        <Kpi
          label="Active awards"
          value={`${active.length} of ${grants.length}`}
          detail="Awards with money still to come"
        />
        <Kpi label="Awarded (active)" value={usd.format(awarded)} />
        <Kpi
          label="Received (active)"
          value={received === null ? "Not shown" : usd.format(received)}
          tone={received === null ? "unavailable" : "provisional"}
        />
        <div className="kpi kpi-key">
          <span className="kpi-label">Still to come</span>
          <span className={still === null ? "kpi-value unavailable" : "kpi-value"}>{still === null ? "Not shown" : usd.format(still)}</span>
          <span className="kpi-detail">Awarded less received</span>
        </div>
      </div>

      {grants.length === 0 ? <p className="note">LGL holds no program or operating grant awards.</p> : null}

      {active.length > 0 ? (
        <div className="grant-grid">
          {active.map((g) => (
            <AwardCard key={g.id} grant={g} />
          ))}
        </div>
      ) : grants.length > 0 ? (
        <p className="note">Nothing is still to come on any program award.</p>
      ) : null}

      {full.length > 0 ? (
        <details className="grant-full">
          <summary>
            {plural(full.length, "award")} received in full, {usd.format(full.reduce((s, g) => s + g.awarded, 0))}
          </summary>
          <div className="grant-grid">
            {full.map((g) => (
              <AwardCard key={g.id} grant={g} />
            ))}
          </div>
        </details>
      ) : null}

      <How>
        <p>
          <strong>Active</strong> means money is still to come. <strong>Received</strong> is the payments LGL links to an
          award, and <strong>still to come</strong> is the award less those. Both are provisional: QuickBooks has not
          confirmed them, and a payment not linked to its award makes still to come too high.
        </p>
        <p>
          <strong>Spending is not here yet.</strong> What has been spent against each award, what is left to spend, and
          what has been spent but not yet invoiced all need QuickBooks to say which grant an expense belongs to. Until it
          does, those figures are left off rather than shown as $0, so nothing here says whether a grant is on track.
        </p>
        <p>
          <strong>Payment terms</strong> are the Payment Terms field on the award in LGL, shown as LGL holds them.
          Reimbursable means the funder pays after HPIC spends and invoices.
        </p>
        <p>
          <strong>Award dates are as entered in LGL</strong>, and some were entered after the fact. Amounts are what LGL
          holds, which for some awards is after fees.
          {unnamed > 0
            ? ` ${unnamed} of ${grants.length} awards show the funder and award year, because their Grant Name field in LGL is empty.`
            : ""}
        </p>
      </How>
    </section>
  );
}
