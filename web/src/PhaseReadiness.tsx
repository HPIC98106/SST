/**
 * Can HPIC afford the next construction phase?
 *
 * This is the question the whole dashboard exists to answer, and the one where
 * being wrong costs real money. Three rules shape everything below.
 *
 * **Cash and awards are never added together.** A cost-reimbursement award
 * requires HPIC to spend first and invoice afterwards, so it does not reduce
 * the working capital needed to begin a phase. Two of the largest awards,
 * $888,000 combined, are exactly that. A single "available" figure that
 * included them would tell the board HPIC is $888,000 more ready than it is,
 * which is the specific failure this tool was built to prevent.
 *
 * **Unknown terms are not counted as either.** Until an award's Payment Terms
 * are set in LGL, nothing here can say whether it is spendable, so it sits in
 * its own row and is excluded from the gap.
 *
 * **The target cost is the one number on this dashboard that is not read from
 * a system.** It comes from the general contractor by email. So it is rendered
 * with its provenance printed beside it, and when it is absent the panel says
 * so rather than substituting a placeholder.
 */

import { usd } from "./format";
import type { FundsSnapshot, GrantSnapshot, ReimbursableStatus } from "./types";

/** One line of the readiness arithmetic. */
function Row({
  label,
  amount,
  detail,
  tone,
}: {
  label: string;
  amount: string;
  detail: string;
  tone?: "available" | "excluded" | "unknown" | "target";
}) {
  return (
    <tr className={tone ? `pr-${tone}` : undefined}>
      <th scope="row">{label}</th>
      <td className="num">{amount}</td>
      <td className="pr-detail">{detail}</td>
    </tr>
  );
}

function bucket(grants: GrantSnapshot, status: ReimbursableStatus) {
  return grants.awardsByReimbursable.find((b) => b.status === status);
}

export function PhaseReadinessView({
  funds,
  grants,
}: {
  funds: FundsSnapshot | null;
  grants: GrantSnapshot | null;
}) {
  const phase = grants?.phaseTarget;
  const phaseName = phase?.name ?? "the next phase";

  // Cash restricted to the rebuild. The operating account is deliberately not
  // counted: it is unrestricted, which means it is what pays for programming.
  const rebuild = funds?.accounts.find((a) => a.key === "rebuild_fund");
  const availableCash = rebuild?.status === "ok" ? rebuild.balance : null;

  const reimbursable = grants ? bucket(grants, "reimbursable") : undefined;
  const unknown = grants ? bucket(grants, "unknown") : undefined;

  const targetCost = phase?.targetCost ?? null;
  const gap = availableCash !== null && targetCost !== null ? targetCost - availableCash : null;

  return (
    <section className="panel panel-readiness">
      <h1>Can we afford {phaseName}?</h1>

      <p className="note">
        The figures below are shown separately and never added together. A
        cost-reimbursement award requires HPIC to spend first and invoice the funder
        afterwards, so it is not money available to start work.
      </p>

      <table className="breakdown pr-table">
        <tbody>
          <Row
            label="Cash available now"
            amount={
              availableCash === null
                ? rebuild
                  ? "Unavailable"
                  : "Not configured"
                : usd.format(availableCash)
            }
            detail={
              availableCash === null
                ? "The rebuild account could not be read, so no figure here is current."
                : "The rebuild account only. Operating cash is unrestricted and is what pays for programming, so it is not counted here."
            }
            tone="available"
          />

          <Row
            label="Awarded, reimbursable"
            amount={reimbursable ? usd.format(reimbursable.amount) : "Unavailable"}
            detail={
              !reimbursable
                ? "The grant funnel could not be read, so no figure here is current."
                : reimbursable.recordCount > 0
                  ? `${reimbursable.recordCount} award(s). Real money, but HPIC must spend it before the funder pays, so it cannot fund the start of a phase.`
                  : "No award is yet marked reimbursable. That is not the same as none being reimbursable: see the row below."
            }
            tone="excluded"
          />

          {unknown && unknown.recordCount > 0 ? (
            <Row
              label="Awarded, terms unknown"
              amount={usd.format(unknown.amount)}
              detail={`${unknown.recordCount} award(s) with no Payment Terms set in LGL. Until they are set, nothing can say whether this money is spendable, so it counts as neither. This is the single largest thing standing between this panel and a real answer.`}
              tone="unknown"
            />
          ) : null}

          <Row
            label={`Estimated cost of ${phaseName}`}
            amount={targetCost === null ? "Not yet received" : usd.format(targetCost)}
            detail={
              targetCost === null
                ? "Awaiting the figure from Metis. No placeholder is shown, because a made-up target would make every number above look like an answer."
                : `Entered by hand. Source: ${phase?.source ?? "unstated"}.`
            }
            tone="target"
          />
        </tbody>
        <tfoot>
          <tr className="pr-gap">
            <th scope="row">Still to find</th>
            <td className="num">{gap === null ? "Not shown" : usd.format(Math.max(gap, 0))}</td>
            <td className="pr-detail">
              {gap === null
                ? "Needs both a target cost and a readable cash balance. One of them is missing."
                : gap > 0
                  ? "Target cost minus cash on hand. Awarded money is excluded until its terms are known and it has actually arrived."
                  : "Cash on hand covers the estimated cost of this phase."}
            </td>
          </tr>
        </tfoot>
      </table>

      {funds?.environment === "sandbox" ? (
        <p className="banner banner-error">
          <strong>The cash figure above is test data.</strong> It comes from Intuit's
          sandbox company, not HPIC's books, so treat the shape of this panel as real and
          the cash number as invented until production keys are issued.
        </p>
      ) : null}

      <p className="note">
        <strong>What this panel needs to become real:</strong> Payment Terms set on the
        awards in LGL, the estimated cost from Metis, and QuickBooks production keys.
        Nothing here is waiting on code.
      </p>
    </section>
  );
}
