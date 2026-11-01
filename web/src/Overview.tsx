/**
 * The board's landing page: the page to put on the screen at a meeting.
 *
 * It answers "how is the club doing, and what has happened lately?", because those
 * answers change between visits and the board can do something about them. Decided
 * 2026-11-01. It used to lead with "Money available now", which added rebuild money
 * to programming money and read as if spending were the goal, and leading with the
 * distance to the next phase would be no better: that gap barely moves from one
 * visit to the next. The gap is not hidden, it is on the Rebuild tab, one click away.
 *
 * No to-do lists and no names: the records that need fixing live on Reconciliation.
 * But "safe to show" never means hiding a problem: a figure that cannot be read
 * still says so here, in place, and whether the two systems agree is always on the
 * page.
 */

import type { ReactNode } from "react";
import { formatRetrievedAt, monthAbbrev, usd } from "./format";
import { LglLink, QboLink } from "./LglLink";
import { recordsChecked, recordsNeedingAttention } from "./Reconciliation";
import { monthsOfCash } from "./YearSoFar";
import type {
  AccountSnapshot,
  CommunitySnapshot,
  FundsSnapshot,
  GrantSnapshot,
  OperationsSnapshot,
  ReconciliationSnapshot,
  RecentActivity,
} from "./types";

export type Tab = "overview" | "rebuild" | "operations" | "membership" | "giving" | "grants" | "reconciliation";

/**
 * A balance under this share of all cash does not earn its own line at a meeting.
 * It is a share rather than a list of names so that a balance worth noticing, such
 * as deposits piling up unrecorded in Undeposited Funds, comes back on its own.
 */
const SMALL_BALANCE_SHARE = 0.01;

/**
 * Split a group's accounts into those shown by name and a roll-up of the small
 * ones. The small ones stay in every total, and the roll-up opens to itemise them.
 * Without a total there is nothing to measure against, and an account that could
 * not be read is never folded away, so both cases list every account.
 */
function namedAndSmall(accounts: AccountSnapshot[], totalCash: number | null) {
  const small =
    totalCash === null
      ? []
      : accounts.filter((a) => a.status === "ok" && Math.abs(a.balance ?? 0) < totalCash * SMALL_BALANCE_SHARE);
  if (small.length < 2) return { named: accounts, small: [], smallTotal: 0 };
  return {
    named: accounts.filter((a) => !small.includes(a)),
    small,
    smallTotal: small.reduce((sum, a) => sum + (a.balance ?? 0), 0),
  };
}

/** Which reads have not answered yet, so a figure can say so rather than "unavailable". */
export interface Pending {
  funds: boolean;
  grants: boolean;
  operations: boolean;
  community: boolean;
  reconciliation: boolean;
}

/** In place of a figure whose read is still under way. */
export function Reading({ what, slow = false }: { what: string; slow?: boolean }) {
  return (
    <p className="muted reading" aria-busy="true">
      Reading {what}…{slow ? " This can take half a minute." : ""}
    </p>
  );
}

/**
 * One headline figure. `tone` marks a figure that is not a plain record. `onOpen`
 * goes to a tab here; `href` opens the records behind it in LGL.
 */
export function Kpi({
  label,
  value,
  detail,
  tone,
  onOpen,
  href,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "projection" | "provisional" | "unavailable" | "reading";
  onOpen?: () => void;
  href?: string | null;
}) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={tone === "unavailable" || tone === "reading" ? `kpi-value ${tone}` : "kpi-value"}>{value}</span>
      {detail ? <span className="kpi-detail">{detail}</span> : null}
      {tone === "projection" ? <span className="tag">Projection</span> : null}
      {tone === "provisional" ? <span className="tag tag-warn">Provisional</span> : null}
    </>
  );
  if (href) {
    return (
      <a
        className={`kpi kpi-link kpi-external${tone ? ` kpi-${tone}` : ""}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        title="Open in LGL (needs an LGL login)"
      >
        {body}
        <span className="kpi-open">Open in LGL ↗</span>
      </a>
    );
  }
  return onOpen ? (
    <button type="button" className={`kpi kpi-link${tone ? ` kpi-${tone}` : ""}`} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className={`kpi${tone ? ` kpi-${tone}` : ""}`}>{body}</div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A line in "the last 30 days". Null means it cannot be told, which is not the same as none. */
function RecentLine({ label, activity, noun, provisional }: { label: string; activity: RecentActivity | null; noun: string; provisional?: boolean }) {
  return (
    <li>
      <span>
        {label}
        {activity ? <small>{plural(activity.count, noun)}{provisional ? ". Provisional." : ""}</small> : null}
      </span>
      {activity ? (
        <span className="num">
          <LglLink url={activity.url}>{usd.format(activity.amount)}</LglLink>
        </span>
      ) : (
        <span className="num unavailable">Not shown</span>
      )}
    </li>
  );
}

/** The first thing anyone sees: who the club is today, and what has happened lately. */
function ClubToday({ community, reading, open }: { community: CommunitySnapshot | null; reading: boolean; open: (tab: Tab) => void }) {
  if (reading) {
    return (
      <section className="hero">
        <div className="hero-main">
          <span className="hero-label">The club today</span>
          <p className="hero-value unavailable" aria-busy="true">
            Reading…
          </p>
          <p className="hero-note">From LGL. This can take half a minute.</p>
        </div>
      </section>
    );
  }
  const members = community?.status === "ok" ? community.members : null;
  if (!members) {
    return (
      <section className="hero">
        <div className="hero-main">
          <span className="hero-label">The club today</span>
          <p className="hero-value unavailable">Not shown</p>
          <p className="hero-note">{community?.note ?? "Membership could not be read from LGL."}</p>
        </div>
      </section>
    );
  }
  const recent = community?.recent ?? null;
  return (
    <section className="hero">
      <div className="hero-main">
        <span className="hero-label">The club today</span>
        <p className="hero-value">
          <LglLink url={members.url}>{members.total.toLocaleString("en-US")}</LglLink>
          <span className="hero-unit"> members</span>
        </p>
        <div className="hero-split">
          <div>
            <span>New in {community!.year}</span>
            <strong>
              {members.newThisYear === null ? "Not shown" : <LglLink url={members.newUrl}>{members.newThisYear.toLocaleString("en-US")}</LglLink>}
            </strong>
          </div>
          {members.households !== null ? (
            <div>
              <span>Households</span>
              <strong>{members.households.toLocaleString("en-US")}</strong>
            </div>
          ) : null}
        </div>
        <p className="hero-note">
          Active in LGL, {formatRetrievedAt(community!.retrievedAt)}. New means a first membership record that began this
          year, so someone long-standing who was entered in LGL late can look new.{" "}
          <button type="button" className="hero-more" onClick={() => open("membership")}>
            See Membership
          </button>
        </p>
      </div>

      {recent ? (
        <div className="hero-accounts">
          <div className="account-list">
            <h3>The last 30 days</h3>
            <ul>
              <li>
                <span>New members</span>
                {recent.newMembers ? (
                  <span className="num">
                    <LglLink url={recent.newMembers.url}>{recent.newMembers.count.toLocaleString("en-US")}</LglLink>
                  </span>
                ) : (
                  <span className="num unavailable">Not shown</span>
                )}
              </li>
              <RecentLine label="Dues" activity={recent.dues} noun="payment" />
              <RecentLine label="Gifts" activity={recent.gifts} noun="gift" />
              <RecentLine label="Grant payments" activity={recent.grantPayments} noun="payment" provisional />
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** What is on its way: renewals, and what giving usually brings in the coming months. */
function ComingUp({ community, reading }: { community: CommunitySnapshot | null; reading: boolean }) {
  if (reading) {
    return (
      <section className="card card-pad">
        <h2>Coming up</h2>
        <Reading what="renewals and giving from LGL" slow />
      </section>
    );
  }
  if (community?.status !== "ok") {
    return (
      <section className="card card-pad">
        <h2>Coming up</h2>
        <p className="muted">{community?.note ?? "Renewals and giving could not be read from LGL."}</p>
      </section>
    );
  }
  const soon = community.renewals?.soon ?? null;
  const quarter = community.nextQuarter;
  const span = quarter ? `${monthAbbrev(quarter.months[0])} to ${monthAbbrev(quarter.months[2])}` : null;
  const operating = community.operatingGrants;

  return (
    <section className="card card-pad">
      <h2>Coming up</h2>

      {soon ? (
        <>
          <h3 className="card-subhead">
            <span>Memberships ending in the next 90 days</span>
            <strong className="num">
              <LglLink url={soon.url}>{soon.total.toLocaleString("en-US")}</LglLink>
            </strong>
          </h3>
          <ul className="line-list">
            <li>
              <span>On auto-renew</span>
              <span className="num">
                <LglLink url={soon.autoRenewUrl}>{soon.autoRenew.toLocaleString("en-US")}</LglLink>
              </span>
            </li>
            <li>
              <span>Renew by hand</span>
              <span className="num">
                <LglLink url={soon.manualUrl}>{soon.manual.toLocaleString("en-US")}</LglLink>
              </span>
            </li>
            {soon.noDues > 0 ? (
              <li>
                <span>No dues on record, so how they renew is unknown</span>
                <span className="num">{soon.noDues.toLocaleString("en-US")}</span>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}

      {quarter ? (
        <>
          <h3 className="card-subhead card-subhead-next">
            <span>Expected from giving, {span}</span>
            <span className="tag">Projection</span>
          </h3>
          <ul className="line-list">
            {quarter.items.map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <span className="num">
                  <LglLink url={item.url}>{usd.format(item.amount)}</LglLink>
                </span>
              </li>
            ))}
            {operating && operating.remaining > 0 ? (
              <li>
                <span>
                  Operating grants awarded, not yet received
                  <small>
                    {plural(operating.awards.length, "award")}; timing set by each funder. Provisional, and not part of
                    the projection.
                  </small>
                </span>
                <span className="num">
                  <LglLink url={operating.remainingUrl}>{usd.format(operating.remaining)}</LglLink>
                </span>
              </li>
            ) : null}
          </ul>
          <p className="note">Giving lines are what the same months brought a year earlier, not a forecast of this year.</p>
        </>
      ) : null}
    </section>
  );
}

const bookBalanceNote = (funds: FundsSnapshot) =>
  `${funds.environment === "sandbox" ? "Test company, not HPIC's books. " : ""}${funds.connection === "fixture" ? "Fixture data. " : ""}QuickBooks book balances, ${formatRetrievedAt(funds.retrievedAt)}.`;

/** The day-to-day organization: how the year is going and what it has to run on. */
function DayToDay({
  funds,
  operations,
  pending,
  open,
}: {
  funds: FundsSnapshot | null;
  operations: OperationsSnapshot | null;
  pending: Pending;
  open: (tab: Tab) => void;
}) {
  const net = operations?.status === "ok" ? operations.totals?.net ?? null : null;
  const through = operations?.period ? monthAbbrev(operations.period.through.slice(0, 7)) : null;
  const cash = operations ? monthsOfCash(funds, operations) : null;
  const programming = funds?.subtotals?.find((s) => s.purpose === "programming");
  const { named, small, smallTotal } = namedAndSmall(
    (funds?.accounts ?? []).filter((a) => a.purpose === "programming"),
    funds?.totalCash ?? null,
  );

  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Day-to-day money</h2>
        <button type="button" className="link-button" onClick={() => open("operations")}>
          Operations
        </button>
      </div>

      <ul className="line-list">
        <li>
          <span>
            Net operating income{through ? `, to ${through}` : ""}
            <small>
              {pending.operations
                ? "Reading from QuickBooks…"
                : net
                  ? net.budgetToDate !== null
                    ? `Budget for the same months: ${usd.format(net.budgetToDate)}`
                    : "No monthly budget to compare with yet"
                  : operations?.status === "not_configured"
                    ? "Account groups not set up yet"
                    : "Could not be read"}
            </small>
          </span>
          {pending.operations ? (
            <span className="num muted">Reading…</span>
          ) : net ? (
            <span className="num">
              <QboLink url={net.url}>{usd.format(net.actual)}</QboLink>
            </span>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
        <li>
          <span>
            Months of operating cash
            <small>
              {pending.operations || pending.funds
                ? "Reading from QuickBooks…"
                : cash?.value
                  ? "Programming cash at the last twelve months' rate of spending"
                  : "Needs this year's figures"}
            </small>
          </span>
          {pending.operations || pending.funds ? (
            <span className="num muted">Reading…</span>
          ) : cash?.value ? (
            <span className="num">{cash.value}</span>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
      </ul>

      {pending.funds ? (
        <Reading what="balances from QuickBooks" />
      ) : funds ? (
        <>
          <h3 className="card-subhead card-subhead-next">
            <span>Programming cash</span>
            {programming?.total != null ? (
              <strong className="num">{usd.format(programming.total)}</strong>
            ) : (
              <strong className="num unavailable">Not shown</strong>
            )}
          </h3>
          <div className="account-list">
            <ul>
              {named.map((a) => (
                <li key={a.key}>
                  <span>
                    <QboLink url={a.url}>{a.label}</QboLink>
                  </span>
                  <span className={a.status === "ok" ? "num" : "num unavailable"}>
                    {a.status === "ok" ? <QboLink url={a.url}>{usd.format(a.balance ?? 0)}</QboLink> : "Unavailable"}
                  </span>
                </li>
              ))}
              {small.length > 0 ? (
                <li>
                  <details className="small-balances">
                    <summary>
                      <span>Smaller balances</span>
                      <span className="num">{usd.format(smallTotal)}</span>
                    </summary>
                    <ul>
                      {small.map((a) => (
                        <li key={a.key}>
                          <span>
                            <QboLink url={a.url}>{a.label}</QboLink>
                          </span>
                          <span className="num">
                            <QboLink url={a.url}>{usd.format(a.balance ?? 0)}</QboLink>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ) : null}
            </ul>
          </div>
          {programming?.total == null && programming?.note ? <p className="note">{programming.note}</p> : null}
          <p className="note">{bookBalanceNote(funds)}</p>
        </>
      ) : (
        <p className="muted">Balances could not be read from QuickBooks.</p>
      )}
    </section>
  );
}

/**
 * The rebuild as plain facts: what funders have awarded, what has arrived, what is in
 * the rebuild accounts. Awards and cash are separate lines and are never added
 * together. How far this goes toward the next phase is on the Rebuild tab.
 */
function RebuildFacts({
  funds,
  grants,
  pending,
  open,
}: {
  funds: FundsSnapshot | null;
  grants: GrantSnapshot | null;
  pending: Pending;
  open: (tab: Tab) => void;
}) {
  const stage = (key: "pledged" | "received") => grants?.stages.find((s) => s.key === key);
  const pledged = stage("pledged");
  const received = stage("received");
  const cash = funds?.subtotals?.find((s) => s.purpose === "rebuild");

  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>The rebuild</h2>
        <button type="button" className="link-button" onClick={() => open("rebuild")}>
          Funding and estimate
        </button>
      </div>
      <ul className="line-list">
        <li>
          <span>
            Awarded by funders
            {pledged?.recordCount != null ? <small>{plural(pledged.recordCount, "award")}</small> : null}
          </span>
          {pending.grants ? (
            <span className="num muted">Reading…</span>
          ) : pledged?.amount != null ? (
            <span className="num">
              <LglLink url={pledged.figureUrl}>{usd.format(pledged.amount)}</LglLink>
            </span>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
        <li>
          <span>
            Received so far
            {received?.status === "provisional" ? <small>Provisional, from LGL payment records</small> : null}
          </span>
          {pending.grants ? (
            <span className="num muted">Reading…</span>
          ) : received?.amount != null ? (
            <span className="num">
              <LglLink url={received.figureUrl}>{usd.format(received.amount)}</LglLink>
            </span>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
        <li>
          <span>
            In the rebuild accounts
            {funds ? <small>{bookBalanceNote(funds)}</small> : null}
          </span>
          {pending.funds ? (
            <span className="num muted">Reading…</span>
          ) : cash?.total != null ? (
            <span className="num">{usd.format(cash.total)}</span>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
      </ul>
      <p className="note">Reimbursable awards pay only after HPIC spends and invoices, so they are not money in hand.</p>
    </section>
  );
}

/** Whether LGL and QuickBooks agree, and how many records break a rule. No names. */
function BooksAgree({
  reconciliation,
  grants,
  pending,
  open,
}: {
  reconciliation: ReconciliationSnapshot | null;
  grants: GrantSnapshot | null;
  pending: Pending;
  open: (tab: Tab) => void;
}) {
  const needing = recordsNeedingAttention(grants);
  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Do the books agree?</h2>
        <button type="button" className="link-button" onClick={() => open("reconciliation")}>
          Reconciliation
        </button>
      </div>

      {pending.reconciliation ? (
        <Reading what="LGL against QuickBooks" />
      ) : reconciliation?.status === "ok" && reconciliation.period ? (
        <>
          <p className="muted small">LGL against QuickBooks, to {monthAbbrev(reconciliation.period.through.slice(0, 7))}</p>
          <ul className="line-list">
            {reconciliation.rows.map((row) => (
              <li key={row.key}>
                <span>{row.label}</span>
                {row.status === "match" ? (
                  <span className="num">Match</span>
                ) : row.status === "differs" ? (
                  <strong className="num">Differ by {usd.format(Math.abs(row.difference!))}</strong>
                ) : (
                  <span className="num unavailable">Not compared</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{reconciliation?.note ?? "LGL and QuickBooks could not be compared."}</p>
      )}

      {pending.grants ? null : recordsChecked(grants) ? (
        <p className="note">
          {needing > 0
            ? `${plural(needing, "LGL grant record")} ${needing === 1 ? "needs" : "need"} attention.`
            : "Every LGL grant record read passes every rule."}
        </p>
      ) : (
        <p className="note">LGL's grant records could not be checked.</p>
      )}
    </section>
  );
}

export function OverviewView({
  funds,
  grants,
  operations,
  community,
  reconciliation,
  pending,
  open,
}: {
  funds: FundsSnapshot | null;
  grants: GrantSnapshot | null;
  operations: OperationsSnapshot | null;
  community: CommunitySnapshot | null;
  reconciliation: ReconciliationSnapshot | null;
  pending: Pending;
  open: (tab: Tab) => void;
}) {
  return (
    <div className="stack">
      <ClubToday community={community} reading={pending.community} open={open} />
      <div className="grid-2">
        <ComingUp community={community} reading={pending.community} />
        <DayToDay funds={funds} operations={operations} pending={pending} open={open} />
      </div>
      <div className="grid-2">
        <RebuildFacts funds={funds} grants={grants} pending={pending} open={open} />
        <BooksAgree reconciliation={reconciliation} grants={grants} pending={pending} open={open} />
      </div>
    </div>
  );
}
