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

- **Ask Metis to re-price the Dry-in estimate.** The spreadsheet received
  2026-10-29 is byte-identical to the 9/22/26 estimate already on the
  dashboard, whose prices held 30 days, to 2026-10-22. When the new one
  arrives, give it to Claude, who updates the source and price date; then set
  the grand total including contingency yourself from Git Bash:
  `cd ~/Desktop/hpic/SST/worker && printf '%s' "<grand total incl. contingency>" | npx wrangler secret put CURRENT_PHASE_TARGET_COST`.
  While asking, mention that their workbook taxes the 6% contingency at 10.35%
  on the summary sheet but 10.55% on the budget sheet. Unblocks: a current
  readiness target; the panel says the old one has lapsed.

- **Deploy the Worker once the Metis PR merges, then switch the target to
  include contingency.** The deploy ships the new source text and price date:
  `cd ~/Desktop/hpic/SST && git pull && cd worker && npx wrangler deploy`.
  Straight after, set the grand total including Metis's 6% contingency (the
  figure is in the 2026-10-30 Claude session, and on the budget sheet as
  "Grand Total Including Contingency"):
  `printf '%s' "<that figure>" | npx wrangler secret put CURRENT_PHASE_TARGET_COST`.
  Back to back, so the panel never pairs the new wording with the old total.
  One deploy covers this and the Operations PR if both are merged first.

- **After 2026-10-31, ask Claude to check `/admin/status` for a `rotated`
  token refresh.** The last open check on the production cutover; Intuit
  rotates roughly daily and the connection was seeded 2026-10-29 23:31 PDT.

  Unblocks: real cash figures, and every QuickBooks item below.

- **Confirm the Intuit developer account is recoverable without you.** It's
  registered to `kyle.huber@hpic1919.org`. Check that a Workspace admin can
  recover that mailbox, or move the login to a role address. Runbook §6. Not a
  hard blocker for the cutover, but it becomes one the moment production
  depends on it.

## Conversations

- **Rachel, about the QuickBooks grant dimension.** Propose one Customer (or
  Project) per grant award, applied at entry time, with an agreed start date.
  Check the plan tier first: Projects and Class need Plus or Advanced. Start
  from whatever the LGL→QuickBooks sync already creates rather than a
  convention from scratch (Claude can read that once production is connected).
  Also raise the SPU compost records (907952, 903731), coded Grant "to match
  the QuickBooks record." Unblocks: authoritative Received and Spent (P3), then
  uninvoiced reimbursable spending (P5).

- **Galen, about the percent-funded denominator.** The spec's 40% / 70%
  thresholds are almost certainly against the whole capital campaign, not
  Dry-in. Need: what funders measure against, and the source for the total
  project cost. Unblocks: percent-funded.

## Decisions

- **Gifts 906707 and 909414: one $7,500 payment, or two?** Same amount and
  date, one coded Rebuild and one Programs; 909414 was added retroactively
  2026-09-04. Decide before touching either: which one stays decides whether
  the money counts toward the rebuild. If they're two payments, no 2025 CARE
  award exists in LGL to link them to, so one needs creating. Unblocks: two of
  the four unlinked-payment rows on the data-quality panel. Runbook §8.

- **Whether to define `contract_signed` in LGL.** Only if someone commits to
  keeping it current. 905452 (BFA, $388,000) and 905997 (City of Seattle,
  $500,000) are exactly the state it would capture. Today that state is only
  in freetext notes. Runbook §5.

- **Whether the dashboard should answer "how much can we spend on
  programming."** That's mostly a cash question about the operating account,
  and it would widen scope past campaign 871 for the first time. Decide it
  deliberately rather than drifting into it.

## Credentials and access

- **Put `ACCESS_PASSPHRASE` somewhere the board can reach it**: a shared
  password manager or the org's Google Workspace. Today it exists only in your
  head, and Cloudflare secrets can't be read back. If you're unavailable, the
  board loses its dashboard. Runbook §7.

- **Delete the stray Worker secret whose name looks like a passphrase.** It
  shows in `npx wrangler secret list`, does nothing, and if it's a real
  password it shouldn't be sitting in a name field:
  `npx wrangler secret delete <name>`.

## Waiting on others

- **Development committee:** reconcile manually tracked grants into LGL. Until
  then, grant figures cover only what's in LGL, and the UI says so.
