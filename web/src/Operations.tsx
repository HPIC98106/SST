/**
 * Operations: the year's income and spending against budget.
 *
 * Built for a board member who is curious rather than expert. A handful of
 * lines, each expandable into the QuickBooks accounts beneath it; every column
 * covers the same completed months; and the budget comparison only appears
 * when the budget was entered month by month, because an even split of a
 * yearly budget would misread every seasonal month.
 *
 * The table answers one question at a time, chosen by a switch: how the year so
 * far compares with its budget, how the full year looks, or how it compares with
 * last year. Five columns at once was too much to follow, and three fit a phone.
 *
 * Each difference says over or under in words, and is coloured by whether that is
 * good: income over budget is good, spending over budget is not. There is no
 * threshold (decided 2026-10-30), so even a small difference gets its colour, and
 * the words mean nothing depends on telling the colours apart.
 */

import { Fragment, useState } from "react";
import { CumulativeChart } from "./CumulativeChart";
import { formatDate, formatRetrievedAt, monthAbbrev, usd } from "./format";
import { QboLink } from "./LglLink";
import type { OperationsLine, OperationsSnapshot, PlSide } from "./types";

const money = (n: number | null) => (n === null ? "—" : usd.format(n));

/** Which question the table is answering. */
type Lens = "soFar" | "fullYear" | "lastYear";

const LENSES: { key: Lens; label: string }[] = [
  { key: "soFar", label: "So far vs. budget" },
  { key: "fullYear", label: "Full year" },
  { key: "lastYear", label: "vs. last year" },
];

/** The net row counts as income: more of it is better. */
type Direction = PlSide | "net";

/**
 * "$9,655 over · 172%". The difference is taken from the exact figures, and one
 * that rounds to nothing reads as level rather than wearing a colour. The percent
 * is left off when there is nothing to take a percentage of.
 */
function Difference({
  value,
  against,
  direction,
  words,
}: {
  value: number | null;
  against: number | null;
  direction: Direction;
  words: [more: string, less: string];
}) {
  if (value === null || against === null) return <td className="num">—</td>;
  const difference = value - against;
  if (Math.round(difference) === 0) return <td className="num diff-level">Level</td>;
  const more = difference > 0;
  const good = direction === "spending" ? !more : more;
  const percent = against !== 0 ? Math.round((Math.abs(difference) / Math.abs(against)) * 100) : null;
  return (
    <td className={`num ${good ? "diff-good" : "diff-bad"}`}>
      {usd.format(Math.abs(difference))} {more ? words[0] : words[1]}
      {percent !== null ? (
        <span className="diff-percent">
          <span className="diff-dot"> · </span>
          {percent}%
        </span>
      ) : null}
      <span className="sr-only">{good ? ", favorable" : ", unfavorable"}</span>
    </td>
  );
}

function Cells({ line, lens, direction }: { line: OperationsLine; lens: Lens; direction: Direction }) {
  if (lens === "fullYear") {
    return (
      <>
        <td className="num">{money(line.budgetFullYear)}</td>
        <td className="num ops-projection">{money(line.projectedYearEnd)}</td>
        <Difference value={line.projectedYearEnd} against={line.budgetFullYear} direction={direction} words={["over", "under"]} />
      </>
    );
  }
  if (lens === "lastYear") {
    return (
      <>
        <td className="num">
          <QboLink url={line.url}>{money(line.actual)}</QboLink>
        </td>
        <td className="num">
          <QboLink url={line.lastYearUrl}>{money(line.lastYearToDate)}</QboLink>
        </td>
        <Difference value={line.actual} against={line.lastYearToDate} direction={direction} words={["up", "down"]} />
      </>
    );
  }
  return (
    <>
      <td className="num">
        <QboLink url={line.url}>{money(line.actual)}</QboLink>
      </td>
      <td className="num">{money(line.budgetToDate)}</td>
      <Difference value={line.actual} against={line.budgetToDate} direction={direction} words={["over", "under"]} />
    </>
  );
}

export function periodLabel(period: NonNullable<OperationsSnapshot["period"]>): string {
  return period.showingPriorYear
    ? `The fiscal year ${formatDate(period.fiscalYearStart)} to ${formatDate(period.fiscalYearEnd)}, in full`
    : `${formatDate(period.fiscalYearStart)} to ${formatDate(period.through)}`;
}

/** Banners for a snapshot with no figures, shared with the Overview. */
export function OperationsProblems({ snapshot }: { snapshot: OperationsSnapshot }) {
  return (
    <>
      {snapshot.connection === "fixture" ? (
        <p className="banner banner-warn">
          Showing <strong>fixture data</strong>, not real QuickBooks figures.
        </p>
      ) : null}
      {snapshot.environment === "sandbox" && snapshot.connection !== "fixture" ? (
        <p className="banner banner-error">
          <strong>Test company, not HPIC's books.</strong> These figures come from Intuit's sandbox company.
        </p>
      ) : null}
      {snapshot.status !== "ok" && snapshot.note ? (
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>{snapshot.note}</p>
      ) : null}
      {snapshot.invalidConfig.length > 0 ? (
        <ul className="banner banner-error ops-list">
          {snapshot.invalidConfig.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Side({
  side,
  snapshot,
  open,
  toggle,
  lens,
}: {
  side: PlSide;
  snapshot: OperationsSnapshot;
  open: Set<string>;
  toggle: (key: string) => void;
  lens: Lens;
}) {
  const groups = snapshot.groups.filter((g) => g.side === side);
  const totalLine = side === "income" ? snapshot.totals!.income : snapshot.totals!.spending;
  return (
    <tbody>
      <tr className="ops-side">
        <th scope="rowgroup" colSpan={4}>
          {side === "income" ? "Income" : "Spending"}
        </th>
      </tr>
      {groups.map((g) => {
        const key = `${side}:${g.label}`;
        const expanded = open.has(key);
        return (
          <Fragment key={key}>
            <tr className="ops-group">
              <th scope="row">
                {g.accounts.length > 0 ? (
                  <button type="button" className="ops-toggle" aria-expanded={expanded} onClick={() => toggle(key)}>
                    <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {g.label}
                  </button>
                ) : (
                  <span className="ops-toggle-spacer">{g.label}</span>
                )}
              </th>
              <Cells line={g} lens={lens} direction={side} />
            </tr>
            {expanded
              ? g.accounts.map((a) => (
                  <tr key={a.label} className="ops-account">
                    <th scope="row">{a.label}</th>
                    <Cells line={a} lens={lens} direction={side} />
                  </tr>
                ))
              : null}
          </Fragment>
        );
      })}
      <tr className="ops-total">
        <th scope="row">Total {side === "income" ? "income" : "spending"}</th>
        <Cells line={totalLine} lens={lens} direction={side} />
      </tr>
    </tbody>
  );
}

export function OperationsView({ snapshot }: { snapshot: OperationsSnapshot }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [lens, setLens] = useState<Lens>("soFar");
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { period, totals, monthly } = snapshot;
  const throughMonth = period ? monthAbbrev(period.through.slice(0, 7)) : "";
  const through = throughMonth ? `, through ${throughMonth}` : "";
  const headings: Record<Lens, [string, string, string]> = {
    soFar: [`Actual${through}`, `Budget${through}`, "Over or under budget"],
    fullYear: ["Full-year budget", "Projected year-end", "Projected over or under budget"],
    lastYear: [`Actual${through}`, "Last year, same months", "Up or down on last year"],
  };
  const even = snapshot.budget.evenLines;
  // An evenly split line or two is not what the comparison turns on; a quarter of them is.
  const manyEven = even !== undefined && even.even * 4 >= even.total;

  return (
    <section className="panel">
      <h1>Income and spending</h1>
      {period ? (
        <p className="muted">
          {periodLabel(period)} · accrual basis
          {period.showingPriorYear
            ? ". The first month of the new fiscal year has not closed yet, so last year is shown in full."
            : ". Every column covers the same completed months; the month in progress is left out until it closes."}
        </p>
      ) : null}

      <OperationsProblems snapshot={snapshot} />

      {snapshot.status === "ok" && totals ? (
        <>
          {snapshot.budget.status !== "ok" && snapshot.budget.note ? (
            <p className="banner banner-warn">{snapshot.budget.note}</p>
          ) : null}
          {snapshot.lastYear.status !== "ok" && snapshot.lastYear.note ? (
            <p className="banner banner-warn">{snapshot.lastYear.note}</p>
          ) : null}

          <div className="lens" role="group" aria-label="Compare the figures with">
            {LENSES.map((l) => (
              <button key={l.key} type="button" className="lens-option" aria-pressed={lens === l.key} onClick={() => setLens(l.key)}>
                {l.label}
              </button>
            ))}
          </div>

          <div className="table-scroll">
            <table className="breakdown ops-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  {headings[lens].map((heading) => (
                    <th key={heading} scope="col" className="num">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <Side side="income" snapshot={snapshot} open={open} toggle={toggle} lens={lens} />
              <Side side="spending" snapshot={snapshot} open={open} toggle={toggle} lens={lens} />
              <tfoot>
                <tr className="ops-net">
                  <th scope="row">Net operating income</th>
                  <Cells line={totals.net} lens={lens} direction="net" />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="note">
            Green is favorable and red is not: income over or spending under, and the reverse. Net operating income is
            income less spending on day-to-day accounts, with rebuild money left out.
            {snapshot.budget.name ? (
              <>
                {" "}
                Budget: <QboLink url={snapshot.budget.url}>"{snapshot.budget.name}"</QboLink> in QuickBooks.
              </>
            ) : null}
          </p>

          {lens === "fullYear" ? (
            <p className="note">
              <strong>Projected year-end</strong> is a projection, not a record: the actual figure so far plus the
              budget for each month still to come. It changes as each month closes.
            </p>
          ) : null}

          {lens !== "lastYear" && manyEven ? (
            <p className="note">
              <strong>Read the budget comparison with care.</strong> {even.even} of {even.total} budget lines were
              entered as the same amount every month, and much of HPIC's money is seasonal. A line such as dues can look
              far over budget partway through the year for that reason alone, and the projection may miss money that
              arrives late, such as the December drive.
            </p>
          ) : null}

          {snapshot.excluded ? (
            <p className="note">
              <strong>Kept out of these figures:</strong> {snapshot.excluded.accounts.join(", ")}
              {snapshot.excluded.income !== 0 ? (
                <>
                  , <QboLink url={snapshot.excluded.url}>{usd.format(snapshot.excluded.income)}</QboLink> of income
                </>
              ) : null}
              {snapshot.excluded.spending !== 0 ? (
                <>
                  , <QboLink url={snapshot.excluded.url}>{usd.format(snapshot.excluded.spending)}</QboLink> of spending
                </>
              ) : null}{" "}
              over the same months. Rebuild money is reported on the Overview and Rebuild tabs, not as day-to-day income.
            </p>
          ) : null}

          {monthly ? (
            <>
              <div className="charts">
                {(["income", "spending"] as const).map((side) => (
                  <CumulativeChart
                    key={side}
                    title={side === "income" ? "Income, cumulative" : "Spending, cumulative"}
                    months={monthly.months}
                    series={[
                      { key: "actual", label: "Actual", values: monthly[side].actual, className: "series-actual" },
                      { key: "budget", label: "Budget", values: monthly[side].budget, className: "series-budget", dashed: true },
                      { key: "last", label: "Last year", values: monthly[side].lastYear, className: "series-last" },
                    ]}
                  />
                ))}
              </div>

              <details className="ops-monthly">
                <summary>Month by month</summary>
                <div className="table-scroll">
                  <table className="breakdown">
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col" className="num">Income</th>
                        <th scope="col" className="num">Budget</th>
                        <th scope="col" className="num">Last year</th>
                        <th scope="col" className="num">Spending</th>
                        <th scope="col" className="num">Budget</th>
                        <th scope="col" className="num">Last year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.months.map((m, i) => (
                        <tr key={m}>
                          <th scope="row">{monthAbbrev(m)}</th>
                          <td className="num">
                            <QboLink url={monthly.urls?.[i]}>{money(monthly.income.actual[i])}</QboLink>
                          </td>
                          <td className="num">{money(monthly.income.budget?.[i] ?? null)}</td>
                          <td className="num">{money(monthly.income.lastYear?.[i] ?? null)}</td>
                          <td className="num">
                            <QboLink url={monthly.urls?.[i]}>{money(monthly.spending.actual[i])}</QboLink>
                          </td>
                          <td className="num">{money(monthly.spending.budget?.[i] ?? null)}</td>
                          <td className="num">{money(monthly.spending.lastYear?.[i] ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : null}
        </>
      ) : null}

      {snapshot.ungrouped.length > 0 ? (
        <section className="subpanel">
          <h2>Accounts not yet grouped</h2>
          <ul className="ops-list">
            {snapshot.ungrouped.map((u) => (
              <li key={`${u.id}:${u.name}`}>
                {u.name} {u.id ? <code>{u.id}</code> : null} ({u.side})
              </li>
            ))}
          </ul>
          <p className="note">Add each to a group, or to <code>exclude</code>, in QBO_PL_GROUPS on the Worker.</p>
        </section>
      ) : null}

      <div className="panel-footer">
        <p>
          <strong>Source:</strong> {snapshot.source}.
        </p>
        <p>
          <strong>Data retrieved from QuickBooks:</strong> {formatRetrievedAt(snapshot.retrievedAt)}
          {snapshot.cached ? " (served from a cached read, refreshed at least every 15 minutes)" : ""}
        </p>
      </div>
    </section>
  );
}
