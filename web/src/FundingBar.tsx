/**
 * The Rebuild tab's one answer: how much more HPIC needs to raise to fund the
 * next construction phase (decided 2026-11-10).
 *
 *     Still to raise = estimate − rebuild cash − grants awarded, not yet received
 *
 * One gap figure, not two. The tab used to show a second, "Still to find", which
 * left awards out because a reimbursable award cannot pay for work up front. The
 * board found two gaps confusing, and bridge financing is a later question, so
 * the reimbursable rule is now one sentence under the figure instead.
 *
 * What still holds: the three parts are drawn as three segments and never merged,
 * awarded money is a lighter step labelled "awarded, not yet received" and is
 * never called available, and the figure appears only when all three parts were
 * read. A missing part reads "Not shown", never a smaller gap.
 */

import { How } from "./Disclosure";
import { formatDate, usd } from "./format";
import { LglLink } from "./LglLink";
import type { FundsSnapshot, GrantSnapshot } from "./types";

/**
 * Whole percentages that add up to exactly 100, by largest remainder. Rounding each
 * share on its own gave 13 + 55 + 33 on 2026-11-10.
 */
function wholeShares(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export function fundingFigures(funds: FundsSnapshot | null, grants: GrantSnapshot | null) {
  const target = grants?.phaseTarget.targetCost ?? null;
  const cash = funds?.subtotals?.find((s) => s.purpose === "rebuild")?.total ?? null;

  // What is still to arrive on every rebuild award, whatever its terms. This is
  // "awarded, not yet received", which is true of all of them; it is not a claim
  // that any of it can be spent. Null if any award's payments were not read.
  // A failed read leaves no buckets at all, which must not read as "nothing awarded".
  const buckets = grants && grants.stages.every((s) => s.status !== "unavailable") ? grants.awardsByReimbursable : null;
  const awarded =
    buckets && buckets.every((b) => b.remaining != null) ? buckets.reduce((sum, b) => sum + b.remaining!, 0) : null;
  const withMoney = (buckets ?? []).filter((b) => (b.remaining ?? 0) > 0);
  const allReimbursable = withMoney.every((b) => b.status === "reimbursable");
  const awardedUrl = withMoney.length === 1 ? withMoney[0].remainingUrl : null;

  const complete = target !== null && cash !== null && awarded !== null;
  const toRaise = complete ? Math.max(target - cash - awarded, 0) : null;

  // Shares of the estimate. Money beyond the estimate does not stretch the bar.
  let shares: { cash: number; awarded: number; raise: number } | null = null;
  if (complete && target > 0) {
    const inBank = Math.min(Math.max(cash, 0), target);
    const promised = Math.min(Math.max(awarded, 0), target - inBank);
    const [c, a, r] = wholeShares([inBank, promised, target - inBank - promised]);
    shares = { cash: c, awarded: a, raise: r };
  }

  return { target, cash, awarded, awardedUrl, allReimbursable, toRaise, shares, covered: shares ? shares.cash + shares.awarded : null };
}

/** Today in Seattle. Whether a contractor's prices still hold is a question about today. */
function todayInSeattle(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function FundingHeadline({ funds, grants }: { funds: FundsSnapshot | null; grants: GrantSnapshot | null }) {
  const { target, cash, awarded, awardedUrl, allReimbursable, toRaise, shares } = fundingFigures(funds, grants);
  const phase = grants?.phaseTarget;
  const name = phase?.name ?? "the next phase";
  const rebuild = funds?.subtotals?.find((s) => s.purpose === "rebuild");
  const validUntil = phase?.pricesValidUntil ?? null;
  const lapsed = validUntil !== null && todayInSeattle() > validUntil;

  // Said in place, not in the disclosure: why the headline has no figure.
  const missing =
    target === null
      ? "The contractor's estimate has not been entered, so there is no target to measure against."
      : cash === null
        ? rebuild?.note ?? "The rebuild accounts could not be read from QuickBooks."
        : awarded === null
          ? "LGL's grant payments could not be read completely, so what is still to come on the awards is unknown."
          : null;

  const rows: { key: "cash" | "awarded" | "raise"; label: string; value: number | null; share: number | null; url?: string | null }[] = [
    { key: "cash", label: "In the bank", value: cash, share: shares?.cash ?? null },
    { key: "awarded", label: "Awarded, not yet received", value: awarded, share: shares?.awarded ?? null, url: awardedUrl },
    { key: "raise", label: "Still to raise", value: toRaise, share: shares?.raise ?? null },
  ];

  return (
    <section className="panel">
      <h1>Still to raise for {name}</h1>
      {toRaise !== null ? (
        <p className="headline-figure">{usd.format(toRaise)}</p>
      ) : (
        <p className="headline-figure unavailable">Not shown</p>
      )}
      {missing ? <p className="banner banner-error">{missing}</p> : null}

      {target !== null ? (
        <p className="funding-head">
          <span>
            {name} estimate <strong>{usd.format(target)}</strong>
          </span>
        </p>
      ) : null}

      {shares ? (
        <div
          className="funding-bar"
          role="img"
          aria-label={`${shares.cash}% of the estimate is in the bank, ${shares.awarded}% is awarded but not yet received, and ${shares.raise}% is still to raise.`}
        >
          <span className="funding-cash" style={{ width: `${shares.cash}%` }} />
          <span className="funding-awarded" style={{ width: `${shares.awarded}%` }} />
          <span className="funding-raise" style={{ width: `${shares.raise}%` }} />
        </div>
      ) : null}

      <ul className="funding-legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span className={`swatch swatch-${r.key}`} aria-hidden="true" />
            <span className="funding-label">
              {r.label}
              {r.share !== null ? <span className="funding-share"> {r.share}%</span> : null}
              {r.key === "awarded" ? <span className="tag tag-warn">Provisional</span> : null}
            </span>
            <strong className={r.value === null ? "unavailable" : undefined}>
              {r.value === null ? "Not shown" : <LglLink url={r.url}>{usd.format(r.value)}</LglLink>}
            </strong>
          </li>
        ))}
      </ul>

      {awarded !== null && awarded > 0 ? (
        <p className="note">
          {allReimbursable
            ? "Rebuild grants are reimbursable: HPIC pays first and the funder repays after invoicing."
            : "Some of this is reimbursable, where HPIC pays first and the funder repays after invoicing; the terms of each award are in LGL."}
        </p>
      ) : null}
      {target !== null ? (
        <p className="note">
          Hand-entered Metis estimate.
          {validUntil
            ? lapsed
              ? ` Its prices were held until ${formatDate(validUntil)}, and Metis will re-price it when HPIC is ready to build.`
              : ` Its prices hold until ${formatDate(validUntil)}.`
            : ""}
        </p>
      ) : null}

      <How>
        <p>
          <strong>Still to raise</strong> is the estimate, less the cash in the rebuild accounts, less what is still to
          come on rebuild grants already awarded. It is shown only when all three were read.
        </p>
        {target !== null ? (
          <p>
            <strong>The estimate</strong> is the one figure here that no system holds: it comes from the contractor and
            is entered by hand. Source: {phase?.source ?? "unstated"}.
            {lapsed
              ? " The board knows the prices have lapsed. It is still the most recent figure, and the next re-price comes when the funds are in place to proceed."
              : ""}
          </p>
        ) : null}
        <p>
          <strong>In the bank</strong> is the QuickBooks book balance of the rebuild accounts only. Programming cash pays
          for programs, so it is not counted toward the rebuild.
        </p>
        <p>
          <strong>Awarded, not yet received</strong> is each award less the payments LGL links to it. It is provisional:
          QuickBooks has not confirmed it, and a payment not linked to its award makes it too high. Money already received
          has been spent or is in the bank, so it is not counted twice.
        </p>
        <p>
          <strong>Reimbursable</strong> means the funder pays only after HPIC has spent the money and sent an invoice. So
          awarded money counts toward the total, but it cannot pay for work up front: HPIC needs cash, or a bridge, to
          start. How much cash that takes is not worked out here.
        </p>
      </How>
    </section>
  );
}
