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

- **Set the Dry-in target from the updated Metis quote.** Give Claude the date,
  scope, whether contingency is included, and how long prices hold. Claude
  updates `CURRENT_PHASE_TARGET_SOURCE` and deploys. The grand total stays out
  of the repo: set it yourself from `worker/` in Git Bash:
  `printf '%s' "<grand total>" | npx wrangler secret put CURRENT_PHASE_TARGET_COST`.
  Unblocks: the readiness panel, which still measures against the 9/22/26
  estimate whose prices lapsed on 2026-10-22.

- **Verify the QuickBooks production cutover.** Everything is deployed and
  mapped. Ask Claude to run runbook §9's verification: each balance against
  QuickBooks' Balance Sheet to the cent, and a `rotated` token refresh in
  `/admin/status`. Needs `.dev.vars` synced first (below).

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

- **Sync `worker/.dev.vars` with the passphrase rotated on 2026-09-06.** Local
  dev only, but until it's done Claude can't check the live Worker's status
  pages itself (confirmed mismatched 2026-10-29). Runbook §7 has a command that
  verifies before it writes.

- **Delete the stray Worker secret whose name looks like a passphrase.** It
  shows in `npx wrangler secret list`, does nothing, and if it's a real
  password it shouldn't be sitting in a name field:
  `npx wrangler secret delete <name>`.

## Waiting on others

- **Development committee:** reconcile manually tracked grants into LGL. Until
  then, grant figures cover only what's in LGL, and the UI says so.
