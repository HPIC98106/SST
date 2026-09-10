# Meeting: Alex, 2026-09-10

First time Alex sees the dashboard. He is the key HPIC partner on this, he is
excited, and he has offered to help clean up data.

Galen (grants) and Rachel (QuickBooks) come after this one, and what Alex
agrees to here shapes both. Capture sections at the bottom feed straight into
those two agendas.

**Fill this in during or right after the meeting.** Blank prompts are there to
be answered, not admired.

---

## The one goal

**Alex should leave understanding that the product is the honesty, not the
numbers.**

His instinct on seeing a dashboard will be to read the figures. But the figures
are mostly provisional or sandbox. What is finished, and what is actually
valuable, is the machinery that refuses to turn a gap into a clean number.

- Landed if he says something like *"this tells us what we don't know about our
  own money."*
- Did not land if he says *"nice numbers."*

Everything else in this document serves that.

---

## Before you open the laptop

- [ ] Load the dashboard yourself and confirm it reads right after yesterday's
      changes. https://hpic98106.github.io/SST/ (case-sensitive path)
- [ ] Have the passphrase ready to type. Do not read it aloud.
- [ ] Open the LGL awards list in a second tab, so the six-award ask can be
      done live if he is willing.
- [ ] Decide in advance: are you giving him the passphrase today? See the
      durability item below.

---

## Agenda

Roughly 45 minutes. The order matters: caveats before numbers, story before
ask.

| | Item | Minutes |
| --- | --- | --- |
| 1 | The sandbox caveat, said out loud | 2 |
| 2 | What this is for: the $888,000 story | 5 |
| 3 | Walk the dashboard, Alex driving | 15 |
| 4 | Decision: where does Received come from? | 10 |
| 5 | The ask: six awards | 5 |
| 6 | Durability: the passphrase | 5 |
| 7 | Setting up Galen and Rachel | 5 |

### On the readiness panel at the top

Added 2026-09-10. **Do show it**, and let it carry item 2. Earlier advice in
this file said not to demo phase readiness; that applied to a version that
produced a single confident number, and this one does not. It shows the three
figures side by side and refuses to add them, which is the argument rather than
a preview of it.

What it says today is the point: cash is real but from the sandbox, no award is
classified, $1,471,000 sits in "terms unknown", and the target cost has not
arrived. Every blank on that panel is one of the asks in this meeting.

**Do not promise when it turns green.** It needs Metis, it needs Alex's data
entry, and it needs production keys. Two of those three are not yours.

---

## 1. The sandbox caveat, first

Say this before he reads a single number:

> The cash panel at the top is real QuickBooks data, but from Intuit's sandbox
> company, not HPIC's books. Every figure in it is invented. The grant numbers
> below it are real.

There is a banner on the page saying so, but say it anyway. If he anchors on a
cash figure and finds out later it was fake, it costs credibility on the grant
figures too, and those are the real ones.

Same for the word **provisional** on Received and Outstanding. Name it before
he has to ask.

---

## 2. What this is for: the $888,000 story

This is the single best explanation of why the tool exists. Use it early.

Two of the largest awards are cost-reimbursement with no signed contract:

| Award | Amount | State |
| --- | --- | --- |
| City of Seattle | $500,000 | Not appropriated yet. Sitting in Finance General awaiting a supplemental. |
| Building for the Arts (WA Commerce) | $388,000 | Pre-award contracting. No contract signed. |

On a cost-reimbursement award HPIC must spend first and invoice afterwards. So
that $888,000 does not reduce the working capital needed to start construction.
It changes who ultimately bears the cost, not whether work can begin.

**A dashboard that added those into a single "available" figure would tell the
board HPIC is $888,000 more ready than it is.** That is the specific failure
this tool was built to prevent, and it is why awards with unknown terms are
shown as unknown rather than assumed spendable.

### Keep this one in your back pocket

If he asks *"why not just use LGL's own reports?"*:

LGL's campaign reports would show **$372,429.71 less** against the Rebuild
campaign than HPIC actually received, because two of the three payments on the
$485,000 Commerce award carry no campaign. This dashboard finds them by
following the payment up to its award. That gap is on the page, marked
advisory, with both records named.

---

## 3. Walk the dashboard, with Alex driving

**Hand him the screen and stop talking.** He is the first person who is not you
to read this. What you learn from watching him is worth more than anything you
can explain.

Current figures, so you are not hunting for them:

| | |
| --- | --- |
| Pledged | $1,471,000 · 6 records · authoritative |
| Received | $545,000 · 5 records · provisional |
| Outstanding | $926,000 · provisional |
| Data quality | 9 records flagged, 2 blocking |

The exceptions panel:

| Finding | Severity | Records |
| --- | --- | --- |
| Payments not linked to an award | blocking | 3 · $10,500 |
| Awards with no payment terms set | blocking | 6 · $1,471,000 |
| Payments with no campaign | advisory | 2 · $372,429.71 |

**Watch for two specific things, and write down what you see:**

- Does **provisional** read as *useful but unconfirmed*, or as *broken*?
- Is the **blocking vs advisory** split obvious without you explaining it?

No test covers either. This is the only way to find out.

Where he hesitates, note it:

```
Hesitated at:


Misread:


Asked about:

```

---

## 4. The decision to get: where does Received come from?

**This is the one decision that matters today.** Everything marked provisional
hangs on it.

The position to put to him: **QuickBooks is authoritative for cash.** LGL is
authoritative for what was awarded, which is why Pledged is not provisional.

The evidence, all of it visible on the page:

- 3 of 11 payment records carry no link to their award, so summing LGL payments
  undercounts by $10,500.
- Two of those are a fee-for-service compost event recoded into the Grant
  category, so reading the category flat overcounts by $3,000.
- A note on one says the recoding was done deliberately so the record would
  match the QuickBooks entry. **The bookkeeping already treats QuickBooks as
  authoritative.** That is the strongest argument in the pile, and it came from
  HPIC's own records.

**What you actually need from Alex is not the technical judgment. It is
organizational cover**, because the answer implies asking Rachel to change how
the books are kept: one Customer per grant, applied at entry time.

So ask it that way:

> I think QuickBooks has to be the source for cash, and that means asking
> Rachel to code every grant deposit and expense to a customer. Do you agree,
> and will you back that ask?

```
His answer:


Concerns he raised:


Will he back the Rachel ask?  yes / no / needs more

```

---

## 5. The ask: six awards, fifteen minutes

He offered to help with data. Give him the smallest piece with the most visible
payoff, not the whole cleanup list. One finished task builds a habit; a long
list builds avoidance.

**The ask:** set **Payment Terms** on the six Rebuild awards in LGL. It is a
dropdown with three options: `Reimbursable`, `Payment in full`,
`Distribution payments`.

Start him on Garneau-Nicon, where the note already contains the answer, and let
him watch the blocking finding drop from 6 records to 5.

| Gift | Amount | Funder | What the evidence says | Terms |
| --- | --- | --- | --- | --- |
| [904066](https://hpic.littlegreenlight.com/gifts/904066) | $10,000 | Garneau-Nicon | Note says outright "Reimbursable grant for Rebuild project". **Start here.** | |
| [903691](https://hpic.littlegreenlight.com/gifts/903691) | $485,000 | WA Commerce (LCP) | Paid in 3 irregular draws. Looks like reimbursement claims against actual spend. Confirm with Galen. | |
| [909194](https://hpic.littlegreenlight.com/gifts/909194) | $50,000 | Seattle DoN | One full payment, but the proposal reportedly described reimbursement after spending. Check the parent Goal. | |
| [906602](https://hpic.littlegreenlight.com/gifts/906602) | $38,000 | Office of Arts & Culture | No note, no payments. Must be asked. | |
| [905452](https://hpic.littlegreenlight.com/gifts/905452) | $388,000 | WA Commerce (BFA) | Pre-award contracting, terms not final. **Leaving unset is correct.** | |
| [905997](https://hpic.littlegreenlight.com/gifts/905997) | $500,000 | City of Seattle | Not appropriated. Nobody can know yet. **Leave unset.** | |

Worth saying explicitly: **two of these should stay blank.** Unknown is a real
answer here, not a missing one. That is the whole design, and it is a good
moment to make the point concrete.

```
Set during the meeting:


Alex will follow up on:


Needs Galen:

```

---

## 6. Durability: the passphrase

Raise this even though it is not urgent.

The passphrase is the one credential every board member needs, and it currently
exists in one person's head. Cloudflare secrets are write-only, so there is no
recovery path: if you are unavailable, the board loses access to their own
dashboard and nobody can get it back.

This is the same durability problem that motivated moving the repo into the
HPIC organization. Alex is the right person to solve it, and raising it signals
you are building something meant to outlast you, which tends to land well with
a board partner.

Options: a shared password manager, or the HPIC Google Workspace.

```
Where it will live:


Who has it:

```

---

## 7. Setting up Galen and Rachel

The easiest thing to under-use in this meeting. What you want is not only
Alex's own input, but that the next two asks arrive with his endorsement rather
than as *"Kyle wants us to change how we work."*

Ask him directly: **"Will you introduce these, or should I?"**

```
Answer:

```

---

## If there is time: the concepts sheet

https://claude.ai/code/artifact/73463f41-2570-4a73-bae0-129ad80da865

Source is `docs/concept-sheet-2026-09-10.html`, committed so the sheet outlives
one person's Claude account. The artifact is the shareable link; the file is the
copy anyone can edit or re-host.

Five sketches of what the single source of truth could cover beyond cash and
grants: construction spend, reimbursement exposure, operating runway, events,
membership. **Every figure on it is invented and the page says so in three
places.** It is drawn as a drafting sheet precisely so it cannot be mistaken
for the live dashboard.

Open it *after* the real dashboard, never alongside. The whole value of the
real thing is that nothing on it is made up, and that distinction is easy to
blur if both are on screen at once.

What it is actually for is one finding: **three of the five ideas need the same
single change**, the QuickBooks dimension that says which grant or project a
transaction belongs to. That reframes the Rachel ask from one feature to three,
which is a much better trade than it looks from outside.

Membership is the only one needing nobody's permission. It comes out of LGL and
is blocked on a policy question rather than a system change: what counts as an
active member.

The sheet ends with four questions for the board. The last one matters most:
**what is missing from it?** Five ideas came from one person.

```
Which would he actually open:


Worth the bookkeeping change?  yes / no


What is missing:

```

## Do not

- **Do not demo Phase 3.** Phase readiness does not exist. It is blocked on the
  general contractor's Dry-in target cost and on an authoritative Received,
  neither of which you control. Describing it turns into an expectation with a
  timeline you cannot hold. If it comes up: *"that is next, and it needs two
  things we do not have yet."*
- **Do not let it become a data-entry session.** If he wants to fix records
  beyond the six, capture them and move on. Limited time with the key partner
  is better spent on decisions than on typing.
- **Do not recode the SPU compost records**, and do not agree to. A note says
  they were coded that way deliberately to match QuickBooks. That is a
  conversation with Galen, not a fix.
- **Do not promise a custom domain or a login system.** Both were considered
  and decided against, and reopening them in this meeting costs the agenda.

---

## Questions he is likely to ask

**"Are these numbers right?"**
Pledged is authoritative. Received and Outstanding are computed from LGL and
not yet reconciled against QuickBooks, which is exactly what provisional means.
The cash panel is sandbox and entirely invented.

**"Why does it say unknown instead of just picking one?"**
Because an award defaulted to spendable is the failure that would overstate
readiness to the board. Unknown is a real state, and two of the six awards
genuinely are unknown today.

**"Can the board see this?"**
Yes, with the passphrase. The page is public; the data is not. That is item 6.

**"When is it done?"**
Phase 1 and 2 are built. Phase 3 needs the target cost and an authoritative
Received. There is no deadline, and the tool is useful now.

**"What do you need from me?"**
The Received decision, the six awards, and cover for the Galen and Rachel
conversations. In that order.

---

# Capture

Fill this in after the meeting. This is what feeds the next two.

## Decisions made

```


```

## What surprised me about how he read it

```


```

## Things he corrected me on

```


```

## New work this created

```


```

---

## Seeds for the Galen meeting (grants)

Pre-loaded from what is already known. Add to it from the capture above.

- Payment terms on the awards Alex could not answer, especially the $485,000
  Commerce LCP draw pattern and the $38,000 Office of Arts & Culture award.
- The SPU compost records recoded into the Grant category. A note says it was
  deliberate, to match QuickBooks. Do not change it unilaterally; find out what
  the agreement was.
- The 3 payments not linked to an award, $10,500 total.
- The 2 Commerce payments missing their campaign, $372,429.71.
- Whether any grants are still tracked only on the manual spreadsheet. The
  dashboard says it shows what is in LGL, not HPIC's complete grant history,
  and Galen would know the gap.

```
Added from the Alex meeting:


```

## Seeds for the Rachel meeting (QuickBooks)

- One Customer per grant award, applied at entry time, on both deposits and
  expenses. This is the single change that unlocks an authoritative Received
  and a Spent figure at once.
- Customer rather than Class, because billable expenses attach to a customer
  and `BillableStatus` then answers "was this reimbursable spending ever
  invoiced" without anyone reconstructing it by hand.
- Applied inconsistently this is worse than not at all: a half-attributed total
  understates spending while looking complete. Worth agreeing that it starts on
  a date and applies to everything after it.
- Production QuickBooks keys, which need an Intuit self-assessment. Until then
  the cash panel stays sandbox.

```
Added from the Alex meeting:


```
