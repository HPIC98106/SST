# Runbook — operational procedures

Click-by-click steps for the items in `KYLE-TODO.md`. Written to be followed
without remembering any of the surrounding context.

Every section ends with a verification step. **Do it.** Several of these fail
silently, and the failure only shows up later as a dashboard that looks fine
and shows nothing.

| | | |
| --- | --- | --- |
| §1 | Create the org and transfer the repo | done |
| §2 | Custom domain `sst.hpic1919.org` | decided against |
| §3 | Update `ALLOWED_ORIGIN` | done |
| §4 | Issue an LGL API key | done |
| §5 | Populate "Payment Terms" on the awards | field defined; **populating is next, and highest leverage** |
| §6 | Confirm the Intuit account survives you | before production keys |
| §7 | Rotate `ACCESS_PASSPHRASE` | as needed |
| §8 | Fix the records the data-quality panel names | ongoing |

§1–§4 are kept after completion because the procedures still apply if any of
them has to be redone.

**What is *not* changing:** the Worker URL stays
`hpic-sst.kyhuber-ft.workers.dev`. That URL is the Intuit OAuth redirect URI, so
leaving it alone means none of this touches the QuickBooks connection. The
Cloudflare account stays personal for now by decision.

---

## §1 — Create the GitHub organization and transfer the repo

> **DONE 2026-09-06.** The repo is now `HPIC98106/SST` and the dashboard is
> live at https://hpic98106.github.io/SST/ — the path is case-sensitive, and
> `/sst/` returns 404. Kept for reference.

1. Go to https://github.com/organizations/plan and choose **Free**.
2. Name it something durable and organizational — `hpic1919` matches the
   domain. Avoid anything with a person's name in it.
3. Set the billing email to an address on the org's Workspace, not a personal
   one.
4. In the **existing** repo (`kyhuber/SST`): **Settings → General**, scroll to
   **Danger Zone**, choose **Transfer ownership**.
5. Enter the new organization as the destination and confirm.

GitHub leaves a redirect behind, so existing clone URLs and links keep working.
Your local clone keeps pushing to the old remote through that redirect, but
update it anyway so nothing depends on a redirect:

```bash
git remote set-url origin https://github.com/<neworg>/SST.git
git remote -v
```

### Re-enable what the transfer turns off

A transfer disables Actions and can reset Pages. Both need turning back on.

6. **Settings → Actions → General** — allow Actions to run.
7. **Settings → Pages** — set **Source** to **GitHub Actions**. The workflow in
   `.github/workflows/deploy-pages.yml` publishes through the Actions Pages
   flow, not the legacy branch-based one.
8. **Actions** tab → *Deploy dashboard to Pages* → **Run workflow** to publish
   once without waiting for a push.

### Verify

Load `https://<neworg>.github.io/SST/`. You should get the passphrase prompt.
It will *not* show balances yet — `ALLOWED_ORIGIN` still names the old origin,
so the browser blocks the Worker call. That is expected and §3 fixes it.

---

## §2 — Point `sst.hpic1919.org` at the dashboard

> **NOT DOING THIS — decided 2026-09-06.** The board uses the github.io URL
> and the domain stays untouched on Squarespace. The only real gain was a URL
> that survives moving off GitHub Pages, which is worth little for ten people
> who can be told directly. Steps kept because the decision is cheap to
> reverse: doing this later costs one CNAME, one Pages setting, and redoing
> §3 with the new origin.

No nameserver change. The domain stays on Squarespace; you are adding one
record.

1. In the transferred repo: **Settings → Pages → Custom domain**, enter
   `sst.hpic1919.org`, and **Save**. GitHub commits a `CNAME` file to the repo.
2. In Squarespace: **Settings → Domains → hpic1919.org → DNS Settings**.
3. Add a record:
   - Type: `CNAME`
   - Host: `sst`
   - Data: `<neworg>.github.io`  ← the organization, not `kyhuber`
4. Save, then wait. Propagation is usually minutes but can take up to an hour.
5. Back in **Settings → Pages**, wait for the DNS check to go green, then tick
   **Enforce HTTPS**. The certificate is issued automatically; the tickbox stays
   greyed out until DNS resolves, which is the usual reason this looks broken.

### Verify

```bash
nslookup sst.hpic1919.org
```

Should resolve to GitHub. Then load `https://sst.hpic1919.org` — passphrase
prompt, still no balances until §3.

---

## §3 — Update `ALLOWED_ORIGIN` and redeploy the Worker

> **DONE 2026-09-06** (`3f72c8b`, worker version `8ecb3025`). Set to
> `https://hpic98106.github.io`, not the custom domain in the original steps
> below, since §2 was decided against. Re-run this whenever the Pages origin
> moves.

The Worker only answers browsers from an origin it recognises. Until this
lands, the dashboard loads but every data call fails CORS — and that failure
is silent from the server's side: the page renders perfectly and nothing is
logged as an error. It is worth knowing that symptom, because it looks like a
data problem rather than a hosting one.

1. Edit `worker/wrangler.toml` — the origin is whatever is in the address bar,
   scheme included and no trailing slash:

```toml
ALLOWED_ORIGIN = "https://hpic98106.github.io"
```

2. Deploy — from `worker/`, and note this is deliberately manual because the
   Worker holds every credential:

```bash
cd worker
npx wrangler deploy
```

3. Commit the change.

### Verify

Open `https://sst.hpic1919.org`, enter the passphrase, and confirm balances
render. That single check exercises the whole chain: Pages → DNS → CORS →
Worker → QuickBooks. If the page loads but the panel shows an error, open the
browser console — a CORS message means `ALLOWED_ORIGIN` and the address bar do
not match exactly, including the `https://` and any trailing slash.

---

## §4 — Issue a Little Green Light API key

> **DONE 2026-08-19.** A dedicated key is issued and set as a Worker secret,
> and the funnel reads live. Kept for the rotation procedure.

1. In LGL, open **Settings → Integration Settings** and find the API section.
   (Verify the exact path in LGL's current UI; it moves between releases.)
2. Generate a **new** key for this tool. Do not reuse the membership lookup
   tool's key — `worker/wrangler.toml` says so explicitly, and one shared key
   means rotating it breaks both tools at once.
3. Store it in the Worker, from `worker/`, in Git Bash and never PowerShell:

```bash
printf '%s' 'THE-KEY' | npx wrangler secret put LGL_API_KEY
```

PowerShell's pipe appends a carriage return that becomes part of the secret.
Every comparison then fails while looking correct.

### Verify

```bash
npx wrangler secret list
```

`LGL_API_KEY` should appear. Values are never shown — secrets are write-only,
so record the key in your password manager before you set it.

---

## §5 — Populate "Payment Terms" on the grant awards

> **The field itself is done** — defined in LGL on 2026-09-09. What remains is
> data entry, and it is still the highest-leverage item on the list: it clears
> the largest blocking finding on the dashboard's data-quality panel (**6
> awards, $1,471,000, every one reading "unknown"**) and it is the single gate
> on Phase 3.

### What was decided, and why it looks like this

LGL scopes a custom field by **item type**, and "Gift" is the finest grain it
offers — **Pledge is not an available item type**, which answers the question
this section used to ask, in the negative. So the field is necessarily visible
on all ten gift types, ordinary donations included.

That is cosmetic rather than dangerous. Blank reads as unknown and is never
assumed spendable, and the dashboard only reads the field on awards already
inside the grant scope, so a value on a donor pledge is never looked at.

The field is a single-select on Gift named **`Payment Terms`**, with three
options:

| Option | Dashboard reads it as |
| --- | --- |
| `Reimbursable` | reimbursable — not spendable until received |
| `Payment in full` | not reimbursable |
| `Distribution payments` | not reimbursable |

The two non-reimbursable options collapse to one status on purpose. The only
distinction that changes a number here is whether HPIC has to spend before the
money arrives; LGL stays the record of what the funder actually agreed to, and
having the terms written down gives the funnel something to check the observed
payments against.

**The name is load-bearing.** LGL gives every field an organisation creates a
UUID key, so `worker/src/lgl.ts` matches on the field *name*. Renaming it in
LGL admin stops the dashboard reading it and the awards silently revert to
"unknown". If it ever needs a different name, add the new one to
`PAYMENT_TERMS_KEYS` first.

**The picklist is closed by contract.** Adding a fourth option in LGL without
adding it to `toReimbursableStatus` corrupts nothing — the award lands in the
"payment terms cannot be read" exception with the value quoted back — but it
will not be counted until the code is taught to read it.

### Do this

1. Populate `Payment Terms` on the six Rebuild awards. Two are already known
   from their notes: the $10,000 Garneau-Nicon award says "Reimbursable grant
   for Rebuild project", and the $50,000 Department of Neighborhoods award's
   proposal says HPIC submits for reimbursement after spending.
2. While you are in there, populate the four Programs grants too. They sit
   outside the dashboard's current scope so nothing displays them today — but
   it is four extra records now against a data cleanup later if programming
   ever comes into scope.
3. Still outstanding from the original plan: define `contract_signed` the same
   way. Nothing reads it yet. The $388,000 Building for the Arts award is in
   pre-award contracting, and that state is currently only findable in a
   freetext note.

### Verify

**Populate one award first, then stop and check.** Until some record has a
value the field is invisible to the API — LGL only returns a gift's
`custom_fields` once something is set on it — so one populated award is the
only way to confirm that the field name and option spellings match what the
code expects.

Then reload the dashboard and check all three:

- "Awards with no payment terms set" drops by one record.
- The **Awarded, by reimbursable status** table moves that amount out of the
  "unknown" row.
- **No "Awards whose payment terms cannot be read" panel appears.** If one
  does, it quotes the exact string LGL holds — either correct the spelling in
  LGL to match the table above, or tell Claude the value and it gets added to
  the mapping.

Nothing needs redeploying: the field is read by name at runtime, so populating
records lights the feature up with no code change.

---

## §6 — Confirm the Intuit developer account survives you

The account is registered to `kyle.huber@hpic1919.org`, already on the
organization's Google Workspace. That is the right side of the line. The
remaining risk is that it is a personal mailbox: if the account is deleted when
you step back, recovery could be awkward.

Pick whichever is easier:

- **Confirm a Workspace admin can recover the mailbox** (or that you are the
  admin and someone else also has admin rights), or
- **Move the Intuit login to a role address** such as `tech@hpic1919.org`, with
  the mailbox delegated to whoever holds the role.

Do this before applying for production keys. Re-registering a redirect URI on an
existing app takes two minutes; moving an *approved* app to a different
developer account, and redoing Intuit's self-assessment questionnaire, does not.

### Verify

Sign in to the Intuit developer portal with the account and confirm the app
`hpic-sst` is listed, along with its Development keys.
---

## §7 — Rotate `ACCESS_PASSPHRASE`

This is the credential the whole board uses. It went wrong once on 2026-09-06
and took far longer to diagnose than it should have, so the procedure below is
written to fail loudly instead.

**It cannot be looked up.** Cloudflare secrets are write-only by design. If
nobody has it, the only path is to set a new one and tell everyone.

Two things have to end up identical: the Worker secret, and
`ACCESS_PASSPHRASE` in `worker/.dev.vars` (local dev only). Nothing checks that
they agree, and a mismatch surfaces later as a 401 that looks like a rotation
problem rather than a typo.

Run this from anywhere in Git Bash. It sets the secret, then **verifies against
the deployed Worker before writing the local file**, so the two cannot drift:

```bash
cd /c/Users/kyhub/Desktop/hpic/SST/worker && read -rsp 'New passphrase: ' P && echo && printf '%s' "$P" | npx wrangler secret put ACCESS_PASSPHRASE && code=$(curl -s -o /dev/null -w "%{http_code}" https://hpic-sst.kyhuber-ft.workers.dev/api/grants -H "X-HPIC-Auth: $P") && echo "Worker says: HTTP $code" && if [ "$code" = "200" ]; then { grep -v '^ACCESS_PASSPHRASE=' .dev.vars; printf 'ACCESS_PASSPHRASE=%s\n' "$P"; } > .dev.vars.new && mv .dev.vars.new .dev.vars && echo "Match. Both updated."; else echo "MISMATCH — do not trust the local file."; fi; unset P
```

Why it is shaped that way, all learned the hard way:

- **`read -rsp`** keeps the value off the screen and out of shell history.
- **Git Bash, never PowerShell.** PowerShell's native-command pipe appends a
  carriage return that becomes part of the secret; every comparison then fails
  while looking correct.
- **`printf '%s'`**, not `sed`, writes the local file. `sed` interprets its
  replacement, so a value containing `|`, `&` or a backslash is silently
  mangled — recreating the exact drift this is meant to prevent.
- **Absolute path, and no path inside a quoted script body.** Git Bash rewrites
  path-shaped *arguments* for native binaries but not paths embedded in
  strings, so `node -e '...open("/c/...")'` resolves to `C:\c\Users\...` and
  fails. See CLAUDE.md's Shell section.
- **No secret survives on a version that is not deployed.** If
  `wrangler secret put` reports *"the latest version of your worker isn't
  currently deployed"*, run `npx wrangler deploy` first and set it again.

### Verify

Open https://hpic98106.github.io/SST/ and enter the new passphrase. Then put it
in the shared password manager — see the standing item in `KYLE-TODO.md` about
this being the one credential the board cannot recover without you.

---

## §8 — Fix the LGL records the data-quality panel names

The dashboard lists these with a direct link to each record. Fixing one and
watching the row disappear on the next read is worth doing once deliberately:
it is the clearest possible demonstration that the tool is a worklist and not
just a report.

**Safe to do without asking anyone.** Both restore a relationship that was
clearly intended, rather than asserting a judgment about what money is:

1. **Link each unlinked payment to its award.** Open the payment in LGL and set
   its parent to the matching pledge. Two of the three are straightforward; the
   $7,500 Office of Arts & Culture payment is not — see below.
2. **Backfill the campaign on the two Commerce payments** (gifts `906802` and
   `903696`) to **Rebuild Project**. The dashboard does not need this — it
   reaches the campaign by walking up to the award — but LGL's own campaign
   reports understate by $372,429.71 without it.

**Do not do without talking to Galen:**

3. **The two Seattle Public Utilities compost records** ($1,500 each). They are
   fee-for-service, not grants, so they do not belong in the grant category at
   all — but a note on one says it was recoded to Grant *specifically to match
   the QuickBooks record*. Changing it back would break an agreement someone
   made on purpose. This is a conversation, not an edit.

4. **The $7,500 Office of Arts & Culture payment** (gift `906707`) is noted as
   an "Addition to 2025 CARE grant award", and **no 2025 CARE award exists in
   LGL** — the only CARE record is a $3,400 pledge for 2026. There is nothing
   to link it to. This is a missing award record, and the first concrete
   instance of the development committee's reconciliation backlog.

### Verify

Reload the dashboard. Each fixed record should drop out of its exception, and
"Payments not linked to an award" should fall from 3 records / $10,500. If
Received rises, that is correct and expected — the payment was always real, it
just could not be attributed to an award.

