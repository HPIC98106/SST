/**
 * Membership: who is a member today, how the membership is made up, when it comes
 * up for renewal, and what dues have brought in.
 *
 * Counts only. Names stay in LGL: the dashboard has one shared passphrase, and
 * who has not renewed is a list for the membership committee, not a figure for
 * every board member's phone. A linked number opens the same list in LGL, behind
 * LGL's own login, and each search was checked to land on the same count.
 */

import { CumulativeChart } from "./CumulativeChart";
import { formatDate, formatRetrievedAt, monthAbbrev, usd } from "./format";
import { LglLink } from "./LglLink";
import { Kpi } from "./Overview";
import type { CommunitySnapshot, RenewalRow } from "./types";

const count = (n: number) => n.toLocaleString("en-US");

/** "Nov 2026" from "2026-11"; everything past the listed months is one row. */
function renewalLabel(row: RenewalRow): string {
  return row.month ? `${monthAbbrev(row.month)} ${row.month.slice(0, 4)}` : "Later";
}

function Levels({ members }: { members: NonNullable<CommunitySnapshot["members"]> }) {
  const known = members.households !== null;
  const add = (pick: (l: (typeof members.byLevel)[number]) => number | null) =>
    members.byLevel.reduce((sum, l) => sum + (pick(l) ?? 0), 0);
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
              <th scope="col" className="num">In a household</th>
              <th scope="col" className="num">Individual</th>
            </tr>
          </thead>
          <tbody>
            {members.byLevel.map((l) => (
              <tr key={l.level}>
                <th scope="row">{l.level}</th>
                <td className="num">
                  <LglLink url={l.url}>{count(l.count)}</LglLink>
                </td>
                <td className="num">{l.inHousehold === null ? "—" : count(l.inHousehold)}</td>
                <td className="num">{l.individual === null ? "—" : count(l.individual)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ops-total">
              <th scope="row">Total</th>
              <td className="num">
                <LglLink url={members.url}>{count(members.total)}</LglLink>
              </td>
              <td className="num">{known ? count(add((l) => l.inHousehold)) : "—"}</td>
              <td className="num">{known ? count(add((l) => l.individual)) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">
        {known
          ? `${count(members.households!)} households have two or more members. A member is in a household when LGL links them to another active member as household or spouse/partner.`
          : "LGL's relationships could not be read, so households are not shown."}
      </p>
    </section>
  );
}

function Renewals({ renewals }: { renewals: NonNullable<CommunitySnapshot["renewals"]> }) {
  const total = renewals.autoRenew + renewals.manual + renewals.noDues;
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Coming up for renewal</h2>
      </div>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Membership ends</th>
              <th scope="col" className="num">Members</th>
              <th scope="col" className="num">Auto-renew</th>
              <th scope="col" className="num">Renew by hand</th>
              <th scope="col" className="num">No dues on record</th>
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
              <td className="num">{count(renewals.noDues)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">
        Counts people, so a household renewing on one payment counts once per member. Auto-renew means their latest dues
        payment is coded Membership-Recurring in LGL, including a household member credited on someone else's payment. Members
        with no dues on record are listed on the Reconciliation tab.
        {renewals.undated > 0 ? ` ${count(renewals.undated)} with no end date in LGL are not in any month.` : ""}
      </p>
    </section>
  );
}

export function MembershipView({ snapshot }: { snapshot: CommunitySnapshot }) {
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
          label="Total members"
          value={members ? count(members.total) : "Not shown"}
          tone={members ? undefined : "unavailable"}
          detail={members ? "Active in LGL today" : undefined}
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
              {count(members.dues.payers)} people paid {usd.format(members.dues.amount)}
            </LglLink>{" "}
            in dues this year. Members outnumber them because one payment can cover a household, and some paid before
            January or through the December drive.
          </p>
        </>
      ) : null}

      <div className="panel-footer">
        <p>
          <strong>Source:</strong> {snapshot.source}. Linked numbers open in LGL, which needs its own login. Names are in
          LGL, not here.
        </p>
        <p>
          <strong>Data retrieved from LGL:</strong> {formatRetrievedAt(snapshot.retrievedAt)}
          {snapshot.cached ? " (cached, refreshed about once an hour)" : ""}
        </p>
      </div>
    </section>
  );
}
