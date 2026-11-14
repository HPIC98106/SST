# Kyle's to-do

**Only open actions that need a human to unblock development**: a login, a
credential, a decision, or a conversation. Code work lives in CLAUDE.md under
"Phase status"; reasoning and decisions live in CLAUDE.md too.

Rules for keeping it that way:

- One item per action. Say what to do, what it unblocks, and where the steps are.
- **When an item is done, delete it.** Don't tick it, annotate it, or move it
  to a "done" section. The git log is the record.
- If an item produces a lasting fact or decision, put that fact in CLAUDE.md,
  not here.

How to do each item is in `docs/runbook.md`, and the current project has its own
guide, `docs/move-to-hpic-cloudflare.md`. Both are local only. The runbook starts
with a table of which file is for what.

---

## Now

- **Move the dashboard to HPIC's Cloudflare account, behind per-person sign-in.**
  Follow `docs/move-to-hpic-cloudflare.md`. Part 1 is yours, about an hour, in any
  order: pick the address, set up the emailed-code sign-in, fix Intuit's app
  settings (its links have been broken since September), and gather four values.
  Then send Claude the subdomain and team name, and pick an hour for part 3 together.
  Unblocks: the board signing in individually, the shared passphrase going away,
  and the dashboard living on HPIC's account rather than yours.

- **Enter the 2027 budget in QuickBooks, by month.** Budgets → create a 2027
  Profit and Loss budget, pre-filled from 2026 actuals by month, then adjust to
  the approved figures, keeping each amount in the month the money actually
  moves, which 11 of the 23 lines in `Budget_FY26_P&L` do not. Keep one active
  budget per year. Settle these in the draft spreadsheet first, with Galen and
  Alex: the net in its notes disagrees with the sheet's total; the Licenses and
  Permits subtotal does not equal its lines; its January to September spending is
  below QuickBooks', mostly on Supplies; its whole-year 2027 spending is less than
  was spent by September this year; several 2027 lines are nine-month actuals
  carried as a full year (SPU, internet); Online Auction and Sponsorship are
  budgeted at nothing though both brought money in this year, and the First Fridays
  tab assumes sponsorship; and Interest is far above this year's. Unblocks: budget
  to date and projected year-end for 2027.

- **Confirm the Intuit developer account is recoverable without you.** It's
  registered to `kyle.huber@hpic1919.org`. Check that a Workspace admin can
  recover that mailbox, or move the login to a role address. Runbook, "Confirm the Intuit developer account". Production
  depends on it now, so a lost mailbox would strand the QuickBooks connection.

## Conversations

- **Rachel, about tagging grants in QuickBooks.** This is what Spent on Grant
  details is waiting for. Propose one **Project per award**, under its funder,
  applied at entry time, and cover invoices to funders as well as expenses. Your
  iteration 2 doc lists the mechanism as open (class, location or tag): settle it
  here. Claude read QuickBooks on 2026-10-31, so you can start from
  facts (details in CLAUDE.md): the plan is Plus and Projects are already on; no
  project exists; no rebuild expense says which grant it belongs to, though there
  are only 138 such lines since 2023, so tagging back is feasible. Agree how far back
  to tag and how to split one bill across grants. Also raise: the LGL sync files
  grant payments under "General LGL Constituent" rather than the funder, and every
  expense is `NotBillable` even though billable tracking is on; and the SPU compost
  records (907952, 903731), coded Grant "to match the QuickBooks record." Unblocks:
  Spent per grant and authoritative Received (P3), then the health signals and
  uninvoiced reimbursable spending (P5).

- **Rachel, about the dues difference on Reconciliation.** January to October reads
  $17,558.80 in LGL and $16,612.40 in QuickBooks. Most of the $946.40 is October (LGL
  $2,320), so ask whether October's dues are all booked yet. Unblocks: the first line
  of the board's reconciliation reading "Match", or a known reason it does not.

- **Galen, about the percent-funded denominator.** The spec's 40% / 70%
  thresholds are almost certainly against the whole capital campaign, not
  Dry-in. Need: what funders measure against, and the source for the total
  project cost. Unblocks: percent-funded.

## Decisions

- **Gifts 906707 and 909414: one $7,500 payment, or two?** Same amount and
  date, one coded Rebuild and one Programs; 909414 was added retroactively
  2026-09-04. QuickBooks now points to one: it holds a single $7,500 receipt that
  day, coded Grants and deposited to US Bank Checking, the account program grants
  go to, which favors keeping 909414 (Programs). Confirm, then fix the records in
  LGL: which one stays decides whether the money counts toward the rebuild. If it
  was two payments after all, no 2025 CARE award exists in LGL to link them to, so
  one needs creating. Unblocks: two of the four unlinked payments on Reconciliation
  and Grant details. Runbook, "Fix the LGL records".

- **Whether to define `contract_signed` in LGL.** Only if someone commits to
  keeping it current. 905452 (BFA, $388,000) and 905997 (City of Seattle,
  $500,000) are exactly the state it would capture: Grant details can only say
  "Awaiting first payment", and whether a contract is signed lives in freetext
  notes the page does not show. Runbook, "Define `contract_signed`".

## Waiting on others

- **Alex:** approve the new LGL fields on Gift, then add them. "Grant Name"
  (exactly that; a picklist with one option per grant if free text isn't offered)
  and the grant key dates: reporting due, spend-by and grant period end. Then ask
  Claude to check the names appear and to read the dates onto the Program grants
  cards. Suggested names (gift ID, name): 903691 Commerce: Local Community Projects
  · 905452 Commerce: Building for the Arts · 905997 City of Seattle: Rebuild ·
  909194 Neighborhoods: Demolition · 906602 Arts & Culture: Rebuild · 904066
  Garneau-Nicon: Rebuild · 904061 4Culture: Sustained Support · 908457 Arts &
  Culture: First Fridays · 906062 Arts & Culture: CARE · 907007 Neighborhoods:
  First Friday Canopies.

- **Development committee:** reconcile manually tracked grants into LGL. Until
  then, grant figures cover only what's in LGL, and the UI says so.
