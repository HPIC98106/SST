/**
 * The board's landing page: the page to put on the screen at a meeting.
 *
 * It leads with money available now, then how the year is going, what the
 * next three months usually bring, and how far the rebuild is funded. No to-do
 * lists and no names: the records that need fixing live on Housekeeping. But
 * "safe to show" never means hiding a problem: a figure that cannot be read
 * still says so here, in place.
 */

import type { ReactNode } from "react";
import { FundingBar } from "./FundingBar";
import { formatRetrievedAt, monthAbbrev, signed, usd, usd0 } from "./format";
import { monthsOfCash } from "./YearSoFar";
import type { CommunitySnapshot, FundsSnapshot, GrantSnapshot, OperationsSnapshot } from "./types";

export type Tab = "overview" | "rebuild" | "operations" | "community" | "grants" | "housekeeping";

/** One headline figure. `tone` marks a figure that is not a plain record. */
export function Kpi({
  label,
  value,
  detail,
  tone,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "projection" | "provisional" | "unavailable";
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={tone === "unavailable" ? "kpi-value unavailable" : "kpi-value"}>{value}</span>
      {detail ? <span className="kpi-detail">{detail}</span> : null}
      {tone === "projection" ? <span className="tag">Projection</span> : null}
      {tone === "provisional" ? <span className="tag tag-warn">Provisional</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className={`kpi kpi-link${tone ? ` kpi-${tone}` : ""}`} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className={`kpi${tone ? ` kpi-${tone}` : ""}`}>{body}</div>
  );
}

function Hero({ funds }: { funds: FundsSnapshot | null }) {
  if (!funds) {
    return (
      <section className="hero">
        <span className="kpi-label">Money available now</span>
        <p className="hero-value unavailable">Could not be loaded</p>
      </section>
    );
  }
  const groups = funds.subtotals ?? [];
  return (
    <section className="hero">
      <div className="hero-main">
        <span className="hero-label">Money available now</span>
        <p className={funds.totalCash === null ? "hero-value unavailable" : "hero-value"}>
          {funds.totalCash === null ? "Not shown" : usd.format(funds.totalCash)}
        </p>
        {funds.totalCash === null && funds.totalCashNote ? <p className="hero-note">{funds.totalCashNote}</p> : null}
        <div className="hero-split">
          {groups.map((g) => (
            <div key={g.purpose}>
              <span>{g.label}</span>
              <strong>{g.total === null ? "Not shown" : usd.format(g.total)}</strong>
            </div>
          ))}
        </div>
        <p className="hero-note">
          {funds.environment === "sandbox" ? "Test company, not HPIC's books. " : ""}
          {funds.connection === "fixture" ? "Fixture data. " : ""}
          QuickBooks book balances, {formatRetrievedAt(funds.retrievedAt)}.
        </p>
      </div>

      <div className="hero-accounts">
        {groups.map((g) => (
          <div key={g.purpose} className="account-list">
            <h3>{g.label}</h3>
            <ul>
              {funds.accounts
                .filter((a) => a.purpose === g.purpose)
                .map((a) => (
                  <li key={a.key}>
                    <span>{a.label}</span>
                    <span className={a.status === "ok" ? "num" : "num unavailable"}>
                      {a.status === "ok" ? usd.format(a.balance ?? 0) : "Unavailable"}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function NextQuarter({
  community,
  grants,
}: {
  community: CommunitySnapshot | null;
  grants: GrantSnapshot | null;
}) {
  const quarter = community?.status === "ok" ? community.nextQuarter : null;
  const span = quarter
    ? `${monthAbbrev(quarter.months[0])} to ${monthAbbrev(quarter.months[2])}`
    : "the next three months";
  const giving = quarter ? quarter.items.reduce((s, i) => s + i.amount, 0) : null;
  const operating = community?.status === "ok" ? community.operatingGrants : null;
  const rebuild = grants?.awardsByReimbursable.find((b) => b.status === "reimbursable")?.remaining ?? null;

  return (
    <section className="card card-pad">
      <div className="card-head">
        <h2>Expected, {span}</h2>
        <span className="tag">Projection</span>
      </div>
      {quarter ? (
        <>
          <p className="big-figure">{usd0.format(giving!)}</p>
          <p className="muted small">From giving, if this season goes the way the same months did last year.</p>
          <ul className="line-list">
            {quarter.items.map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <span className="num">{usd0.format(item.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{community?.note ?? "Giving history could not be read from LGL."}</p>
      )}

      <ul className="line-list line-list-secondary">
        {operating && operating.remaining > 0 ? (
          <li>
            <span>
              Operating grants awarded, not yet received
              <small>
                {operating.awards.length} award{operating.awards.length === 1 ? "" : "s"}; timing set by each funder.
                Provisional.
              </small>
            </span>
            <span className="num">{usd0.format(operating.remaining)}</span>
          </li>
        ) : null}
        {rebuild !== null ? (
          <li>
            <span>
              Rebuild grants
              <small>
                {usd0.format(rebuild)} awarded, but it arrives only after HPIC spends and invoices, so nothing is
                expected until construction starts.
              </small>
            </span>
            <span className="num">$0</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function OverviewView({
  funds,
  grants,
  operations,
  community,
  open,
}: {
  funds: FundsSnapshot | null;
  grants: GrantSnapshot | null;
  operations: OperationsSnapshot | null;
  community: CommunitySnapshot | null;
  open: (tab: Tab) => void;
}) {
  const net = operations?.status === "ok" ? operations.totals?.net ?? null : null;
  const through = operations?.period ? monthAbbrev(operations.period.through.slice(0, 7)) : null;
  const cash = operations ? monthsOfCash(funds, operations) : null;
  const members = community?.status === "ok" ? community.members : null;
  const supporters = community?.status === "ok" ? community.supporters : null;

  return (
    <div className="stack">
      <Hero funds={funds} />

      <div className="kpis">
        <Kpi
          label={through ? `Net this year, to ${through}` : "Net this year"}
          value={net ? usd0.format(net.actual) : "Not shown"}
          tone={net ? undefined : "unavailable"}
          detail={
            net
              ? net.budgetToDate !== null
                ? `Budget for the same months: ${usd0.format(net.budgetToDate)}`
                : "No monthly budget to compare with yet"
              : operations?.status === "not_configured"
                ? "Account groups not set up yet"
                : "Could not be read"
          }
          onOpen={() => open("operations")}
        />
        <Kpi
          label="Operating cash"
          value={cash?.value ?? "Not shown"}
          tone={cash?.value ? undefined : "unavailable"}
          detail={cash?.value ? "Programming cash at the last year's rate of spending" : "Needs this year's figures"}
          onOpen={() => open("operations")}
        />
        <Kpi
          label={community?.year ? `Members in ${community.year}` : "Members"}
          value={members ? members.thisYear.toLocaleString("en-US") : "Not shown"}
          tone={members ? undefined : "unavailable"}
          detail={members ? `${signed(members.thisYear - members.lastYear)} on last year's ${members.lastYear}` : community?.note}
          onOpen={() => open("community")}
        />
        <Kpi
          label="People giving"
          value={supporters ? supporters.thisYear.toLocaleString("en-US") : "Not shown"}
          tone={supporters ? undefined : "unavailable"}
          detail={supporters ? `${signed(supporters.thisYear - supporters.lastYear)} on last year's ${supporters.lastYear}` : undefined}
          onOpen={() => open("community")}
        />
      </div>

      <div className="grid-2">
        <NextQuarter community={community} grants={grants} />
        <section className="card card-pad">
          <div className="card-head">
            <h2>The rebuild</h2>
            <button type="button" className="link-button" onClick={() => open("rebuild")}>
              Details
            </button>
          </div>
          <FundingBar funds={funds} grants={grants} compact />
        </section>
      </div>
    </div>
  );
}
