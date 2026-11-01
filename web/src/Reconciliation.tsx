/**
 * Whether Little Green Light and QuickBooks hold the same money, side by side.
 *
 * Every difference is shown and none is explained away, because only someone
 * looking at the records can say what it is. The records that break a rule sit
 * below this on the tab: that list is for whoever fixes them, and this table is
 * the assurance a board member is after.
 */

import { formatDate, formatRetrievedAt, monthAbbrev, usd } from "./format";
import { LglLink, QboLink } from "./LglLink";
import type { CommunitySnapshot, GrantSnapshot, ReconciliationSnapshot } from "./types";

/**
 * Whether the rules were actually run. Exceptions are only looked for once every
 * read has succeeded, so an empty list after a failed read means nothing at all.
 */
export function recordsChecked(grants: GrantSnapshot | null): boolean {
  return grants !== null && grants.stages.every((s) => s.status !== "unavailable");
}

/** Records in a rule that blocks a figure, counted as records rather than as rules. */
export function recordsNeedingAttention(grants: GrantSnapshot | null): number {
  return (grants?.exceptions ?? []).filter((e) => e.severity === "blocking").reduce((n, e) => n + e.recordCount, 0);
}

export function ReconciliationTable({ snapshot, error }: { snapshot: ReconciliationSnapshot | null; error?: string }) {
  if (snapshot?.status !== "ok" || !snapshot.period) {
    return (
      <p className="banner banner-error">
        Nothing was compared. {snapshot?.note ?? error ?? "LGL and QuickBooks could not be read."}
      </p>
    );
  }
  const { from, through } = snapshot.period;
  return (
    <>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">
                {monthAbbrev(from.slice(0, 7))} to {monthAbbrev(through.slice(0, 7))}
              </th>
              <th scope="col" className="num">LGL</th>
              <th scope="col" className="num">QuickBooks</th>
              <th scope="col" className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.label}
                  {row.note ? <small className="row-note">{row.note}</small> : null}
                </th>
                <td className="num">{row.lgl === null ? "Not shown" : <LglLink url={row.lglUrl}>{usd.format(row.lgl)}</LglLink>}</td>
                <td className="num">{row.qbo === null ? "Not shown" : <QboLink url={row.qboUrl}>{usd.format(row.qbo)}</QboLink>}</td>
                <td className="num reconcile-difference">
                  {row.status === "match" ? (
                    "Match"
                  ) : row.status === "differs" ? (
                    <strong>
                      {usd.format(Math.abs(row.difference!))} {row.difference! > 0 ? "more in LGL" : "more in QuickBooks"}
                    </strong>
                  ) : (
                    <span className="unavailable">Not compared</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Completed months only, matched to the cent with no allowance for small differences, though amounts here are rounded
        to the dollar. QuickBooks books by accrual and LGL by date received, so a difference can be timing rather than an
        error; the links open the records on each side. LGL read {formatRetrievedAt(snapshot.lglRetrievedAt)}, QuickBooks
        read {formatRetrievedAt(snapshot.qboRetrievedAt)}.
      </p>
      <p className="note">
        <strong>Not compared yet:</strong> received and spent on each grant. QuickBooks does not say which grant a deposit
        or an expense belongs to, so these are totals only.
      </p>
    </>
  );
}

/**
 * Active members with no dues payment on record, so nothing says how they renew.
 * By LGL record number, never by name: the passphrase is shared, and the link opens
 * the record behind LGL's own login.
 */
export function NoDuesMembers({ community }: { community: CommunitySnapshot | null }) {
  const members = community?.status === "ok" ? community.renewals?.noDuesMembers : undefined;
  if (!members || members.length === 0) return null;
  return (
    <div className="subpanel">
      <h2>Members with no dues payment on record ({members.length.toLocaleString("en-US")})</h2>
      <p className="muted">
        Active in LGL, but no Memberships or Membership-Recurring gift is linked to them, so the dashboard cannot say how
        they renew. Usually a household member whose soft credit on the shared payment was never added, or a membership
        that came with a gift coded to another category. Each opens in LGL.
      </p>
      <ul className="ops-list">
        {members.map((m) => (
          <li key={m.id}>
            <LglLink url={m.url}>LGL record {m.id}</LglLink>
            {m.level ? ` · ${m.level}` : ""} · membership ends {formatDate(m.finish)}
          </li>
        ))}
      </ul>
      <p className="note">Read from LGL {formatRetrievedAt(community!.retrievedAt)}.</p>
    </div>
  );
}
