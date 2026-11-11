/**
 * Membership: members first, then dues-paying memberships as a separate finance
 * section (decided 2026-11-10).
 *
 * Two words, two meanings, kept apart everywhere on the dashboard:
 *
 *   - **Members** are people with an active membership in LGL, minors included.
 *     This is what the board counts, and the only headline.
 *   - **Dues-paying memberships** are paid accounts, one per dues payment, each an
 *     individual or a household. They matter for dues and nothing else.
 *
 * A count of people is never labelled memberships, and a count of accounts is
 * never labelled members.
 *
 * Counts only. Names stay in LGL: the dashboard has one shared passphrase, and
 * who has not renewed is a list for the membership committee, not a figure for
 * every board member's phone. A linked number opens the same list in LGL, behind
 * LGL's own login, and each search was checked to land on the same count.
 */

import { CumulativeChart } from "./CumulativeChart";
import { How, SourceLine } from "./Disclosure";
import { formatDate, monthAbbrev, usd } from "./format";
import { LglLink } from "./LglLink";
import { Kpi } from "./Overview";
import { DUES_CHECK_ANCHOR, MEMBERSHIP_TYPES_ANCHOR, duesCheckSentence } from "./Reconciliation";
import type { CommunitySnapshot, Memberships, ReconciliationSnapshot, RenewalRow } from "./types";

const count = (n: number) => n.toLocaleString("en-US");

/** "Nov 2026" from "2026-11"; everything past the listed months is one row. */
function renewalLabel(row: RenewalRow): string {
  return row.month ? `${monthAbbrev(row.month)} ${row.month.slice(0, 4)}` : "Later";
}

function Levels({ members }: { members: NonNullable<CommunitySnapshot["members"]> }) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Members by level</h2>
      </div>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="num">Members</th>
            </tr>
          </thead>
          <tbody>
            {members.byLevel.map((l) => (
              <tr key={l.level}>
                <th scope="row">{l.level}</th>
                <td className="num">
                  <LglLink url={l.url}>{count(l.count)}</LglLink>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ops-total">
              <th scope="row">Total</th>
              <td className="num">
                <LglLink url={members.url}>{count(members.total)}</LglLink>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">Counts people, by the level on their current membership record.</p>
    </section>
  );
}

function Renewals({ renewals }: { renewals: NonNullable<CommunitySnapshot["renewals"]> }) {
  const total = renewals.autoRenew + renewals.manual + renewals.noDues;
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Members up for renewal by month</h2>
      </div>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Membership ends</th>
              <th scope="col" className="num">Members</th>
              <th scope="col" className="num">Auto-renew</th>
              <th scope="col" className="num">Renew by hand</th>
              <th scope="col" className="num">Method unknown</th>
            </tr>
          </thead>
          <tbody>
            {renewals.rows.map((r) => (
              <tr key={r.month ?? "later"}>
                <th scope="row">{renewalLabel(r)}</th>
                <td className="num">
                  <LglLink url={r.url}>{count(r.total)}</LglLink>
                </td>
                <td className="num">
                  <LglLink url={r.autoRenewUrl}>{count(r.autoRenew)}</LglLink>
                </td>
                <td className="num">
                  <LglLink url={r.manualUrl}>{count(r.manual)}</LglLink>
                </td>
                <td className="num">{count(r.noDues)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ops-total">
              <th scope="row">Total</th>
              <td className="num">{count(total)}</td>
              <td className="num">{count(renewals.autoRenew)}</td>
              <td className="num">{count(renewals.manual)}</td>
              <td className="num">
                {renewals.noDues > 0 ? (
                  <a className="lgl-link" href="#reconciliation/no-dues" title="See who they are on the Reconciliation tab">
                    {count(renewals.noDues)}
                  </a>
                ) : (
                  "0"
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">Counts people, so a household renewing on one payment counts once per member.</p>
      <How>
        <p>
          <strong>Auto-renew</strong> means the member's latest dues payment is coded Membership-Recurring in LGL,
          including a household member credited on someone else's payment. <strong>Renew by hand</strong> means it was a
          one-time payment.
        </p>
        <p>
          <strong>Method unknown</strong> means no dues payment is on record for the member, so nothing says how they
          renew. They are listed on the Reconciliation tab.
          {renewals.undated > 0 ? ` ${count(renewals.undated)} with no end date in LGL are not in any month.` : ""}
        </p>
      </How>
    </section>
  );
}

/** The finance table: accounts, not people. */
function MembershipTypes({
  memberships,
  reconciliation,
  checking,
}: {
  memberships: Memberships;
  reconciliation: ReconciliationSnapshot | null;
  checking: boolean;
}) {
  const check = reconciliation?.duesCheck ?? null;
  const findings = memberships.findings.reduce((n, f) => n + f.records.length, 0);
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Dues-paying memberships</h2>
        <strong className="card-figure">{count(memberships.total)}</strong>
      </div>
      <p className="muted">One per dues payment, covering either an individual or a household.</p>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Level and type</th>
              <th scope="col" className="num">Annual rate</th>
              <th scope="col" className="num">Memberships</th>
              <th scope="col" className="num">Expected annual dues</th>
            </tr>
          </thead>
          <tbody>
            {memberships.types.map((t) => (
              <tr key={`${t.level} ${t.type}`}>
                <th scope="row">
                  {t.level} {t.type}
                </th>
                <td className="num">{usd.format(t.rate)}</td>
                <td className="num">{count(t.count)}</td>
                <td className="num">{usd.format(t.expected)}</td>
              </tr>
            ))}
            {memberships.unmatched > 0 ? (
              <tr>
                <th scope="row">
                  <a className="lgl-link" href={`#${MEMBERSHIP_TYPES_ANCHOR}`}>
                    Paid an amount that matches no rate
                  </a>
                </th>
                <td className="num">—</td>
                <td className="num">{count(memberships.unmatched)}</td>
                <td className="num">—</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="ops-total">
              <th scope="row">Total</th>
              <td />
              <td className="num">{count(memberships.total)}</td>
              <td className="num">{usd.format(memberships.expectedDues)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* The check's one-line result. Its figures are on Reconciliation. */}
      <p className={check?.status === "flagged" ? "note warn-text" : "note"}>
        {checking ? (
          "Checking expected dues against QuickBooks…"
        ) : check ? (
          <a className="lgl-link" href={`#${DUES_CHECK_ANCHOR}`}>
            {duesCheckSentence(check)}.
          </a>
        ) : (
          "Expected dues could not be checked against QuickBooks."
        )}
        {findings > 0 ? (
          <>
            {" "}
            <a className="fix-link" href={`#${MEMBERSHIP_TYPES_ANCHOR}`}>
              {count(findings)} {findings === 1 ? "record" : "records"} to fix
            </a>
          </>
        ) : null}
      </p>

      <How>
        <p>
          <strong>A membership is one dues payment:</strong> the latest Memberships or Membership-Recurring gift of an
          active member, together with every active member credited on it. Minors are members, not memberships, and pay
          no dues.
        </p>
        <p>
          <strong>Individual or household comes from the amount paid</strong>, because LGL's levels (Classic, Champion,
          Minor) do not say. A payment that also covers the card fee counts at its plain rate. Who is linked to whom in
          LGL is only a cross-check; where the two disagree, the record is listed on Reconciliation.
        </p>
        <p>
          <strong>Expected annual dues</strong> is the number of memberships times the rate. It is what today's
          memberships would bring in over a year, not what has been received. Members with no dues payment on record are
          in no membership.
        </p>
      </How>
    </section>
  );
}

export function MembershipView({
  snapshot,
  reconciliation,
  checking,
}: {
  snapshot: CommunitySnapshot;
  reconciliation: ReconciliationSnapshot | null;
  /** The comparison with QuickBooks is still being read. */
  checking: boolean;
}) {
  if (snapshot.status !== "ok") {
    return (
      <section className="panel">
        <h1>Membership</h1>
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
          {snapshot.note ?? "LGL could not be read."}
        </p>
      </section>
    );
  }

  const { members, monthly, year } = snapshot;
  const isNew = members?.newThisYear ?? null;

  return (
    <section className="panel">
      <h1>Membership</h1>
      <p className="muted">
        As LGL holds it through {formatDate(snapshot.through!)}.
        {snapshot.connection === "fixture" ? " Fixture data." : ""}
      </p>

      <div className="kpis kpis-2">
        <Kpi
          label="Members"
          value={members ? count(members.total) : "Not shown"}
          tone={members ? undefined : "unavailable"}
          detail={members ? "People with an active membership, including minors" : undefined}
          href={members?.url}
        />
        <Kpi
          label={`New members in ${year}`}
          value={isNew !== null ? count(isNew) : "Not shown"}
          tone={isNew !== null ? undefined : "unavailable"}
          detail={isNew !== null ? "First membership began this year" : undefined}
          href={isNew !== null ? members?.newUrl : null}
        />
      </div>

      <div className="stack membership-cards">
        {members ? <Levels members={members} /> : null}
        {snapshot.renewals ? <Renewals renewals={snapshot.renewals} /> : null}
      </div>

      <h2 className="section-title section-divide">Dues and finance</h2>
      <div className="stack membership-cards">
        {members?.memberships ? (
          <MembershipTypes memberships={members.memberships} reconciliation={reconciliation} checking={checking} />
        ) : (
          <section className="card card-pad">
            <h2>Dues-paying memberships</h2>
            <p className="unavailable">Not shown. The dues categories or rates are not set on the Worker.</p>
          </section>
        )}
      </div>

      {monthly && members?.dues ? (
        <>
          <div className="charts charts-single">
            <CumulativeChart
              title="Membership dues, cumulative"
              months={monthly.months}
              series={[
                { key: "this", label: String(year), values: monthly.dues.thisYear, className: "series-actual" },
                { key: "last", label: String(year! - 1), values: monthly.dues.lastYear, className: "series-last" },
              ]}
            />
          </div>
          <p className="note">
            <LglLink url={members.dues.url}>
              {usd.format(members.dues.amount)} in dues this year from {count(members.dues.payments)} dues{" "}
              {members.dues.payments === 1 ? "payment" : "payments"}
            </LglLink>
            , one for each membership that paid this year.
          </p>
        </>
      ) : null}

      <How label="About this page">
        <p>
          Source: {snapshot.source}. Linked numbers open in LGL, which needs its own login. Names are in LGL, not here.
          {snapshot.cached ? " LGL is read about once an hour, so a change there can take that long to show." : ""}
        </p>
        <p>
          New means a first membership record that began this year, so someone long-standing who was entered
          in LGL late can look new.
        </p>
      </How>
      <SourceLine lgl={snapshot.retrievedAt} qbo={reconciliation?.qboRetrievedAt} />
    </section>
  );
}
