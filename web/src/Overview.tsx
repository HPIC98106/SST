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
 * Revised 2026-11-10, after talking with board members: the headline is members,
 * meaning people, and the rebuild card carries the Rebuild tab's own figures
 * (estimate, still to raise, share covered) so the two pages cannot disagree. It
 * still does not lead with the gap. Each card keeps one visible sentence at most;
 * the rest is under "How this is calculated".
 *
 * No to-do lists and no names: the records that need fixing live on Reconciliation.
 * But "safe to show" never means hiding a problem: a figure that cannot be read
 * still says so here, in place, and whether the two systems agree is always on the
 * page.
 */

import type { ReactNode } from "react";
import { How, SourceLine } from "./Disclosure";
import { monthAbbrev, usd } from "./format";
import { fundingFigures } from "./FundingBar";
import { LglLink, QboLink } from "./LglLink";
import { NO_DUES_ANCHOR, recordsChecked, recordsNeedingAttention } from "./Reconciliation";
import { monthsOfCash } from "./YearSoFar";
import type {
  AccountSnapshot,
  CommunitySnapshot,
  FundsSnapshot,
  GrantDetailsSnapshot,
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
  grantDetails: boolean;
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
        {provisional && activity ? <span className="tag tag-warn">Provisional</span> : null}
        {activity ? <small>{plural(activity.count, noun)}</small> : null}
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
        {/*
          Members lead, and they are people (2026-11-10): that is what the board
          counts. Dues-paying memberships are a finance figure and live on the
          Membership tab, never beside this as a second headline.
        */}
        <p className="hero-value">
          <LglLink url={members.url}>{members.total.toLocaleString("en-US")}</LglLink>
          <span className="hero-unit"> members</span>
        </p>
        <div className="hero-split">
          <div>
            <span>New members in {community!.year}</span>
            <strong>
              {members.newThisYear === null ? "Not shown" : <LglLink url={members.newUrl}>{members.newThisYear.toLocaleString("en-US")}</LglLink>}
            </strong>
          </div>
        </div>
        <p className="hero-note">
          People with an active membership in LGL, including minors.{" "}
          <button type="button" className="hero-more" onClick={() => open("membership")}>
            See Membership
          </button>
        </p>
        <How>
          <p>
            A member is a person whose membership record in LGL has not expired. It is LGL's own list, not a count of
            dues payments, since one payment can cover a household.
          </p>
          <p>
            New means a first membership record that began this year, so someone long-standing who was entered in LGL
            late can look new.
          </p>
        </How>
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
              <RecentLine label="Program grant payments" activity={recent.programGrantPayments} noun="payment" provisional />
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** What is on its way: renewals, and what giving usually brings in the coming months. */
function ComingUp({
  community,
  grantDetails,
  reading,
  readingGrants,
}: {
  community: CommunitySnapshot | null;
  grantDetails: GrantDetailsSnapshot | null;
  reading: boolean;
  readingGrants: boolean;
}) {
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
  // The Grants tab's own total, so the two pages show the same figure.
  const program = grantDetails?.status === "ok" ? grantDetails.totals.operating : null;

  return (
    <section className="card card-pad">
      <h2>Coming up</h2>

      {soon ? (
        <>
          <h3 className="card-subhead">
            <span>Members up for renewal in the next 90 days</span>
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
              <span>Renewing by hand</span>
              <span className="num">
                <LglLink url={soon.manualUrl}>{soon.manual.toLocaleString("en-US")}</LglLink>
              </span>
            </li>
            <li>
              <span>Renewal method unknown</span>
              <span className="num">
                {soon.noDues > 0 ? (
                  <a className="lgl-link" href={`#${NO_DUES_ANCHOR}`} title="See who they are on the Reconciliation tab">
                    {soon.noDues.toLocaleString("en-US")}
                  </a>
                ) : (
                  "0"
                )}
              </span>
            </li>
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
          </ul>
          <p className="note">Same months last year, not a forecast.</p>
        </>
      ) : null}

      <h3 className="card-subhead card-subhead-next">
        <span>
          Program grants awarded, not yet received <span className="tag tag-warn">Provisional</span>
        </span>
        {readingGrants ? (
          <strong className="num muted">Reading…</strong>
        ) : program?.stillToArrive != null ? (
          <strong className="num">
            <a className="lgl-link" href="#grants" title="See each award on the Grants tab">
              {usd.format(program.stillToArrive)}
            </a>
          </strong>
        ) : (
          <strong className="num unavailable">Not shown</strong>
        )}
      </h3>

      <How>
        <p>
          <strong>Up for renewal</strong> counts members, so a household renewing on one payment counts once per person.
          Auto-renew means their latest dues payment is coded Membership-Recurring in LGL. Method unknown means no dues
          payment is on record for them; they are listed on Reconciliation.
        </p>
        <p>
          <strong>Expected from giving</strong> is what the same three months brought in a year earlier. It is a guide to
          the season, not a pledge or a forecast, and it is never added to cash.
        </p>
        <p>
          <strong>Program grants awarded, not yet received</strong> is each program or operating award less the payments
          LGL links to it, the same figure as Still to come on the Grants tab. When it arrives is up to each funder.
        </p>
      </How>
    </section>
  );
}

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
            Months of operating cash at current spending
            {pending.operations || pending.funds ? (
              <small>Reading from QuickBooks…</small>
            ) : cash?.value ? null : (
              <small>Needs this year's figures</small>
            )}
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
          {funds.environment === "sandbox" || funds.connection === "fixture" ? (
            <p className="banner banner-warn">
              {funds.environment === "sandbox" ? "Test company, not HPIC's books." : "Fixture data, not HPIC's books."}
            </p>
          ) : null}
          <How>
            <p>
              <strong>Net operating income</strong> is income less spending on day-to-day accounts, for the completed
              months of the year, with rebuild money left out.
            </p>
            <p>
              <strong>Months of operating cash</strong> is programming cash divided by average monthly operating spending
              over the last twelve completed months. {cash?.value ? cash.note : ""} Current spending does not include
              running a building, so this will fall once the clubhouse reopens.
            </p>
            <p>
              <strong>Programming cash</strong> is the QuickBooks book balance of the programming accounts: what the books
              show once transactions are entered, not the live bank balance. Rebuild cash is separate, on the Rebuild
              tab.
            </p>
          </How>
        </>
      ) : (
        <p className="muted">Balances could not be read from QuickBooks.</p>
      )}
    </section>
  );
}

/**
 * The rebuild in the Rebuild tab's own three figures, from the same function that
 * tab uses, so the two pages always agree. Awarded money counts toward "covered"
 * but is never called money in hand; what that means is on the Rebuild tab.
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
  const { target, toRaise, covered } = fundingFigures(funds, grants);
  const name = grants?.phaseTarget.name ?? "Next phase";
  const reading = pending.funds || pending.grants;
  const figure = (value: string | null) =>
    reading ? (
      <span className="num muted">Reading…</span>
    ) : value !== null ? (
      <span className="num">{value}</span>
    ) : (
      <span className="num unavailable">Not shown</span>
    );

  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>The rebuild</h2>
        <button type="button" className="link-button" onClick={() => open("rebuild")}>
          Rebuild
        </button>
      </div>
      <ul className="line-list">
        <li>
          <span>{name} estimate</span>
          {figure(target !== null ? usd.format(target) : null)}
        </li>
        <li>
          <span>
            <strong>Still to raise</strong>
          </span>
          {reading ? (
            <span className="num muted">Reading…</span>
          ) : toRaise !== null ? (
            <strong className="num">{usd.format(toRaise)}</strong>
          ) : (
            <span className="num unavailable">Not shown</span>
          )}
        </li>
        <li>
          <span>Share of estimate covered</span>
          {figure(covered !== null ? `${covered}%` : null)}
        </li>
      </ul>
      <How>
        <p>
          <strong>Still to raise</strong> is the estimate, less cash in the rebuild accounts, less rebuild grants awarded
          but not yet received. <strong>Covered</strong> is that cash and those grants as a share of the estimate.
        </p>
        <p>
          The estimate is from Metis and entered by hand. The grants are reimbursable, so they count here but cannot pay
          for work up front. Both points are spelled out on the Rebuild tab.
        </p>
      </How>
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
  grantDetails,
  pending,
  open,
}: {
  funds: FundsSnapshot | null;
  grants: GrantSnapshot | null;
  operations: OperationsSnapshot | null;
  community: CommunitySnapshot | null;
  reconciliation: ReconciliationSnapshot | null;
  grantDetails: GrantDetailsSnapshot | null;
  pending: Pending;
  open: (tab: Tab) => void;
}) {
  return (
    <div className="stack">
      <ClubToday community={community} reading={pending.community} open={open} />
      <div className="grid-2">
        <ComingUp community={community} grantDetails={grantDetails} reading={pending.community} readingGrants={pending.grantDetails} />
        <DayToDay funds={funds} operations={operations} pending={pending} open={open} />
      </div>
      <div className="grid-2">
        <RebuildFacts funds={funds} grants={grants} pending={pending} open={open} />
        <BooksAgree reconciliation={reconciliation} grants={grants} pending={pending} open={open} />
      </div>
      <SourceLine qbo={funds?.retrievedAt ?? null} lgl={community?.retrievedAt ?? null} />
    </div>
  );
}
