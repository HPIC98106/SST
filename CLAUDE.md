# HPIC single source of truth: working notes

Read `hpic-sst-build-spec-v2.md` for the full specification. `README.md` covers
setup, credential rotation, and redeploy. This file is the short orientation.

**`KYLE-TODO.md` lists only open actions that need Kyle to unblock
development**: a login, a credential, a decision, a conversation. Read it at
the start of a session. When an item is done, **delete it**: don't tick it or
annotate it. Code work goes under "Phase status" below, and lasting facts or
decisions go in this file, never in KYLE-TODO. Step-by-step procedures live in
`docs/runbook-migration.md` (local only, not committed).

## What this is

A read-only board dashboard for the Highland Park Improvement Club, a
volunteer-run Seattle nonprofit rebuilding its clubhouse after a 2021 fire.
It answers: how much cash do we have, how much grant money is owed to us, and
can we afford the next construction phase.

**Never write to QuickBooks or Little Green Light.** Every call to a data API is
a GET. The only POSTs in the codebase go to Intuit's OAuth token endpoint.

The governing principle from the spec: **every number traces to a system of
record, and an honest "unavailable" always beats a clean number hiding a
caveat.** Several design choices only make sense in that light: see "Invariants".

## Layout

```
worker/   Cloudflare Worker. The security boundary. Holds every credential.
web/      React + Vite static build → GitHub Pages. Holds nothing sensitive.
```

## Deployed

| | |
| --- | --- |
| Worker | https://hpic-sst.kyhuber-ft.workers.dev |
| Dashboard | https://hpic98106.github.io/SST/ (path is case-sensitive) |
| Account mapping tool | `/admin/accounts?k=<passphrase>` |
| Concept sheet | https://hpic98106.github.io/SST/concept-sheet-2026-09-10.html (unlisted, `noindex`, source in `web/public`) |
| QuickBooks | HPIC's production company, `QBO_ENV = "production"`, connected 2026-10-29. Cash accounts are not mapped yet (runbook §9 step 6), so every card reads unavailable until `QBO_ACCOUNTS` is set. |

Frontend deploys via GitHub Actions on pushes to `web/**`. The Worker deploys
only via `npx wrangler deploy`: deliberately manual, since it holds the
credentials.

**The page is public; the data is not.** GitHub Pages has no authentication of
its own, and the repository is public. What protects the numbers is the
passphrase gate: the browser holds it in `sessionStorage` and sends it as
`X-HPIC-Auth`, and `worker/src/auth.ts` compares it in constant time. An unset
`ACCESS_PASSPHRASE` denies everyone rather than allowing everyone. **Never move
that check into the frontend**: a password compared in the bundle is no check
at all, and the Worker is the only thing standing between the internet and
HPIC's QuickBooks and LGL data.

## Invariants: do not quietly break these

- **Total cash renders only when every configured account reads successfully.**
  A total that silently drops a failed account overstates available cash. This
  is the specific failure the tool exists to prevent, not a nicety. The same
  rule holds per group: cash accounts are a list in `QBO_ACCOUNTS`, each tagged
  `rebuild` or `programming` (decided 2026-10-29, because HPIC's rebuild money
  sits in two accounts), and a group's subtotal renders only when all of its
  accounts read. Readiness uses the rebuild subtotal. An unparseable entry
  blanks every figure rather than being skipped.
- **`retrievedAt` is QuickBooks' own `time` field**, never the browser or Worker
  clock. A dashboard always showing today's date is worse than showing none.
- **Connection state is never reported as `ok` when QuickBooks is unreachable.**
  `not_connected` and `needs_reauth` are distinct and both surface to the UI.
- **Balances are the QuickBooks *book* balance**, labeled as such. The bank-feed
  balance is not exposed by the API at all.
- **Never sum reimbursable and non-reimbursable awards into one "available"
  figure.** `splitByReimbursable` in `worker/src/lgl.ts` returns three separate
  buckets and nothing adds them. A cost-reimbursement award requires spending
  first and invoicing after, so it is not cash available to start work.
- **The readiness panel shows what is *remaining* on an award, never its face
  value.** Money already received has been spent or is sitting in Cash
  available now, so listing the full award beside cash counts it twice (Galen,
  2026-10-08). `ReimbursableBucket.remaining` is `amount − received`, from the
  same payment walk as Received, so it is `provisional` and **null whenever
  payments were not read completely**: a missing payment read would otherwise
  turn into a larger remainder. A payment not linked to its award also makes it
  too high, which is why the unlinked-payments exception is blocking.
- **Reimbursable status is `unknown` whenever the custom field is absent or
  unparseable**, never a default. As of 2026-10-07 all six in-scope awards carry a value (all
  `Reimbursable`), but that is the state of the data, not of the code.
- **"No value set" and "a value we cannot read" are reported separately.** Both
  are `unknown` and neither is ever spendable, but they need opposite fixes, and
  telling a volunteer that data entry they already did is "missing" sends them
  to stare at a record that is already filled in. `readPaymentTerms` returns the
  offending string and the panel quotes it back verbatim.
- **A funnel total renders only from a complete read.** If paging stops at the
  cap, the stage reports unavailable rather than a partial sum: the same rule
  as total cash.
- **Record counts appear beside every grant total.** LGL is a partial picture
  during the prototype; a missing grant should show as a count discrepancy.
- **`provisional` is a distinct status, never a softer `ok`.** A figure
  computed from LGL that QuickBooks has not confirmed carries the caveat in its
  status and on the card itself, not in a footnote. Downgrading one to `ok`
  presents unreconciled data as fact.
- **Payment records are never filtered by campaign.** They frequently carry
  `campaign_id = 0` while their award does not. Scope is applied by walking
  `parent_gift_id` up to an award already known to be in scope. Adding a
  campaign term to `readPayments` takes live Received from $545,000 to
  $172,570.29 without erroring.
- **A record breaking a data-quality rule is excluded from totals and named in
  the exceptions panel.** Never absorbed, never silently dropped. The panel is
  product, not error handling: the prototype ships against imperfect data so
  the gaps become arguable from HPIC's own records.
- **Zero exceptions must mean "nothing is wrong", never "nothing was read".**
  `findExceptions` runs only when both reads succeeded.

## Little Green Light: what the API actually exposes

Verified 2026-08-14 against `api.littlegreenlight.com/api-docs/static.html`.
**The build spec describes objects that LGL's REST API v1 does not have**, so
read this before touching `worker/src/lgl.ts`:

| Spec says | API actually has |
| --- | --- |
| `Pledge` object | No `/pledges` endpoint. An award is a **gift whose `gift_type` is "Pledge"**: the stock gift category "Grant" sits under exactly that type. |
| Pledge `amount due` | Not a field, but **derivable**: award amount − sum of the payment gifts hanging off it. The LGL UI shows it; the API makes you compute it. |

### The grant lifecycle: three gift records, verified 2026-08-19

A grant is not one record. It is a chain, and each link is a gift of a
different type in a different category:

| Stage | Type | Category | Carries |
| --- | --- | --- | --- |
| Application | 14 "Goal" | 6051 "Grant Proposal" (6102 "Public Funding" on one) | **no amount at all**: `received_amount` is `null` |
| Award | 7 "Pledge" | **6031** "Grant" | `received_amount` = award face value |
| Payment | 1 "Gift" | **6076** "Grant" | `received_amount` = cash actually received |

Each links upward by `parent_gift_id`. Four properties of this shape cost real
time if rediscovered the hard way:

- **`received_amount` on a Pledge is the award, not cash.** So is
  `deposited_amount`, which is stamped at entry and equals `received_amount` on
  every award: including ones with no payment against them at all. Reading
  those as cash overstates by $926,000 against live data.
- **6031 and 6076 both display as "Grant".** Awards are in one, payments in the
  other. An earlier note here said `/gift_categories` returns blank names and
  that the two could not be told apart by listing them; **that was wrong**:
  the field is `display_name`, not `name`, and it comes back populated next to
  `gift_type_id`. Listing the endpoint distinguishes them cleanly: 6031 is
  `gift_type_id 7` (Pledge), 6076 is `gift_type_id 1` (Gift). Re-verified
  2026-09-09.
- **Payments often do not carry their award's campaign.** Three of eleven have
  `campaign_id = 0`, including two of the three payments against the $485,000
  Commerce award. Scoping payments by `campaigns=in|871` the way awards are
  scoped returns $112,570.29 of that $485,000 and silently drops $372,429.71.
  **Reach the campaign by walking `parent_gift_id` up to the pledge; never
  filter payment records by campaign.**
- **Goals are dereferenceable, not discoverable.** Type 14 is absent from
  `/gift_types`, there is no `/goals` endpoint, and `gifts/search` returns
  none. You can follow a pointer to one; you cannot enumerate them.

### Custom fields: how LGL scopes them, verified 2026-09-09

**`/categories` is the custom-field *definition* endpoint.** It is not in the
documented resource list and it is not the same thing as `/gift_categories`.
Each row carries `item_type`, `key`, `facet_type`, and the `keywords` that make
up a picklist.

Three properties that decide what can be tracked and how:

- **`item_type` is the only scoping LGL has, and "Gift" is the finest grain.**
  There is no per-gift-type visibility: a custom field defined on Gift appears
  on all ten gift types. **Pledge is not an available item type**, which
  answers the verification step the build spec asked for, in the negative. The
  design absorbs this instead: blank reads as unknown, and the dashboard only
  reads the field on awards already inside scope, so a stray value on a donor
  pledge is never looked at.
- **Fields an organisation defines get a UUID `key`.** Only LGL's own stock
  fields (`tags`, `giving_status`) get readable ones, so **matching must be on
  `name`**. `readReimbursable` checks both, and the key half will never fire for
  an HPIC-created field. The fixtures use a UUID key deliberately to keep that
  honest.
- **Gift *categories*, unlike custom fields, are scoped per gift type**:
  `/gift_categories` carries `gift_type_id` on every row. That makes categories
  the only per-type dimension available. Splitting "Grant" into reimbursable and
  non-reimbursable categories was considered and rejected on 2026-09-09: the
  category is already the scope key, so a third grant category added later would
  silently drop those awards out of the funnel.

**The field HPIC actually created is "Payment Terms"** (2026-09-09), a
single-select on Gift with three options: `Reimbursable`, `Payment in full`,
`Distribution payments`. The dashboard maps the last two onto
`not_reimbursable`: the only distinction that changes a number here is whether
HPIC must spend before the money arrives, and LGL stays the record of what the
funder actually agreed to. **The picklist is closed by contract:** any option
added in LGL without being added to `toReimbursableStatus` lands the award in
the "payment terms cannot be read" exception rather than being guessed at.

### Received and Outstanding: built, and provisional

These now render, computed from the payment records and marked `provisional`.
Live: **Pledged $1,471,000 · Received $545,000 · Outstanding $926,000.**

The reason they once read "Not shown", that LGL had no amount-due field,
**was wrong**, and the entry above supersedes it. Amount due is derivable. What
replaced that constraint is a judgment call, decided 2026-08-19: **QuickBooks
is authoritative for cash; the LGL figure is provisional and labelled as
unreconciled.** It is rendered anyway because the prototype's strategy is to
expose the gaps and argue from them, which requires showing something.

    Received     = LGL payment gifts today (provisional); QuickBooks eventually
    Outstanding  = Pledged − Received
    Spent        = expenses booked against the grant: QuickBooks only, always

**`Spent` is not a choice.** LGL has no concept of an expense, and invoicing a
funder on a cost-reimbursement award requires knowing what HPIC spent. So
QuickBooks is load-bearing for Phase 3 however A2 is decided, and LGL can never
carry the whole funnel.

The evidence favouring QuickBooks for `Received` is data quality rather than
capability, and it is what the exceptions panel now surfaces automatically:

- 3 of 11 payment records carry no `parent_gift_id`, so summing child gifts
  **undercounts** by $7,500 of real grant money.
- Two of those three are a fee-for-service compost event recoded into the Grant
  category, so reading the category flat **overcounts** by $3,000.
- One of those notes says the recoding was done so the record matches the
  QuickBooks entry: the bookkeeping already treats QuickBooks as authoritative.
- Payment Terms was populated on the six in-scope awards by 2026-10-07 (all
  `Reimbursable`), so reimbursable status is no longer unknown for them. It
  was 0 of 10 when this was written.

If LGL is chosen instead, the prerequisites are: every payment linked to its
award, 6076 kept free of non-grant income, custom fields defined on Pledge, and
award status held in a field rather than a freetext note (the Goal note on the
$38,000 OAC award still says a decision was anticipated April 2026, months
after the award landed). LGL's `Installment` type (13) exists and is unused:
worth checking whether it enforces the payment-to-award link that hand-entered
type-1 gifts do not.

Choosing QuickBooks instead needs a **bookkeeping practice**: QuickBooks must
carry a dimension that ties a deposit or expense to a specific grant, applied
at entry time. **The dimension is a Customer (or Project), not a Class**, decided 2026-09-06, revising an earlier Class recommendation. Class is the
simpler rule, but **billable expenses attach to a Customer**, and
`BillableStatus` (`NotBillable` / `Billable` / `HasBeenBilled`) is what answers
whether reimbursable spending was ever invoiced. With Class that state has to
be reconstructed by hand; with Customer, QuickBooks maintains it.

**Do not add a custom "reimbursable" field to expenses.** Reimbursability is a
property of the award, so it is derivable once an expense carries its grant. A
second hand-maintained flag would eventually disagree with the first and
nothing would say which is right. What varies per expense is *eligibility*,
which `BillableStatus` already models.

Nothing in `worker/src/qbo.ts` reads any such dimension today; it reads Account
entities and book balances only. (The `Classification` field there is the
account-type filter for `Asset`, not a QuickBooks Class.) The Phase 1
completeness rule governs either way: a deposit attributable to no grant is
invisible, so incomplete attribution renders unavailable rather than quietly
low.

Two more things that matter:

- **Applications are out of scope, and the reads are gone.** The funnel starts
  at Pledged: this tool covers money awarded or promised, not money requested
  (Alex, 2026-08-14). LGL does model applications: they are `appeal_request`
  records, reachable only by enumerating `/appeals` then
  `/appeals/{id}/appeal_requests` for each, since there is no global list
  endpoint, but nothing here reads them. `test/lgl.test.ts` pins that no
  request URL mentions an appeal, because the enumeration is easy to
  reintroduce while adding a later stage and it was the most expensive part of
  the page walk. Do not add it back without revisiting the scope decision.
- **Scope is not optional for correctness.** LGL holds every pledge, most of
  them individual donor activity. `LGL_GRANT_CAMPAIGN_IDS` /
  `LGL_GRANT_GIFT_CATEGORY_IDS` narrow the reads; unset, the snapshot sets
  `unscoped: true` and the UI says the figures are not grants-only rather than
  implying they are.

The gift type ID for "Pledge" is resolved by name at runtime, not hardcoded: a
wrong ID returns zero awards, which looks identical to HPIC having no grants.

## Shell

Windows, **Git Bash** (MINGW64), run from the repository root. Commands must be
POSIX: forward-slash paths (`/c/Users/...` or `~/...`), no `cd` to an absolute
Windows path, no `python` (not installed: use `node`). PowerShell 5.1 exists
but lacks `&&`, `||`, and much else; prefer Git Bash.

**But `/c/...` only survives as far as the argument list.** Git Bash rewrites
path-shaped *arguments* into Windows form before handing them to a native
binary, so `node /c/Users/.../script.mjs` works. It does **not** rewrite a path
sitting inside a quoted string, so this fails:

    node -e 'readFileSync("/c/Users/.../worker/.dev.vars")'
    # ENOENT: open 'C:\c\Users\...'   <- note the stray leading \c

Inside `-e`, a `--config=`, or any other path embedded in a string, use
`C:/Users/...` or a path relative to the working directory. The same applies to
anything else that takes a script body rather than a filename.

**Prefer pure shell for one-off file edits involving a secret.** `sed` needs the
replacement escaped, so a value containing `|`, `&` or a backslash is silently
mangled, which, when the value is a credential, recreates the exact drift the
edit was meant to fix. This treats it literally and needs no second interpreter:

    { grep -v '^KEY=' f; printf 'KEY=%s\n' "$V"; } > f.new && mv f.new f

**Scripted credential changes should verify before they persist.** Setting a
Cloudflare secret and updating `worker/.dev.vars` are two writes that must
agree, and nothing checks them: a mismatch surfaces later as a 401 that looks
like a rotation problem. Test the value against the deployed Worker and only
write the file on a 200.

## Gotchas that cost real time

- **Never pipe secrets into `wrangler secret put` from PowerShell.** Its
  native-command pipe appends a carriage return that becomes part of the secret;
  every comparison then fails while looking correct. Use Git Bash:
  `printf '%s' "$VALUE" | npx wrangler secret put NAME`.
- **A secret cannot be bound to a version that is not the deployed one.**
  `wrangler secret put` fails with "the latest version of your worker isn't
  currently deployed"; `npx wrangler deploy` first, then retry.
- **A name cannot be both a `[vars]` entry and a secret.** Cloudflare rejects it
  with `code: 10053`. Delete the var, `wrangler deploy`, *then* `secret put`.
- **Intuit development keys only reach sandbox companies; production keys only
  reach production companies.** They are strictly paired. Production keys
  require a self-assessment questionnaire and Intuit approval, even for private
  apps.
- **Intuit redirect URIs must be `https`**, so OAuth cannot be seeded against
  localhost. Local dev runs in `QBO_MODE = "fixture"`; tokens live in the
  deployed Worker.
- Redirect URIs registered under the Development tab do **not** carry over to
  Production. Register again.
- `Intl.DateTimeFormat` rejects combining `dateStyle`/`timeStyle` with
  `timeZoneName`. Use explicit component options.

## Verified vs. not

Verified against live infrastructure: OAuth seeding, live account reads, the
snapshot cache round-trip, per-account degradation with total suppression, the
401 boundary, CORS from the real Pages origin, the disconnect/revoke path
(Intuit confirmed the revocation), the hourly cron firing unattended, and, as
of 2026-08-14, the token refresh itself:

```
"kind":"refreshed","detail":"new access token valid 3600s; refresh token unchanged"
```

**One sub-case is still test-only: a rotated refresh token.** Intuit returned
the same refresh token on that first live refresh, which is normal: it rotates
roughly every 24 hours, not every hour. So the property that matters most, that
a *rotated* value is re-stored, has been proven by `worker/test/tokens.test.ts`
but not yet observed live. Confirm it by checking `/admin/status` for a
`refreshed` event whose detail says `rotated` rather than `unchanged`; there
should be one within a day of the connection being seeded.

The tests also cover `invalid_grant`, an unreachable Intuit, and the
single-flight guard. None of those three can be reached against live Intuit at
all: forcing `invalid_grant` means revoking the real grant, Intuit cannot be
made unreachable on demand, and nothing in normal operation issues two
concurrent refreshes.

If the dashboard ever reports "needs to be reconnected" unexpectedly, look at
that event log first, then at `worker/src/tokens.ts`.

Two properties there are load-bearing and easy to break by accident, so the
tests were checked by deliberately breaking each one and confirming they caught
it:

- **The refresh token must be re-stored on every refresh.** Intuit rotates it
  and expires the old value immediately. Persisting only the access token leaves
  the connection working until the next refresh, then breaks it permanently.
- **The single-flight guard is not defensive decoration.** Removing it produces
  two concurrent refreshes, which is the case Intuit answers with
  `invalid_grant`: turning a page load into a revoked connection.

## Running the tests

```
cd worker && npm test          # vitest run, inside workerd
cd worker && npm run typecheck  # src and test both
```

`test/tokens.test.ts` covers the OAuth refresh path. `test/lgl.test.ts` covers
the grant funnel, and what it pins is mostly the places the code is supposed to
*refuse* to produce a number: the amount-due gap, unknown reimbursable status,
an incomplete page walk, and a rejected API key. Both of the load-bearing
properties there were checked by deliberately breaking them and confirming the
tests caught it.

Tests use `@cloudflare/vitest-pool-workers`, which needs the `nodejs_compat`
compatibility flag. It is set in `vitest.config.ts` only: the deployed Worker
does not need it, and `wrangler.toml` is deliberately left alone.

**`env` in a test carries whatever `wrangler.toml` sets, and that has bitten
twice.** Adding `LGL_GRANT_*_IDS` turned the "unscoped" tests into scoped ones;
adding `LGL_UI_BASE_URL` gave a record a link that a test asserted it would not
have. Both times the test was asserting deployment config rather than
behaviour. `NO_LGL_CONFIG` in `test/lgl.test.ts` clears every LGL var before
overrides, so a test constructs the state it is testing. **Add new vars to that
list even when they are unset in `wrangler.toml`**: the whole point is that a
future value cannot change what an existing test means.

## Phase status

- **Phase 1, funds snapshot: done**, and connected to production on
  2026-10-29. Accounts are now a list grouped into Rebuild and Programming,
  each with a subtotal. Balances have not yet been checked against QuickBooks.
- **Phase 2, LGL grant funnel: live, and all three stages render.** Pledged is
  authoritative; Received and Outstanding are computed from payment records and
  marked `provisional`, pending the QuickBooks reconciliation. The
  data-quality panel names every record breaking a rule. Live figures:
  $1,471,000 / $545,000 / $926,000 on 2026-09-09, and $1,471,000 / $583,000 /
  $888,000 on 2026-10-07 after the $38,000 OAC payment arrived.
  Applied was built and removed on 2026-08-18, once Alex confirmed the tool
  starts at money awarded rather than requested. Still to do: the campaign/fund
  restriction breakdown and the pledge detail list.
- **Phase 3, phase readiness: shipped, resting on provisional Received.** The
  panel measures cash against the Dry-in target, $1,628,933.86 from the Metis
  control estimate dated 9/22/26 (no contingency; prices hold until
  2026-10-22). Awards are never added to cash; the panel shows what is
  *remaining* on reimbursable awards. Payment Terms is set on all six in-scope
  awards. What it still lacks is an authoritative Received: that needs the
  QuickBooks grant dimension (P3 below), and the figure inherits
  `provisional` until then. Percent-funded is not built: its denominator is
  unsettled, waiting on Galen. The Metis estimate's prices lapsed 2026-10-22;
  an updated quote arrived 2026-10-29. Never show Metis line items: the
  estimate is for the client and project partners only.

### Build backlog (Claude)

- **N4b, restricted / unrestricted breakdown.** No data entry needed. Every
  grant pledge already carries a fund (checked 2026-09-09: Rebuild Checking 6
  pledges / $1,471,000, Program Budget 5 / $57,422). **Do not add a
  restriction custom field**: the spec says restriction comes from campaigns
  and funds. Add an "award with no fund" exception alongside "award with no
  campaign", since a fundless award silently understates a bucket. Campaign
  and fund are collinear today, so the breakdown's value is catching the first
  award where they disagree. Caveat to state on the panel: a fund records
  where money was *deposited*, not what the funder *restricted*.
- **QuickBooks read of what the LGL sync creates.** LGL has synced new
  payments to QuickBooks since mid-September (including the $38,000 OAC
  payment). Once production is connected, read what a synced gift became
  (Deposit or SalesReceipt, with which Customer, Class or account) before the
  Rachel conversation. Part of the grant dimension may already exist.
- **P3, Received and Spent from QuickBooks.** Blocked on the bookkeeping
  existing. One Customer (or Project) per award, tied to LGL by **an explicit
  map in Worker config keyed by LGL gift id**, never a naming convention: a
  renamed customer must fail loudly, not detach silently. Completeness rule:
  deposits and expenses in the rebuild accounts with no grant attribution are
  an *unattributed pool*, shown with a count and total; the roll-up "total
  grant cash received" renders only when that pool is empty.
- **P5, reimbursable spending never invoiced.** Needs P3. Expenses attributed
  to an award that LGL marks reimbursable, sitting in QuickBooks as
  `Billable`: spent, eligible, never invoiced. This is money HPIC is owed
  and hasn't asked for. Neither system can answer it alone. It belongs in the
  data-quality panel as a named list, because the fix is to send an invoice.
- **Pledge detail list** (rest of Phase 2).

## Hosting, and where it is going

Decisions recorded so they are not re-argued from memory:

- **The repository lives in the HPIC98106 organization** (moved 2026-09-06),
  so the tools outlast any one person's account.
- **No custom domain.** `sst.hpic1919.org` was planned and decided against on
  2026-09-06: the only real gain was a URL surviving a move off GitHub Pages,
  which is worth little for a board of ten who can be told. Reversible for one
  CNAME, one Pages setting and one `ALLOWED_ORIGIN` change.
- **`ALLOWED_ORIGIN` must track the Pages origin, and its failure is silent.**
  After the transfer the page rendered perfectly while every API call was
  blocked by the browser, with nothing failing server-side. If the dashboard
  ever shows no data at all following a hosting change, check this first.
- **Cloudflare stays on the personal account for now** and transfers when Kyle
  steps back. The Worker URL is the Intuit OAuth redirect URI, so leaving it
  alone keeps the QuickBooks connection untouched by any of the above.
- **No D1 database.** The hourly cron plus the Durable Object snapshot cache
  already serve pages without querying QuickBooks each time: that architecture
  is already built and running. D1 earns its place when historical trends come
  into scope, and trends are explicitly out of scope. Every extra storage layer
  is another place a number can get separated from its retrieval timestamp,
  which is the failure this tool exists to prevent.

## Context

Solo project, no deadline, no other board member depends on it. Favor the
shortest path to something working over staging fidelity or process ceremony.
Commits go straight to `main`; no PRs.
