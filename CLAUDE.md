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
It answers: how is the club doing and what has happened lately, how is the
day-to-day money, where does the rebuild stand, and do LGL and QuickBooks agree.
The board's central place to see both systems, and the gaps between them.

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
| P&L grouping tool | `/admin/pl-accounts?k=<passphrase>` (income and expense account IDs, each account's group, and the budgets QuickBooks holds) |
| Concept sheet | https://hpic98106.github.io/SST/concept-sheet-2026-09-10.html (unlisted, `noindex`, source in `web/public`) |
| QuickBooks | HPIC's production company, `QBO_ENV = "production"`, connected 2026-10-29. `QBO_ACCOUNTS` set the same day (runbook §9 step 6 has the mapping). All six balances matched the Balance Sheet to the cent on 2026-10-30. |

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
- **Members come from LGL's membership records, never from dues gifts.** Gifts
  find about half of them: on 2026-10-31 LGL had 563 active members and 270
  people who had paid dues that year, since one payment can cover a household.
  Counting gifts shipped first and was caught because it disagreed with LGL's
  own membership report.
- **Giving means gifts, on one definition across the Giving tab.** Dues, grant
  payments and purchases (Pot Auction sales, category 6134) are in none of the
  donor count, the chart or the table. They are on Membership, Grants and
  Operations. Mixing them in made "Gifts in 2026" read 273 for what were dues
  payments.
- **Whatever a board member reads should open in the system it came from, wherever
  possible.** Asked for by Kyle on 2026-10-31, as a standing rule for everything
  built from here: a record's name opens that record, and a figure opens the list
  behind it, in LGL or QuickBooks. New panels ship with their links rather than
  gaining them later. Use `LglLink` for LGL, which also keeps names behind LGL's own
  login. When search criteria cannot describe a set of records, `gids/<id>,<id>` can:
  it opens exactly those gifts, and LGL's Pledged tile then shows their remaining
  balance. LGL's constituent search has no equivalent that matched, so Donors, Not
  auto-renew and the household counts stay plain. Use `QboLink` for QuickBooks, whose
  URLs are `qbo.intuit.com/app/register?accountId=<id>` and
  `reportv2?rptId=PANDL` or `rptId=ACCTL_QUICKREPORT&account=<id>,<id>&account_incl_subs=false`,
  each with `date_macro=custom&low_date=MM/DD/YYYY&high_date=MM/DD/YYYY`. These dates
  only take on the `reportv2?rptId=` route, not on `report/builder` or
  `reportv2?token=`. Budget vs. Actuals always reopens as the whole year by month, so it
  backs the budget's name rather than a figure, and the Budget and Projected columns
  stay plain. Links name no company: someone signed in to several, such as a bookkeeper,
  sees the one they have open.
- **A number links into LGL only if the search lands on the same count.** Each
  pattern was run on 2026-10-31 and is pinned in `test/community.test.ts`.
  Where no search matches, the number stays plain: the closest LGL search for
  donors returns 27 people against the dashboard's 25, so that card links to the
  gifts and says "their 65 gifts" instead. "Not auto-renew" has no link for the
  same reason, and neither does the Overview's "No dues on record". **LGL's
  constituent search finds people who have a matching gift, never people who have
  none**, tried on 2026-11-01 against 16, 7 and 9: `ni-gct/<ids>` means "has a gift
  outside these categories" (24, 12 and 15), `comb/and:not` is ignored (33, the
  auto-renew count), and Gift categories with Number of gifts = 0 finds nobody. Do
  not try these again without a new LGL feature. So ask the positive question
  instead: "Renew by hand" links to members ending in the window who paid
  Memberships dues a year earlier, `gift_from/…/gift_to/…/in-gct/6081`, from a
  month before a year ago through the window's end a year ago. It returned 7 for 7,
  and the same search with 6096 returned 33 for 33.
- **The Overview does not lead with the funding gap or with "money available".**
  Decided 2026-11-01, Kyle's view and offered as one perspective. "Money available
  now" added rebuild money to programming money and read as if spending were the
  goal. The gap is so large that leading with it is demoralizing, and it barely moves:
  HPIC applies for a grant every month or two, dues and gifts will not close it, and
  Galen tells the board about any traction with a funder, so nobody opens this page to
  check on it. So the Overview leads with what changes between visits. The gap stays on
  the Rebuild tab, one click away and never hidden. No applications line: that is still
  Alex's 2026-08-14 scope, and Galen's updates are the channel.
- **Whether LGL and QuickBooks agree is reported, never explained away.**
  `worker/src/reconcile.ts` sets the two snapshots side by side for the completed
  months. One cent is a difference, with no threshold, like Operations. Either read
  incomplete means nothing was compared, never an empty table that looks like agreement.
  A renamed QuickBooks line reports "not compared". Its lines are found by the names
  in `QBO_PL_GROUPS` ("Membership dues", "Grants") and the excluded rebuild income.
- **Figures are exact and only their display is rounded.** `usd` shows whole
  dollars everywhere (decided 2026-10-31). The Worker keeps cents and totals use
  them, so a column can differ from its printed total by a dollar; the page
  footer says so.

### Operations (income and spending against budget)

`worker/src/operations.ts`. Decided 2026-10-30: accrual basis, no variance
flagging threshold, groupings agreed by Kyle and set in `QBO_PL_GROUPS`. Decided
2026-10-31: differences are coloured by whether they are favorable, every one of
them because there is no threshold, and always say over or under in words.

"Net operating income" here means income less spending on day-to-day accounts, with
rebuild money out. It is the line QuickBooks prints as Net Operating Revenue, as does
the 2027 draft budget, because HPIC's rebuild accounts sit below it in Other Revenue
and Other Expenditures.

- **Every column covers the completed months only.** An October 30 read
  reports through September 30. A month in progress is never compared with a
  full month's budget.
- **Budget to date comes from a budget entered by month, or not at all.**
  Never divide a yearly budget by twelve: HPIC's money is seasonal (First
  Fridays run May to October) and lumpy (insurance lands in one month), so an
  even split misreads exactly the months the board asks about. A budget
  entered any other way shows its full-year figure only. Two active budgets
  for the same year are ambiguous and are not chosen between.
- **Operating figures render only when every account with activity is
  grouped or excluded.** An ungrouped account might be rebuild money; counted
  as day-to-day income it overstates the year. This is the "total cash renders
  only when every account reads" rule, for the profit and loss. Listing a
  parent groups its sub-accounts, so only a new top-level account trips it.
- **`exclude` keeps rebuild money out, visibly.** What was excluded, and how
  much, is printed under the table.
- **QuickBooks' own section totals are checked, month by month, in cents.**
  A mismatch means the report layout is not what the parser expects, and the
  tab goes unavailable rather than showing a misread.
- **A projection is its own kind of figure**, neither `ok` nor `provisional`:
  actual to date plus budget for the months left. Labelled on the card and the
  column, never added to cash or to any funded figure.
- **Dates come from QuickBooks.** The fiscal year from the report's period,
  "today" from its `Header.Time`. In a fiscal year's first month, nothing has
  completed, so the previous year is shown in full.

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
after the award landed).

**LGL's `Installment` type (13) is a schedule, not money** (verified 2026-10-31).
Two operating awards use it. An installment carries an amount and a parent but no
`received_date` or category, and LGL does not mark one when a payment arrives:
4Culture's $7,936 payment is a separate Gift beside two undated $7,936
installments. So only a dated child counts as received, and an undated one is
reported as scheduled.

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

### What QuickBooks holds about grants, read 2026-10-31

From one temporary GET-only read of transactions since January 2023, never
committed and removed the same day. This settles the "what does the LGL sync
create" question and what the bookkeeping conversation has to change.

- **Plan and settings:** QuickBooks Online Plus, so Projects and Class are both
  available. `ProjectsEnabled` is true and no project exists. Billable expense
  tracking is on, and all 615 Purchase and Bill lines are `NotBillable`. QuickBooks
  calls customers "Donors" here, and there are 877, nearly all of them people.
- **Nothing ties spending to a grant.** None of the 138 Purchase and Bill lines in
  rebuild accounts names a customer or project. Almost all carry the class
  "Building Reconstruction", which says rebuild, not which grant. 138 lines in
  nearly four years is small enough to tag by hand.
- **Projects, not bare Customers.** A funder can hold several awards (Commerce 2,
  Arts & Culture 3, the City 2 or more), so one Customer per award does not fit the
  customers that already exist. One Project per award under its funder does, and
  this refines the 2026-09-06 decision without changing its reasoning.
- **Spent has to read transactions, not the profit and loss.** Year-end journal
  entries post large amounts to the rebuild accounts, so a report total is not what
  was spent on a grant. What those entries do has not been checked.
- **Received is half there.** Grant money entered by hand is a SalesReceipt whose
  customer is the funder: Commerce reads $485,000 and Garneau-Nicon $10,000, both
  matching LGL. **The LGL sync loses the funder:** its two grant payments so far
  ($38,000 and $2,750) are SalesReceipts under one customer, "General LGL
  Constituent", with the right item and class. Commerce's two awards cannot be told
  apart either way.
- **Two records this explains.** 4Culture has two $7,936 SalesReceipts (July 28 and
  August 4, 2026) and a $7,936 Purchase on August 24 posted to the Grants income
  account, which looks like a double entry being reversed; it is the same figure
  the draft budget's reviewer asked about. And there is one $7,500 receipt on
  2025-01-17, into US Bank Checking and coded Grants, which bears on gifts 906707
  and 909414 in KYLE-TODO.

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

### Beyond grants: membership, giving and events, verified 2026-10-30

Membership and giving are read by the Membership and Giving tabs; events are not
read yet.

- **Auto-renew is the `Membership-Recurring` gift category (6096).** It is not a
  field on the membership. Verified 2026-10-31: all 395 cash gifts in it are by
  card with an external ID, all 125 repeat payments fall about a year apart, a
  member's current record starts the same day as their latest dues gift for 544 of
  555, and 508 active members have one, matching HPIC's own saved search "Members-
  Recurring Billing" exactly. A household member's latest dues gift is their soft
  credit on the shared payment, so they renew the way it does. Of 125 lapsed
  members only 11 were on it. The dashboard reads the latest gift and LGL's search
  asks about any gift ever, so someone who left auto-renew would differ; nobody
  active does today.
- **Household is a relationship, not a level.** `expand=relationships` on
  `constituents/search` returns them without a request per member (an empty array
  when there are none). Decided 2026-10-31: in a household means linked as
  Household or Spouse/Partner to another active member, followed through people.
  570 members were 438 in 173 households and 132 individuals. The dues tiers ($20
  individual, $40 household; $100 and $200 for Champion, plus 3% when the payer
  covers the fee) agree for all but 16 of the 555 with a dues gift.
- **LGL's own search URLs are not documented, but they are stable paths.** Gifts:
  `/fundraising/search/gt/gift/phase/1,12/campaign/846/ni-category/6076,6134/from/2026-01-01/to/2026-12-31`;
  asking for `phase/13` also lists the pledges above those installments.
  Constituents: `/constituents/search/comb/and:and/members/1`, plus `member_type/396`,
  or `md_fl/latest/md_type/end/me_from/…/me_to/…/memberd/1` (the `memberd/1` is what
  makes the dates apply; leave it off and they are silently ignored), or
  `in-gct/6096/in-gifts_type/1,7,8,9,12`. Constituent results load after the page,
  so a `fetch` sees no count; open the page to check one.

- **Membership records hang off constituents, and LGL can list who is active.**
  `/memberships` returns 404 and `/membership_levels` has only names (Classic,
  Champion, Minor), but `constituents/search` takes `q[]=membership_status=1`
  (1 Active, 0 Lapsed) and `expand=memberships`, each record carrying
  `membership_level_name`, `date_start` and `finish_date`. Verified 2026-10-31:
  the 563 it returns are exactly the people with a record covering that day, so
  its Active means an unexpired record. Nearly all records run 365 days. It also
  listed 126 Lapsed.
- **Why the members who paid no dues this year are members** (293 of 563 on
  2026-10-31): 248 were soft-credited on someone else's Memberships gift in the
  last 12 months, a household sharing one payment. Most of the other 45 joined
  in November or December 2025, through dues then or through the Annual Fund
  Drive, which issues memberships too: 13 of its 60 December 2025 gifts ($1,108)
  are coded to a Membership category.
- **Dues are gifts in campaign 846 "Memberships"**, and they cluster May to
  October, peaking in September. Dues gifts count payers, not members.
- **Donors exclude dues, grant payments and category 6134 "Merchandise"**, which
  is how Pot Auction sales are coded (34 of 58 non-dues givers in 2026, 33 of
  whom gave nothing else). Sponsors count. A member who also made a gift counts.
  Live on 2026-10-31: 25, so most of a year's donors arrive with the December
  drive (76 in all of 2025, 63 of them that December).
- **"New" is a first membership record starting this year**: 203 on 2026-10-31.
  Records go back to 2017, though only 157 people's first record predates 2025,
  so someone long-standing but entered late can look new, less so each year.
- **Gift history before 2025 is almost empty** (31 cash gifts), so a year-over-year
  comparison only works from 2025 on.
- **Its dues agree with QuickBooks.** LGL's Memberships campaign for Jan to Sept
  2026 is $15,238; the QuickBooks figure in the 2027 draft budget's actuals
  column is $15,280.
- **The Annual Fund Drive lands in December** ($15,905 in Dec 2025) and is the
  largest non-grant inflow of the year.
- **`/events` is readable**, 21 events since 2025, with 117 cash gifts linked by
  `event_id`. `financial_goal` is set on 5 events and `projected_amount` on none.
- **The 2026 budget appears to live in QuickBooks.** The 2027 draft is an
  export of a QuickBooks Budget vs. Actuals report (accrual basis, dated
  2026-10-12), edited in Excel.

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

**A rotated refresh token has now been seen live too.** Intuit returns the same
token on most refreshes and rotates it roughly daily. On the production connection
`/admin/status` shows `refresh token rotated` at 2026-10-31 07:00 UTC, with every
hourly refresh succeeding since. So the property that matters most, that a
*rotated* value is re-stored, holds in production as well as in
`worker/test/tokens.test.ts`.

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
  each with a subtotal. Balances matched QuickBooks' Balance Sheet to the cent on 2026-10-30.
- **Phase 2, LGL grant funnel: live, and all three stages render.** Pledged is
  authoritative; Received and Outstanding are computed from payment records and
  marked `provisional`, pending the QuickBooks reconciliation. The
  data-quality panel names every record breaking a rule. Live figures:
  $1,471,000 / $545,000 / $926,000 on 2026-09-09, and $1,471,000 / $583,000 /
  $888,000 on 2026-10-07 after the $38,000 OAC payment arrived.
  Applied was built and removed on 2026-08-18, once Alex confirmed the tool
  starts at money awarded rather than requested. The detail list shipped
  2026-10-31 as Grant details (see Phase 5). Still to do: the campaign/fund
  restriction breakdown.
- **Phase 3, phase readiness: shipped, resting on provisional Received.** The
  panel measures cash against the Dry-in target: the grand total of the Metis
  control estimate dated 9/22/26, including Metis's 6% contractor contingency
  (the prudent figure, decided 2026-10-30), held only in the
  `CURRENT_PHASE_TARGET_COST` secret (never write the figure
  into this public repo). Its prices held to 2026-10-22, set in
  `CURRENT_PHASE_PRICES_VALID_UNTIL`, and the panel says they have lapsed.
  Awards are never added to cash; the panel shows what is
  *remaining* on reimbursable awards. Payment Terms is set on all six in-scope
  awards. What it still lacks is an authoritative Received: that needs the
  QuickBooks grant dimension (P3 below), and the figure inherits
  `provisional` until then. Percent-funded is not built: its denominator is
  unsettled, waiting on Galen. The spreadsheet received 2026-10-29 is
  byte-identical to the 9/22/26 estimate, so no re-price has arrived yet. Metis's
  own workbook taxes the contingency at 10.35% on its summary sheet and 10.55% on
  its budget sheet. The target uses the budget sheet's figure, which taxes the
  contingency at 10.55% like every other line, and is the higher of the two. Never show Metis line items: the
  estimate is for the client and project partners only.
- **Phase 4, operations: live since 2026-10-31, and confirmed against QuickBooks.**
  An Operations
  tab (seven-ish board lines, each expandable to its accounts, cumulative
  charts against budget and last year, a month-by-month table) and a "This
  year so far" panel on the Overview (net so far against budget, projected
  year-end, months of operating cash). Built from Intuit's documented layouts.
  Confirmed by the live read on 2026-10-31: the ProfitAndLoss layout,
  `date_macro=This Fiscal Year` (fiscal year 2026, through September 30), the
  `Budget` query (`Budget_FY26_P&L`), and `Active in (true, false)`, which does
  return deleted accounts. QuickBooks prints money posted directly to a parent
  account on its section's `Header.ColData`: the first read failed the
  section-total check on Expenses for March 2026, reading that header made it
  pass with nothing else changed, and the error now shows both figures if it
  recurs. **Income is confirmed for January to September 2026.** Every income
  line matches the actuals column of the 2027 draft budget to the cent, except
  a $0.93 difference on one line where the draft holds a whole-dollar figure.
  The Grants line equals LGL's three non-rebuild grant payments to the cent, so
  no rebuild money is in it, and income kept out as rebuild equals LGL's three
  rebuild payments to the cent. **Spending is confirmed too**, on 2026-10-31, against
  QuickBooks' own Statement of Activity for January to September: every line, Total
  Expenditures $28,326.80, and Net Operating Revenue $31,704.37 match. So does the
  rebuild money below it, $243,426.21 of Other Revenue and $95,954.11 of Other
  Expenditures, which is what the tab keeps out. The draft budget's spending column
  is the one that differs, not the tab.
- **Phase 5, board dashboard: built 2026-10-30.** The page was rebuilt for a
  board member who is curious rather than expert, and for a phone as well as
  a projector. Seven tabs, each in the URL hash so a link or reload keeps it:
  - **Overview**, the page to show at a meeting, rebuilt 2026-11-01: the club today
    and the last 30 days (`CommunitySnapshot.recent`), coming up (memberships ending
    in the next 90 days and the same months' giving a year earlier), day-to-day money,
    the rebuild as plain facts (awarded, received, in the rebuild accounts, never added
    together), and whether the books agree. No to-do lists and no names. Donors stay on
    Giving: most arrive with the December drive, so the count reads low most of the year.
    An account under 1% of all cash rolls into "Smaller balances" here,
    decided 2026-10-31: it stays in every total and opens in place to itemise, and
    it is a share rather than a list of names so that Undeposited Funds comes
    back on its own if deposits pile up. A failed read is never folded away.
  - **Rebuild**: the funding bar, the readiness table, cash in the rebuild accounts.
    Programming balances are on the Overview only, and total cash is not displayed.
  - **Operations**: Phase 4. The table answers one question at a time, so income
    and spending fit a phone: so far against budget, the full year, or against
    last year, three columns each.
  - **Membership** (`worker/src/community.ts`, `/api/community`, renamed from
    Community on 2026-10-31; the module kept its name since it also feeds
    Grants and the Overview): total and new members with no comparison to last
    year (Kyle found those confusing), level by household, renewals for the next
    twelve months by auto-renew or not, and the dues chart. From LGL's active
    members and one read of every gift. **Counts only; names stay in LGL** while
    the passphrase is shared, and a linked number opens behind LGL's own login.
  - **Giving** (same module and read, split out 2026-10-31): donors, the giving
    chart and giving by campaign, gifts only.
  - **Grants**, two views in the hash, `#grants` and `#grants/details`, kept apart
    for now at Kyle's request (2026-10-31). **Summary**: the funnel, and operating
    grants outside the rebuild with what is still to arrive on each (provisional,
    from linked payments). **Grant details** (`worker/src/grant-details.ts`,
    `/api/grant-details`): a card per award across every campaign, with awarded,
    spent, received and still to arrive, its payments and its schedule. Its rebuild
    totals match the funnel, which a test pins. **No notes leave the Worker**: they
    hold funder staff names and email addresses. Spent is null and reads "Not
    tracked yet", so nothing there calls a grant healthy until P3. Names come from
    a Gift custom field called "Grant Name", which does not exist yet, so the reader
    is tested only against the shapes LGL uses for other fields.
  - **Reconciliation** (named Housekeeping until 2026-11-01; `#housekeeping` still
    opens it): LGL against QuickBooks for dues, operating grants and rebuild grants, the
    data-quality list, ungrouped QuickBooks accounts, and how a grant moves through the
    systems. Its tab shows a count of blocking records, so problems are one click away
    and never hidden. Live on 2026-11-01, January to October: both grant lines match to
    the cent, and dues read $17,558.80 in LGL against $16,612.40 in QuickBooks.

  Rules carried over: the funding bar never calls awarded money available (it
  is a lighter step of the same hue, labelled "awarded, not yet received");
  the next-three-months figure is a projection labelled with its basis (the
  same months a year earlier), never added to cash. The Membership read
  is dozens of LGL requests (about 35 seconds cold, 33 of them the gift walk),
  so `TokenStore` serves it for two hours and the hourly cron rewrites it, which
  rides out one failed run (decided 2026-10-31: at 15 minutes it was cold for
  45 minutes of every hour). So LGL edits take up to an hour to reach Membership,
  the Expected card and operating grants; the Membership tab and operating grants
  print their retrieval time. It cannot read only recent gifts: operating
  awards and their payments go back years. A walk that stops at its 50-page cap
  reports nothing rather than an undercount, and is not cached, so the last
  complete read stays up until it expires. The page renders each panel as its own
  read lands, so a cold Membership read never holds up cash, and a figure still
  being read says "Reading…", never "unavailable". **Deploy the Worker before
  pushing the page** when the snapshot's shape changes: the new page crashes on
  the old Worker's response.

  **Programming cash is in scope.** Whether the dashboard should answer "how much
  can we spend on programming" and read past campaign 871 was an open decision.
  It settled itself in this phase, on purpose: the Overview shows programming cash
  and months of operating cash, Operations covers day-to-day money, and Grant
  details covers every campaign.

  **The draft budget does not get a tab** (decided 2026-10-31). Operations already
  shows actuals against the budget in QuickBooks, and a spreadsheet tab would add a
  hand-maintained source of numbers while the draft is still moving. Enter the
  approved budget in QuickBooks by month and Operations picks it up. Note that 11
  of the 23 operating lines in `Budget_FY26_P&L` are the same amount every month,
  dues and individual giving among them, though that money is seasonal. So the tab
  says so when a quarter or more of the lines are even: dues read far over budget,
  and the projection allows $1,875 of individual giving for October to December
  against a December 2025 drive of $15,905.

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
- **Grant Name and a spend-by date on Grant details.** The name reader is built
  and waits on the field. A spend-by date needs a field too, and then a read and a
  line on the card.
- **P3, Received and Spent from QuickBooks.** Blocked on the bookkeeping
  existing. One Project per award under its funder, tied to LGL by **an explicit
  map in Worker config keyed by LGL gift id**, never a naming convention: a
  renamed project must fail loudly, not detach silently. `GrantDetail.spent` and
  its place on the card are ready for it. Completeness rule:
  deposits and expenses in the rebuild accounts with no grant attribution are
  an *unattributed pool*, shown with a count and total; the roll-up "total
  grant cash received" renders only when that pool is empty.
- **P5, reimbursable spending never invoiced.** Needs P3. Expenses attributed
  to an award that LGL marks reimbursable, sitting in QuickBooks as
  `Billable`: spent, eligible, never invoiced. This is money HPIC is owed
  and hasn't asked for. Neither system can answer it alone. It belongs in the
  data-quality panel as a named list, because the fix is to send an invoice.
- **Health signals on Grant details.** Needs P3. On a reimbursable grant, spent
  minus received is what HPIC is fronting and should invoice. On one paid up front,
  received minus spent is restricted money still unspent. On either, what is left
  to spend, and spending past the award.

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
