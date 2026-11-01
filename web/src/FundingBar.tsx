/**
 * How much of the next construction phase is funded, as one bar.
 *
 * Three segments, never merged: cash in the rebuild accounts, grant money
 * awarded but not yet received, and what is still to raise. Awarded money is
 * drawn as a lighter step of the same hue because it is real but not in hand:
 * every award is cost-reimbursement, so it arrives only after HPIC spends and
 * invoices. The bar shows funding progress; it never says "available".
 */

import { usd } from "./format";
import { LglLink } from "./LglLink";
import type { FundsSnapshot, GrantSnapshot } from "./types";

export function fundingFigures(funds: FundsSnapshot | null, grants: GrantSnapshot | null) {
  const target = grants?.phaseTarget.targetCost ?? null;
  const cash = funds?.subtotals?.find((s) => s.purpose === "rebuild")?.total ?? null;
  const awarded = grants?.awardsByReimbursable.find((b) => b.status === "reimbursable")?.remaining ?? null;
  const toRaise = target !== null && cash !== null && awarded != null ? Math.max(target - cash - awarded, 0) : null;
  return { target, cash, awarded: awarded ?? null, toRaise };
}

export function FundingBar({ funds, grants }: { funds: FundsSnapshot | null; grants: GrantSnapshot | null }) {
  const { target, cash, awarded, toRaise } = fundingFigures(funds, grants);
  const phase = grants?.phaseTarget;
  const name = phase?.name ?? "the next phase";

  if (target === null) {
    return (
      <div className="funding">
        <p className="funding-head">
          <span>{name}</span>
          <span className="muted">Cost estimate not set</span>
        </p>
        <p className="note">No target is shown until the contractor's figure is entered, rather than a placeholder.</p>
      </div>
    );
  }

  const share = (n: number | null) => (n === null ? 0 : Math.max(0, Math.min(100, (n / target) * 100)));
  const cashPct = share(cash);
  const awardedPct = Math.min(share(awarded), 100 - cashPct);

  const remainingUrl = grants?.awardsByReimbursable.find((b) => b.status === "reimbursable")?.remainingUrl;
  const rows: { key: string; label: string; detail: string; value: number | null; url?: string | null }[] = [
    {
      key: "cash",
      label: "In the bank",
      detail: "Rebuild accounts in QuickBooks",
      value: cash,
    },
    {
      key: "awarded",
      label: "Awarded, not yet received",
      detail: "Reimbursable: paid only after HPIC spends and invoices. Provisional, from LGL.",
      value: awarded,
      url: remainingUrl,
    },
    {
      key: "raise",
      label: "Still to raise",
      detail: "Estimate less both of the above",
      value: toRaise,
    },
  ];

  return (
    <div className="funding">
      <p className="funding-head">
        <span>
          {name} estimate <strong>{usd.format(target)}</strong>
        </span>
        <span className="muted">
          {cash !== null ? `${Math.round(cashPct)}% in the bank` : "Cash unavailable"}
          {awarded !== null ? ` · ${Math.round(awardedPct)}% awarded` : ""}
        </span>
      </p>

      <div
        className="funding-bar"
        role="img"
        aria-label={`${name}: ${Math.round(cashPct)}% of the estimate is in the bank and ${Math.round(awardedPct)}% is awarded but not yet received.`}
      >
        <span className="funding-cash" style={{ width: `${cashPct}%` }} />
        <span className="funding-awarded" style={{ width: `${awardedPct}%` }} />
      </div>

      <ul className="funding-legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span className={`swatch swatch-${r.key}`} aria-hidden="true" />
            <span className="funding-label">
              {r.label}
              <small>{r.detail}</small>
            </span>
            <strong>{r.value === null ? "Unavailable" : <LglLink url={r.url}>{usd.format(r.value)}</LglLink>}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
