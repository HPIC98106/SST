/**
 * The Overview's summary of the year: three numbers a board member can read
 * at a glance, with the detail one click away on the Operations tab.
 *
 * Months of operating cash is computed here rather than in the Worker because
 * it joins two reads: programming cash from the cash panel, and operating
 * spending from Operations. It renders only when both are complete, the same
 * rule every total on this dashboard follows.
 */

import { usd } from "./format";
import { OperationsProblems, periodLabel } from "./Operations";
import type { FundsSnapshot, OperationsSnapshot } from "./types";

export function monthsOfCash(funds: FundsSnapshot | null, operations: OperationsSnapshot) {
  const programming = funds?.subtotals?.find((s) => s.purpose === "programming");
  const cash = programming?.total ?? null;
  const yearly = operations.trailingTwelveMonthSpending;
  if (cash === null) {
    return { value: null, note: programming?.note ?? "Programming cash could not be read." };
  }
  if (yearly === null || yearly <= 0) {
    return { value: null, note: "Needs twelve completed months of spending, and last year's figures could not be read." };
  }
  const monthly = yearly / 12;
  const months = cash / monthly;
  return {
    value: months >= 3 ? `${Math.floor(months)} months` : `${months.toFixed(1)} months`,
    note: `Programming cash of ${usd.format(cash)} against average operating spending of ${usd.format(monthly)} a month over the last twelve completed months.`,
  };
}

export function YearSoFarView({
  operations,
  funds,
  error,
  onOpen,
}: {
  operations: OperationsSnapshot | null;
  funds: FundsSnapshot | null;
  error?: string;
  onOpen?: () => void;
}) {
  if (!operations) {
    return (
      <section className="panel">
        <h1>This year so far</h1>
        <p className="banner banner-error">This panel could not be loaded.{error ? ` ${error}` : ""}</p>
      </section>
    );
  }

  const { period, totals } = operations;
  const net = totals?.net ?? null;
  const cash = monthsOfCash(funds, operations);

  return (
    <section className="panel">
      <h1>This year so far</h1>
      {period ? <p className="muted">{periodLabel(period)} · accrual basis</p> : null}

      <OperationsProblems snapshot={operations} />

      {operations.status === "ok" && net && totals ? (
        <div className="cards">
          <section className="card">
            <h2>Net so far</h2>
            <p className="amount">{usd.format(net.actual)}</p>
            <p className="note">
              {usd.format(totals.income.actual)} income less {usd.format(totals.spending.actual)} spending.{" "}
              {net.budgetToDate !== null
                ? `The budget for the same months was ${usd.format(net.budgetToDate)}.`
                : operations.budget.note ?? "No budget comparison is available."}
            </p>
          </section>

          <section className="card status-projection">
            <h2>Projected year-end</h2>
            {net.projectedYearEnd !== null ? (
              <p className="amount">{usd.format(net.projectedYearEnd)}</p>
            ) : (
              <p className="amount unavailable">Not shown</p>
            )}
            <p className="projection-flag">Projection</p>
            <p className="note">
              {net.projectedYearEnd !== null
                ? `Actual so far plus the budget for the months still to come${
                    net.budgetFullYear !== null ? `, against a full-year budget of ${usd.format(net.budgetFullYear)}` : ""
                  }.`
                : "Needs a QuickBooks budget entered by month."}
            </p>
          </section>

          <section className="card">
            <h2>Months of operating cash</h2>
            {cash.value ? <p className="amount">{cash.value}</p> : <p className="amount unavailable">Not shown</p>}
            <p className="note">{cash.note}</p>
          </section>
        </div>
      ) : null}

      {onOpen ? (
        <button type="button" className="link" onClick={onOpen}>
          See every line on the Operations tab
        </button>
      ) : null}
    </section>
  );
}
