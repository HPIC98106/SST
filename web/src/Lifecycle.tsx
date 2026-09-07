/**
 * How a grant and an expense actually move through the two systems.
 *
 * Written for Kyle, Galen and Alex to review together: enough operational
 * detail to check against what is really typed into Little Green Light, and
 * enough of the reasoning to argue with. It is a working document, not a
 * finished process description — several stages below do not exist yet, and
 * they are shown as missing rather than left out.
 *
 * ## Why this is in the app rather than in a document
 *
 * The board will never open the repository, and a process description that
 * lives away from the numbers drifts from them silently. The scope IDs quoted
 * here are read from the live snapshot for the same reason: this page cannot
 * describe a configuration the Worker is not actually using.
 *
 * ## What must stay true
 *
 * Nothing here may describe an intention as though it were in place. The
 * expense track is the dangerous one — writing "expenses carry a grant class"
 * would read as fact, and it is not. Stages that are not built say so.
 */

import type { GrantSnapshot } from "./types";

type Presence = "present" | "partial" | "missing";

interface Stage {
  id: string;
  step: string;
  title: string;
  /** What exists in each system at this point. */
  lgl: { state: Presence; detail: string };
  qbo: { state: Presence; detail: string };
  /** Where it lands on the dashboard, or why it does not. */
  dashboard: string;
  /** The thing a person has to do. */
  action: string;
  /** What catches it when the action is skipped. */
  check: { state: Presence; detail: string };
}

const GRANT_STAGES: Stage[] = [
  {
    id: "application",
    step: "1",
    title: "We apply for a grant",
    lgl: {
      state: "present",
      detail:
        "A Goal record, in the “Grant Proposal” category. It carries no amount — the API " +
        "exposes none — so the size of an ask is not readable anywhere.",
    },
    qbo: { state: "missing", detail: "Nothing. Applying for money is not an accounting event." },
    dashboard:
      "Nowhere, by decision. This tool starts at money awarded, not money requested " +
      "(Alex, Aug 2026). That is a scope choice, not a gap.",
    action: "Create the Goal when the proposal goes out.",
    check: {
      state: "missing",
      detail:
        "None. Goals cannot even be listed through the API — they are reachable only by " +
        "following a link from an award — so nothing can audit them.",
    },
  },
  {
    id: "award",
    step: "2",
    title: "The grant is awarded",
    lgl: {
      state: "present",
      detail:
        "A Pledge record in the grant award category, linked up to the Goal. Its amount is " +
        "the face value of the award — this is the number the dashboard trusts.",
    },
    qbo: {
      state: "missing",
      detail:
        "Nothing, correctly. An award is a promise, not cash, so nothing is booked until " +
        "money actually moves.",
    },
    dashboard: "Pledged. This figure is authoritative.",
    action:
      "Create the Pledge, link it to its Goal, set the campaign, and set reimbursable — " +
      "reimbursable is the one that decides whether the money can be spent yet.",
    check: {
      state: "partial",
      detail:
        "The panel catches an award with no campaign or no reimbursable status. It cannot " +
        "catch an award nobody entered at all — that shows only as a record count that " +
        "looks too low to someone who knows better.",
    },
  },
  {
    id: "payment",
    step: "3",
    title: "The funder pays us",
    lgl: {
      state: "partial",
      detail:
        "A payment record in the grant payment category, linked to the award it pays. A " +
        "grant can be drawn in several payments — the $485,000 Commerce award came in " +
        "three. Three payments today carry no link to any award.",
    },
    qbo: {
      state: "partial",
      detail:
        "A deposit exists, but carries nothing saying which grant it belongs to. This is " +
        "the single missing piece behind everything marked provisional.",
    },
    dashboard: "Received, and Outstanding by subtraction. Both provisional.",
    action:
      "Record the payment and link it to its award. Then code the QuickBooks deposit to " +
      "that grant — which is not possible yet, because the classes do not exist.",
    check: {
      state: "partial",
      detail:
        "The panel names payments linked to no award and excludes them from Received. " +
        "Nothing yet checks the QuickBooks side, because there is nothing there to check.",
    },
  },
];

const EXPENSE_STAGES: Stage[] = [
  {
    id: "spend",
    step: "4",
    title: "We spend money on the project",
    lgl: {
      state: "missing",
      detail:
        "Nothing, and there never will be. Little Green Light has no concept of an " +
        "expense. This is not a configuration gap — it is what the system is for.",
    },
    qbo: {
      state: "partial",
      detail:
        "The expense is booked. Nothing on it says which grant it should be charged to.",
    },
    dashboard: "Nowhere. There is no Spent figure, because nothing could compute one.",
    action:
      "Code the expense to the grant's class at entry time — once the classes exist. " +
      "Applied inconsistently this is worse than not at all: a half-attributed total " +
      "understates spending while looking complete.",
    check: {
      state: "missing",
      detail:
        "None exist. When built, an expense attributable to no grant must be surfaced and " +
        "excluded, never absorbed — the same rule the grant panel already follows.",
    },
  },
  {
    id: "invoice",
    step: "5",
    title: "We invoice a reimbursable funder",
    lgl: { state: "missing", detail: "Nothing. Invoicing is an accounting activity." },
    qbo: {
      state: "missing",
      detail:
        "Not modelled. On a cost-reimbursement award HPIC spends first and bills after, so " +
        "this step is what actually converts spending back into cash.",
    },
    dashboard: "Nowhere. This is Phase 3, and it is deliberately blocked.",
    action:
      "Total what was spent against the grant, invoice the funder, then record their " +
      "payment — which re-enters the cycle at step 3.",
    check: {
      state: "missing",
      detail:
        "None. This is why reimbursable status matters: an unreceived reimbursable award " +
        "is not money HPIC can spend, and treating it as though it were is the specific " +
        "error this dashboard exists to prevent.",
    },
  },
];

const PRESENCE_LABEL: Record<Presence, string> = {
  present: "In place",
  partial: "Partly",
  missing: "Not there",
};

function Cell({ state, detail }: { state: Presence; detail: string }) {
  return (
    <div className={`lc-cell lc-${state}`}>
      <span className="lc-flag">{PRESENCE_LABEL[state]}</span>
      <span>{detail}</span>
    </div>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  return (
    <section className="lc-stage">
      <h3>
        <span className="lc-step">{stage.step}</span>
        {stage.title}
      </h3>
      <dl className="lc-grid">
        <div>
          <dt>Little Green Light</dt>
          <dd>
            <Cell {...stage.lgl} />
          </dd>
        </div>
        <div>
          <dt>QuickBooks</dt>
          <dd>
            <Cell {...stage.qbo} />
          </dd>
        </div>
        <div>
          <dt>On the dashboard</dt>
          <dd>{stage.dashboard}</dd>
        </div>
        <div>
          <dt>Someone has to</dt>
          <dd className="lc-action">{stage.action}</dd>
        </div>
        <div>
          <dt>What catches a mistake</dt>
          <dd>
            <Cell {...stage.check} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function LifecycleView({ snapshot }: { snapshot: GrantSnapshot | null }) {
  const scope = snapshot?.scope;
  return (
    <section className="panel">
      <h1>How a grant moves through our systems</h1>
      <p className="note">
       Every figure on the dashboard is one of the stages below. This is for reviewing
       against what is actually typed into Little Green Light to ensure the dashboard is accurate.
      </p>

      <h2 className="lc-heading">The grant side</h2>
      {GRANT_STAGES.map((stage) => (
        <StageRow key={stage.id} stage={stage} />
      ))}

      <h2 className="lc-heading">The expense side</h2>
      <p className="banner banner-warn">
        <strong>Almost none of this exists yet.</strong> It is written out because the
        missing half is the half that matters for reimbursable grants — most of the Rebuild
        money. Until spending can be attributed to a grant, HPIC cannot tell what it is owed
        without working it out by hand.
      </p>
      {EXPENSE_STAGES.map((stage) => (
        <StageRow key={stage.id} stage={stage} />
      ))}

      <div className="subpanel">
        <h2>What would have to change</h2>
        <ol className="lc-todo">
          <li>
            <strong>Define reimbursable on awards in Little Green Light.</strong> Purely
            additive, changes no existing record, and it is the only thing standing between
            here and a spendable-cash figure.
          </li>
          <li>
            <strong>Link every payment to the award it pays.</strong> Without it a payment
            belongs to no grant and cannot be counted.
          </li>
          <li>
            <strong>Give QuickBooks a class per grant, applied at entry.</strong> This is
            one bookkeeping habit, and it unlocks both an authoritative Received and a Spent
            figure at once.
          </li>
        </ol>
        <p className="note">
          The first two are Little Green Light housekeeping and could be done this week. The
          third is a change to how the books are kept, and needs agreement before it starts —
          applied inconsistently it produces a number that is confidently wrong.
        </p>
      </div>

      {scope ? (
        <p className="note lc-scope">
          Read live from the Worker, so this page cannot describe a setup that is not in
          use: campaign {scope.campaignIds.join(", ") || "none"} · award category{" "}
          {scope.awardCategoryIds.join(", ") || "none"} · payment category{" "}
          {scope.paymentCategoryIds.join(", ") || "none"}. Both categories display as
          “Grant” in Little Green Light and can only be told apart by their ID.
        </p>
      ) : null}
    </section>
  );
}
