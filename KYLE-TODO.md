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

Step-by-step procedures are in `docs/runbook-migration.md` (local only).

---

## Now

- **Add a "Grant Name" field to gifts in LGL and fill it in on each award.** Name
  it exactly that, under custom fields on Gift. Existing Gift fields are picklists,
  so if free text isn't offered, use a picklist with one option per grant. Suggested
  names, from each award's notes (gift ID, name):
  903691 Commerce: Local Community Projects · 905452 Commerce: Building for the
  Arts · 905997 City of Seattle: Rebuild · 909194 Neighborhoods: Demolition ·
  906602 Arts & Culture: Rebuild · 904066 Garneau-Nicon: Rebuild · 904061 4Culture:
  Sustained Support · 908457 Arts & Culture: First Fridays · 906062 Arts & Culture:
  CARE · 907007 Neighborhoods: First Friday Canopies.
  Then ask Claude to check that the names appear, since the code has only been
  tested against the shape of LGL's other fields. Unblocks: real names on Grant
  details, which today shows the funder and year, with two pairs reading alike.

- **Set Payment Terms on the three awards without them:** 904061 (4Culture), 906062
  (CARE), 907007 (Canopies). Unblocks: those cards stop saying "Terms not set".

- **Check whether LGL can hold a spend-by date on a gift, and add it if so.** If it
  can, ask Claude to read it onto Grant details. Worth doing while you are in those
  records: a deadline is the health signal nothing here can see yet.

- **Ask Metis to re-price the Dry-in estimate.** The spreadsheet received
  2026-10-29 is byte-identical to the 9/22/26 estimate already on the
  dashboard, whose prices held 30 days, to 2026-10-22. When the new one
  arrives, give it to Claude, who updates the source and price date; then set
  the grand total including contingency yourself from Git Bash:
  `cd ~/Desktop/hpic/SST/worker && printf '%s' "<grand total incl. contingency>" | npx wrangler secret put CURRENT_PHASE_TARGET_COST`.
  While asking, mention that their workbook taxes the 6% contingency at 10.35%
  on the summary sheet but 10.55% on the budget sheet. Unblocks: a current
  readiness target; the panel says the old one has lapsed.

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
  recover that mailbox, or move the login to a role address. Runbook §6. Production
  depends on it now, so a lost mailbox would strand the QuickBooks connection.

## Conversations

- **Rachel, about tagging grants in QuickBooks.** This is what Spent on Grant
  details is waiting for. Propose one **Project per award**, under its funder,
  applied at entry time. Claude read QuickBooks on 2026-10-31, so you can start from
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

- **Galen and Alex, about the new Overview.** Show them the live page and ask whether
  it is what the board wants to open first: it was rebuilt on your view, which you
  called one perspective. Unblocks: settling the Overview, or changing it.

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
  and Grant details. Runbook §8.

- **Whether to define `contract_signed` in LGL.** Only if someone commits to
  keeping it current. 905452 (BFA, $388,000) and 905997 (City of Seattle,
  $500,000) are exactly the state it would capture: Grant details can only say
  "Awaiting first payment", and whether a contract is signed lives in freetext
  notes the page does not show. Runbook §5.

## Credentials and access

- **Put `ACCESS_PASSPHRASE` somewhere the board can reach it**: a shared
  password manager or the org's Google Workspace. Today it exists only in your
  head and in `worker/.dev.vars` on this machine, and Cloudflare secrets can't be
  read back. If you're unavailable, the board loses its dashboard. Runbook §7.

- **Delete the stray Worker secret whose name looks like a passphrase.** Still
  there on 2026-10-31. It shows in `npx wrangler secret list`, does nothing, and if
  it's a real password it shouldn't be sitting in a name field:
  `npx wrangler secret delete <name>`.

## Waiting on others

- **Development committee:** reconcile manually tracked grants into LGL. Until
  then, grant figures cover only what's in LGL, and the UI says so.
