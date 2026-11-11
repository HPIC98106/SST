/**
 * Reconciliation: the one place for anything that needs fixing (2026-11-10).
 *
 * Three sections, in this order. Whether Little Green Light and QuickBooks hold
 * the same money. Whether today's memberships would bring in roughly the dues
 * that actually came in. And every record that breaks a rule, grouped by kind,
 * each with a count and a way into LGL.
 *
 * Other tabs carry a short pointer here ("1 record to fix") and nothing more, so
 * a board member reading the Overview is not handed a to-do list, and whoever
 * fixes records finds all of them together.
 *
 * Two rules shape it. Every difference is shown and none is explained away,
 * because only someone looking at the records can say what it is. And every group
 * is always listed: one with nothing in it says "Nothing to fix", so it reads as
 * checked, and one that could not be checked says that instead. Zero must never
 * mean "nothing was read".
 *
 * Records are named by LGL record number, never by a person's name: the passphrase
 * is shared, and each link opens behind LGL's own login.
 */

import { useEffect, type ReactNode } from "react";
import { How, SourceLine } from "./Disclosure";
import { formatDate, monthAbbrev, recordCountLabel, usd } from "./format";
import { TERMS_ANCHOR, UNLINKED_ANCHOR } from "./Grants";
import { LglLink, QboLink } from "./LglLink";
import { OperationsProblems } from "./Operations";
import { Reading } from "./Overview";
import type {
  CommunitySnapshot,
  DataQualityException,
  DataQualityRecord,
  DuesCheck,
  GrantDetailsSnapshot,
  GrantSnapshot,
  OperationsSnapshot,
  ReconciliationSnapshot,
} from "./types";

/** Anchors other tabs link to: the tab, then the section's id. */
export const NO_DUES_ANCHOR = "reconciliation/no-dues";
export const DUES_CHECK_ANCHOR = "reconciliation/dues-check";
export const MEMBERSHIP_TYPES_ANCHOR = "reconciliation/memberships";
const sectionId = (anchor: string) => anchor.split("/")[1];

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

/** The check in one sentence, for the Membership tab and the top of its section here. */
export function duesCheckSentence(check: DuesCheck): string {
  if (check.status === "unavailable" || check.percent === null) {
    const why = check.note?.replace(/\.$/, "");
    return why ? `Expected dues could not be checked: ${why}` : "Expected dues could not be checked";
  }
  const percent = Math.round(Math.abs(check.percent));
  if (check.status === "within") return `Expected dues within ${percent}% of received`;
  return `Expected dues ${percent}% ${check.percent > 0 ? "above" : "below"} received: check membership logic`;
}

// --- 1. Do LGL and QuickBooks agree? ---

function ReconciliationTable({ snapshot, error }: { snapshot: ReconciliationSnapshot | null; error?: string }) {
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
      <p className="note">Completed months only, matched to the cent.</p>
      <How>
        <p>
          Each row sets one kind of money in LGL beside the same kind in QuickBooks, for the completed months of the
          year. A difference of one cent is a difference: there is no allowance for small ones, though amounts here are
          shown to the dollar.
        </p>
        <p>
          QuickBooks books by accrual and LGL by the date money was received, so a difference can be timing rather than
          an error. The links open the records on each side so someone can look.
        </p>
        <p>
          <strong>Not compared yet:</strong> received and spent on each grant. QuickBooks does not yet say which grant a
          deposit or an expense belongs to, so these are totals only.
        </p>
      </How>
    </>
  );
}

// --- 2. Expected dues check ---

function DuesCheckPanel({ check }: { check: DuesCheck }) {
  const months =
    check.from && check.through
      ? `${monthAbbrev(check.from.slice(0, 7))} ${check.from.slice(0, 4)} to ${monthAbbrev(check.through.slice(0, 7))} ${check.through.slice(0, 4)}`
      : "the last twelve months";
  return (
    <>
      <p className={`banner ${check.status === "within" ? "banner-live" : check.status === "flagged" ? "banner-warn" : "banner-error"}`}>
        <strong>{duesCheckSentence(check)}.</strong>
      </p>
      <div className="table-scroll">
        <table className="breakdown">
          <tbody>
            <tr>
              <th scope="row">
                Expected
                <small className="row-note">Today's dues-paying memberships at their annual rates, from LGL</small>
              </th>
              <td className="num">{check.expected === null ? <span className="unavailable">Not shown</span> : usd.format(check.expected)}</td>
            </tr>
            <tr>
              <th scope="row">
                Received
                <small className="row-note">Membership dues in QuickBooks, {months}</small>
              </th>
              <td className="num">
                {check.received === null ? (
                  <span className="unavailable">Not shown</span>
                ) : (
                  <QboLink url={check.receivedUrl}>{usd.format(check.received)}</QboLink>
                )}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="ops-total">
              <th scope="row">Difference</th>
              <td className="num">
                {check.difference === null || check.percent === null ? (
                  <span className="unavailable">Not compared</span>
                ) : (
                  `${usd.format(Math.abs(check.difference))} ${check.difference >= 0 ? "more expected" : "more received"} · ${Math.round(Math.abs(check.percent))}%`
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {check.status !== "unavailable" && check.note ? <p className="note">{check.note}</p> : null}
      <How>
        <p>
          This checks the membership logic, not the books. If memberships were counted twice or a rate were misread,
          expected dues would run far from what actually came in.
        </p>
        <p>
          The two are not the same stretch of time: expected is what today's memberships pay in a year, and received is
          what QuickBooks booked over the last twelve completed months. So they are not expected to match exactly, and
          the check is flagged only when they are more than {check.tolerancePct}% apart. Dues received also include
          anyone who has since lapsed, and leave out anyone whose first payment is still to come.
        </p>
      </How>
    </>
  );
}

// --- 3. Records to fix ---

/** How many records a group lists before folding the rest away. */
const LIST_LIMIT = 20;

/** A group's records. A long list folds so the groups below it stay in reach; the count above is always the whole. */
function RecordList({ count, children }: { count: number; children: ReactNode }) {
  if (count <= LIST_LIMIT) return <ul className="ops-list">{children}</ul>;
  return (
    <details className="how fix-records">
      <summary>Show all {count.toLocaleString("en-US")}</summary>
      <ul className="ops-list">{children}</ul>
    </details>
  );
}

/** One kind of record to fix. Always rendered, so an empty one reads as checked. */
function FixGroup({
  id,
  title,
  count,
  amount,
  unchecked,
  what,
  children,
}: {
  id?: string;
  title: string;
  count: number;
  amount?: number | null;
  /** Why this could not be checked. Shown in place of a count. */
  unchecked?: string | null;
  /** What the rule is and why it matters, in a sentence. */
  what: string;
  children?: ReactNode;
}) {
  return (
    <div className="subpanel fix-group" id={id}>
      <h2>
        {title}
        {unchecked ? null : <span className={count > 0 ? "tag tag-warn" : "tag"}>{count.toLocaleString("en-US")}</span>}
        {!unchecked && count > 0 && amount != null ? <span className="fix-amount">{usd.format(amount)}</span> : null}
      </h2>
      {unchecked ? (
        <p className="unavailable">Could not be checked. {unchecked}</p>
      ) : count === 0 ? (
        <p className="note">Nothing to fix.</p>
      ) : (
        <>
          <p className="note">{what}</p>
          {children}
        </>
      )}
    </div>
  );
}

function ExceptionRecordRow({ record }: { record: DataQualityRecord }) {
  return (
    <li className="dq-record">
      <span className="dq-record-head">
        <strong>{record.who ?? `Record ${record.id}`}</strong>
        {record.amount !== null ? <span className="dq-amount">{usd.format(record.amount)}</span> : null}
      </span>
      <span className="dq-record-meta">
        {record.date ? <span>{record.date}</span> : null}
        {record.url ? (
          <a href={record.url} target="_blank" rel="noreferrer">
            Open in LGL
          </a>
        ) : (
          <span className="muted-cell">gift {record.id}</span>
        )}
      </span>
      {/* The note is usually what actually identifies the money. */}
      {record.note ? <span className="dq-record-note">“{record.note}”</span> : null}
    </li>
  );
}

function ExceptionCard({ exception }: { exception: DataQualityException }) {
  const hidden = exception.recordCount - exception.records.length;
  return (
    <section className={`dq-card dq-${exception.severity}`}>
      <h3>
        {exception.label}
        <span className="dq-badge">{exception.severity === "blocking" ? "Affects a figure" : "Advisory"}</span>
      </h3>
      <p className="dq-summary">
        <strong>{recordCountLabel(exception.recordCount)}</strong>
        {exception.amount !== null ? <> · {usd.format(exception.amount)}</> : null}
      </p>
      <p className="note">{exception.detail}</p>
      <ul className="dq-records">
        {exception.records.map((record) => (
          <ExceptionRecordRow key={record.id} record={record} />
        ))}
      </ul>
      {hidden > 0 ? <p className="note">And {hidden} more not listed here.</p> : null}
    </section>
  );
}

/** Rules reported in a group of their own below, so they are not listed twice. */
const OWN_GROUP = new Set(["unlinked_payments", "awards_missing_reimbursable", "awards_unreadable_reimbursable"]);

function RecordsToFix({
  grants,
  grantDetails,
  community,
  operations,
}: {
  grants: GrantSnapshot | null;
  grantDetails: GrantDetailsSnapshot | null;
  community: CommunitySnapshot | null;
  operations: OperationsSnapshot | null;
}) {
  const details = grantDetails?.status === "ok" ? grantDetails : null;
  const lgl = community?.status === "ok" ? community : null;
  const exceptions = grants?.exceptions ?? [];
  const checked = recordsChecked(grants);
  const notRead = "LGL could not be read.";

  const unlinked = details?.unlinkedPayments ?? null;
  const unlinkedDetail = exceptions.find((e) => e.key === "unlinked_payments");
  const noTerms = details?.grants.filter((g) => g.terms === "unknown") ?? [];
  const noDues = lgl?.renewals?.noDuesMembers ?? null;
  const soonThrough = lgl?.renewals?.soon.through;
  const endingSoon = noDues && soonThrough ? noDues.filter((m) => m.finish <= soonThrough).length : 0;
  const findings = lgl?.members?.memberships?.findings ?? null;
  const other = exceptions.filter((e) => !OWN_GROUP.has(e.key));
  const ungrouped = operations ? operations.ungrouped.length + operations.invalidConfig.length : null;

  return (
    <>
      <FixGroup
        id={sectionId(UNLINKED_ANCHOR)}
        title="Grant payments not linked to an award"
        count={unlinked?.count ?? 0}
        amount={unlinked?.amount}
        unchecked={unlinked ? null : details?.note ?? grantDetails?.note ?? notRead}
        what="A grant payment that hangs off no award is on no grant, so that award's received is too low and its still to come too high. Link the payment to its award in LGL."
      >
        <p className="note">
          <LglLink url={unlinked?.url}>Open {unlinked && unlinked.count === 1 ? "it" : "them"} in LGL</LglLink>
        </p>
        {unlinkedDetail ? (
          <div className="dq-list">
            <ExceptionCard exception={unlinkedDetail} />
          </div>
        ) : null}
      </FixGroup>

      <FixGroup
        id={sectionId(TERMS_ANCHOR)}
        title="Awards with payment terms not set"
        count={noTerms.length}
        unchecked={details ? null : grantDetails?.note ?? notRead}
        what="Until Payment Terms is set on an award in LGL, nothing says whether the funder pays up front or only after HPIC spends and invoices."
      >
        <RecordList count={noTerms.length}>
          {noTerms.map((g) => (
            <li key={g.id}>
              <LglLink url={g.url}>{g.name}</LglLink> · {usd.format(g.awarded)} · {g.scope === "rebuild" ? "Rebuild" : "Program"}
              {g.termsUnreadable ? (
                <>
                  {" "}
                  · LGL holds "{g.termsUnreadable}", which the dashboard cannot read. The value is set; it is the
                  dashboard that needs to learn it.
                </>
              ) : null}
            </li>
          ))}
        </RecordList>
      </FixGroup>

      <FixGroup
        id={sectionId(NO_DUES_ANCHOR)}
        title="Members with no dues payment on record"
        count={noDues?.length ?? 0}
        unchecked={noDues ? null : community?.note ?? (lgl ? "The dues categories are not set on the Worker." : notRead)}
        what={`Active in LGL, but no Memberships or Membership-Recurring gift is linked to them, so nothing says how they renew and they are in no dues-paying membership. Usually a household member whose soft credit on the shared payment was never added, or a membership that came with a gift coded to another category.${
          endingSoon > 0 ? ` The first ${endingSoon.toLocaleString("en-US")}, marked below, end in the next 90 days.` : ""
        }`}
      >
        <RecordList count={noDues?.length ?? 0}>
          {(noDues ?? []).map((m) => (
            <li key={m.id}>
              <LglLink url={m.url}>LGL record {m.id}</LglLink>
              {m.level ? ` · ${m.level}` : ""} · membership ends {formatDate(m.finish)}
              {soonThrough && m.finish <= soonThrough ? <span className="tag tag-warn">Next 90 days</span> : null}
            </li>
          ))}
        </RecordList>
      </FixGroup>

      <div id={sectionId(MEMBERSHIP_TYPES_ANCHOR)}>
        {findings ? (
          findings.map((f) => (
            <FixGroup key={f.key} title={f.label} count={f.records.length} what={f.detail}>
              <RecordList count={f.records.length}>
                {f.records.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <LglLink url={r.url}>{r.kind === "gift" ? `LGL gift ${r.id}` : `LGL record ${r.id}`}</LglLink>
                    {r.amount !== null ? ` · ${usd.format(r.amount)}` : ""}
                  </li>
                ))}
              </RecordList>
            </FixGroup>
          ))
        ) : (
          <FixGroup
            title="Membership type mismatches"
            count={0}
            unchecked={community?.note ?? (lgl ? "The dues categories or rates are not set on the Worker." : notRead)}
            what=""
          />
        )}
      </div>

      <FixGroup
        title="Other grant record rules"
        count={other.reduce((n, e) => n + e.recordCount, 0)}
        unchecked={checked ? null : notRead}
        what="Grant records in LGL that break one of the rules the rebuild figures depend on. Each is left out of the totals rather than guessed at."
      >
        <div className="dq-list">
          {other.map((exception) => (
            <ExceptionCard key={exception.key} exception={exception} />
          ))}
        </div>
      </FixGroup>

      <FixGroup
        title="QuickBooks accounts not yet grouped"
        count={ungrouped ?? 0}
        unchecked={ungrouped === null ? "QuickBooks could not be read." : null}
        what="An account with activity that is in no group might be rebuild money, so the Operations tab shows nothing until each is grouped or excluded in QBO_PL_GROUPS on the Worker."
      >
        {operations ? (
          <>
            <OperationsProblems snapshot={operations} />
            <ul className="ops-list">
              {operations.ungrouped.map((u) => (
                <li key={`${u.id}:${u.name}`}>
                  {u.name} {u.id ? <code>{u.id}</code> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </FixGroup>

      <How label="What this does and does not check">
        <p>
          These are the checks a program can run. It cannot tell whether money in a grant category is really a grant: a
          fee-for-service payment filed as one looks identical here, so the category itself still needs a human eye.
        </p>
        <p>
          Fixing a record in LGL changes the dashboard on its next read, which for membership can take up to an hour. How
          a grant moves through LGL and QuickBooks, stage by stage, is at the bottom of the{" "}
          <a href="#grants">Grants tab</a>.
        </p>
      </How>
    </>
  );
}

export function ReconciliationView({
  reconciliation,
  reconciliationError,
  grants,
  grantDetails,
  community,
  operations,
  pending,
}: {
  reconciliation: ReconciliationSnapshot | null;
  reconciliationError?: string;
  grants: GrantSnapshot | null;
  grantDetails: GrantDetailsSnapshot | null;
  community: CommunitySnapshot | null;
  operations: OperationsSnapshot | null;
  pending: { reconciliation: boolean; grants: boolean; grantDetails: boolean; community: boolean };
}) {
  const reading = pending.grants || pending.grantDetails || pending.community;

  // A link from another tab names a section. It may arrive before that section's
  // read does, so this runs again once everything has landed.
  useEffect(() => {
    const [tab, section] = window.location.hash.replace(/^#/, "").split("/");
    if ((tab === "reconciliation" || tab === "housekeeping") && section) {
      document.getElementById(section)?.scrollIntoView({ block: "start" });
    }
  }, [reading, pending.reconciliation]);

  return (
    <div className="stack">
      <section className="panel">
        <h1>Do LGL and QuickBooks agree?</h1>
        {pending.reconciliation ? (
          <Reading what="LGL against QuickBooks" />
        ) : (
          <ReconciliationTable snapshot={reconciliation} error={reconciliationError} />
        )}
      </section>

      <section className="panel" id={sectionId(DUES_CHECK_ANCHOR)}>
        <h1>Expected dues check</h1>
        {pending.reconciliation ? (
          <Reading what="memberships and dues" />
        ) : reconciliation?.duesCheck ? (
          <DuesCheckPanel check={reconciliation.duesCheck} />
        ) : (
          <p className="banner banner-error">
            Not checked. {reconciliation?.note ?? reconciliationError ?? "LGL and QuickBooks could not be read."}
          </p>
        )}
      </section>

      <section className="panel">
        <h1>Records to fix</h1>
        <p className="muted">Grouped by kind. Fixing a record in LGL fixes a number elsewhere on the dashboard.</p>
        {reading ? (
          <Reading what="LGL's records" slow />
        ) : (
          <RecordsToFix grants={grants} grantDetails={grantDetails} community={community} operations={operations} />
        )}
      </section>

      <SourceLine qbo={reconciliation?.qboRetrievedAt ?? operations?.retrievedAt ?? null} lgl={reconciliation?.lglRetrievedAt ?? community?.retrievedAt ?? null} />
    </div>
  );
}
