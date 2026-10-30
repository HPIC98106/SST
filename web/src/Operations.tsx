/**
 * Operations: the year's income and spending against budget.
 *
 * Built for a board member who is curious rather than expert. A handful of
 * lines, each expandable into the QuickBooks accounts beneath it; every column
 * covers the same completed months; and the budget comparison only appears
 * when the budget was entered month by month, because an even split of a
 * yearly budget would misread every seasonal month.
 *
 * Nothing here is colour-coded good or bad. The board decided against a
 * variance threshold, so the table states the figures and the reader judges.
 */

import { Fragment, useState } from "react";
import { CumulativeChart } from "./CumulativeChart";
import { formatDate, formatRetrievedAt, monthAbbrev, usd } from "./format";
import type { OperationsLine, OperationsSnapshot, PlSide } from "./types";

const money = (n: number | null) => (n === null ? "—" : usd.format(n));

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

function Cells({ line }: { line: OperationsLine }) {
  return (
    <>
      <td className="num">{money(line.actual)}</td>
      <td className="num">{money(line.budgetToDate)}</td>
      <td className="num">{money(line.budgetFullYear)}</td>
      <td className="num ops-projection">{money(line.projectedYearEnd)}</td>
      <td className="num">{money(line.lastYearToDate)}</td>
    </>
  );
}

function Side({
  side,
  snapshot,
  open,
  toggle,
}: {
  side: PlSide;
  snapshot: OperationsSnapshot;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const groups = snapshot.groups.filter((g) => g.side === side);
  const totalLine = side === "income" ? snapshot.totals!.income : snapshot.totals!.spending;
  return (
    <tbody>
      <tr className="ops-side">
        <th scope="rowgroup" colSpan={6}>
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
              <Cells line={g} />
            </tr>
            {expanded
              ? g.accounts.map((a) => (
                  <tr key={a.label} className="ops-account">
                    <th scope="row">{a.label}</th>
                    <Cells line={a} />
                  </tr>
                ))
              : null}
          </Fragment>
        );
      })}
      <tr className="ops-total">
        <th scope="row">Total {side === "income" ? "income" : "spending"}</th>
        <Cells line={totalLine} />
      </tr>
    </tbody>
  );
}

export function OperationsView({ snapshot }: { snapshot: OperationsSnapshot }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { period, totals, monthly } = snapshot;
  const throughMonth = period ? monthAbbrev(period.through.slice(0, 7)) : "";

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

          <table className="breakdown ops-table">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col" className="num">
                  Actual{throughMonth ? `, through ${throughMonth}` : ""}
                </th>
                <th scope="col" className="num">Budget, same months</th>
                <th scope="col" className="num">Full-year budget</th>
                <th scope="col" className="num">Projected year-end</th>
                <th scope="col" className="num">Last year, same months</th>
              </tr>
            </thead>
            <Side side="income" snapshot={snapshot} open={open} toggle={toggle} />
            <Side side="spending" snapshot={snapshot} open={open} toggle={toggle} />
            <tfoot>
              <tr className="ops-net">
                <th scope="row">Net (income less spending)</th>
                <Cells line={totals.net} />
              </tr>
            </tfoot>
          </table>

          <p className="note">
            <strong>Projected year-end</strong> is a projection, not a record: the actual figure so far plus the
            budget for each month still to come. It changes as each month closes.
            {snapshot.budget.name ? ` Budget: "${snapshot.budget.name}" in QuickBooks.` : ""}
          </p>

          {snapshot.excluded ? (
            <p className="note">
              <strong>Kept out of these figures:</strong> {snapshot.excluded.accounts.join(", ")}
              {snapshot.excluded.income !== 0 ? `, ${usd.format(snapshot.excluded.income)} of income` : ""}
              {snapshot.excluded.spending !== 0 ? `, ${usd.format(snapshot.excluded.spending)} of spending` : ""} over
              the same months. Rebuild money is reported on the Overview's cash and readiness panels, not as
              day-to-day income.
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
                        <td className="num">{money(monthly.income.actual[i])}</td>
                        <td className="num">{money(monthly.income.budget?.[i] ?? null)}</td>
                        <td className="num">{money(monthly.income.lastYear?.[i] ?? null)}</td>
                        <td className="num">{money(monthly.spending.actual[i])}</td>
                        <td className="num">{money(monthly.spending.budget?.[i] ?? null)}</td>
                        <td className="num">{money(monthly.spending.lastYear?.[i] ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
