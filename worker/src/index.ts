/**
 * HPIC single source of truth — Cloudflare Worker.
 *
 * The security boundary is this Worker, not the dashboard URL. The frontend is
 * a static shell that holds no credentials, no account identifiers, and no
 * financial data; everything it shows comes from here, and only after the
 * shared passphrase checks out. Someone who finds the Pages URL sees nothing.
 *
 * Three endpoints of substance: GET /api/funds (cash, from QuickBooks),
 * GET /api/operations (the year's income and spending against budget, also
 * QuickBooks) and GET /api/grants (the grant funnel, from Little Green Light).
 */

import { AUTH_HEADER, authorize, checkPassphrase } from "./auth";
import { getCommunity } from "./community";
import { getGrants } from "./lgl";
import { handleCallback, handleStart } from "./oauth";
import { getOperations, parseGroupConfig, readSetup, resolveGroup } from "./operations";
import { PURPOSE_LABELS, getFunds, listAssetAccounts, parseAccountConfig } from "./qbo";
import { TokenStore } from "./tokens";
import type { Env } from "./types";

export { TokenStore };

/**
 * How long a snapshot is served before we call QuickBooks again. The spec
 * calls for no manual refresh step: the board opens the page and sees current
 * data, with a defined cache interval behind it.
 */
const CACHE_TTL_MS = 15 * 60_000;

/**
 * Membership and giving take about 35 seconds to read and change on a human
 * timescale, so this snapshot is served for longer. It has to outlast the
 * hourly cron that rewrites it, or most of each hour would read cold. Two
 * hours rides out one failed run; a second one lets the snapshot expire and
 * the next page load reads LGL itself. The page prints the retrieval time.
 */
const COMMUNITY_CACHE_TTL_MS = 2 * 60 * 60_000;

/** The single Durable Object instance that owns the QuickBooks tokens. */
function tokenStore(env: Env) {
  return env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName("qbo"));
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": `${AUTH_HEADER}, Content-Type`,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, env: Env, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Financial figures should not sit in browser or intermediary caches.
      "Cache-Control": "no-store",
      ...corsHeaders(env),
    },
  });
}

export default {
  /**
   * Hourly keep-alive (see the [triggers] block in wrangler.toml).
   *
   * Refreshes the QuickBooks connection whether or not anyone visits, so the
   * refresh token never goes stale between board meetings, and leaves a warm
   * snapshot for the next page load. Failures land in the token event log
   * rather than surfacing for the first time in front of the board.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(keepAlive(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // The one state-changing action in the application: revoking our own
    // QuickBooks authorization at the user's request. It changes nothing in
    // HPIC's accounting data — it ends this app's access to it.
    if (request.method === "POST" && url.pathname === "/admin/disconnect") {
      return handleDisconnect(request, env);
    }

    if (request.method !== "GET") {
      // Nothing else in this application writes anywhere. Refuse other verbs
      // outright rather than letting a future edit quietly add one.
      return json({ error: "Method not allowed" }, env, 405);
    }

    switch (url.pathname) {
      // Liveness only. Deliberately reveals nothing about the connection or
      // the data behind it.
      case "/api/health":
        return json({ ok: true }, env);

      case "/api/funds": {
        if (!authorize(request, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return handleFunds(env);
      }

      case "/api/operations": {
        if (!authorize(request, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return handleOperations(env);
      }

      // Members, donors and giving, from LGL's records. Counts only:
      // no names leave the Worker, because the passphrase is shared.
      case "/api/community": {
        if (!authorize(request, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return handleCommunity(env);
      }

      // Phase 2. Behind the same passphrase, and read-only like everything
      // else. No snapshot cache yet: grant records change on a human timescale
      // and the read is cheap, so caching would add a staleness question with
      // nothing to show for it.
      case "/api/grants": {
        if (!authorize(request, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return json(await getGrants(env), env);
      }

      // Setup tool, not part of the board dashboard: lists chart-of-accounts
      // IDs so operating and rebuild fund can be mapped. Behind the same
      // passphrase, and read-only like everything else.
      case "/admin/accounts": {
        const supplied = url.searchParams.get("k") ?? request.headers.get(AUTH_HEADER);
        if (!checkPassphrase(supplied, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return handleAccountList(env);
      }

      // Setup tool, like /admin/accounts: lists income and expense accounts
      // so they can be grouped onto the Operations tab's lines.
      case "/admin/pl-accounts": {
        const supplied = url.searchParams.get("k") ?? request.headers.get(AUTH_HEADER);
        if (!checkPassphrase(supplied, env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        return handlePlAccountList(env);
      }

      // Diagnostic view: what the token machinery has actually been doing.
      case "/admin/status": {
        if (!checkPassphrase(url.searchParams.get("k") ?? request.headers.get(AUTH_HEADER), env)) {
          return json({ error: "Not authorized" }, env, 401);
        }
        const store = tokenStore(env);
        const [status, events, endpoints] = await Promise.all([
          store.status(),
          store.events(),
          store.getEndpoints(),
        ]);
        return json(
          { ...status, environment: env.QBO_ENV, mode: env.QBO_MODE, endpoints, events },
          env,
        );
      }

      // Confirmation page for the disconnect. A GET never revokes anything;
      // it renders a form that POSTs.
      case "/admin/disconnect": {
        if (!checkPassphrase(url.searchParams.get("k"), env)) {
          return htmlPage("Not authorized", "<p>Wrong or missing passphrase.</p>", 401);
        }
        const status = await tokenStore(env).status();
        if (!status.seeded) {
          return htmlPage(
            "Not connected",
            `<p>QuickBooks is not currently connected, so there is nothing to disconnect.</p>`,
          );
        }
        return htmlPage(
          "Disconnect QuickBooks",
          `<p>This revokes this dashboard's access to QuickBooks. Balances stop appearing ` +
            `immediately, and reconnecting requires signing in to QuickBooks and granting ` +
            `consent again.</p>` +
            `<form method="POST" action="/admin/disconnect">` +
            `<input type="hidden" name="k" value="${escapeHtml(url.searchParams.get("k") ?? "")}">` +
            `<button type="submit">Disconnect QuickBooks</button></form>`,
        );
      }

      case "/oauth/start":
        return handleStart(request, env, tokenStore(env));

      case "/oauth/callback":
        return handleCallback(request, env, tokenStore(env));

      default:
        return json({ error: "Not found" }, env, 404);
    }
  },
};

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem}` +
      `code{background:#f1f1f1;padding:.1em .35em;border-radius:3px}` +
      `button{font:inherit;padding:.55rem .9rem;border:1px solid #8f2419;background:#8f2419;` +
      `color:#fff;border-radius:5px;cursor:pointer}</style>` +
      `<h1>${title}</h1>${body}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/** Revokes the QuickBooks authorization. Reached only via POST. */
async function handleDisconnect(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const supplied = String(form.get("k") ?? "") || request.headers.get(AUTH_HEADER);
  if (!checkPassphrase(supplied, env)) {
    return htmlPage("Not authorized", "<p>Wrong or missing passphrase.</p>", 401);
  }

  const result = await tokenStore(env).revoke();
  return htmlPage(
    "QuickBooks disconnected",
    `<p>${escapeHtml(result.detail)}</p>` +
      `<p>The dashboard will now report that QuickBooks needs to be reconnected rather than ` +
      `showing figures. To reconnect, open <code>/oauth/start</code> with the passphrase.</p>`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Renders the account list as a table, since a human reads this to configure IDs. */
async function handleAccountList(env: Env): Promise<Response> {
  const result = await listAssetAccounts(env, tokenStore(env));

  const html = (body: string) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>QuickBooks asset accounts</title>` +
        `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:3rem auto;padding:0 1rem}` +
        `table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #ddd}` +
        `th{font-size:.8rem;text-transform:uppercase;color:#666}code{background:#f1f1f1;padding:.1em .35em;border-radius:3px}` +
        `.num{text-align:right;font-variant-numeric:tabular-nums}.mapped{background:#eef7ee}` +
        `.inactive{color:#999}</style>${body}`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );

  if (!result.ok) {
    return html(`<h1>QuickBooks asset accounts</h1><p>${escapeHtml(result.detail)}</p>`);
  }

  const { configs, invalid } = parseAccountConfig(env.QBO_ACCOUNTS);
  const mapped = new Map(configs.map((c) => [c.id, c.purpose]));

  const rows = result.accounts
    .map((a) => {
      const balance = a.balanceWithSubAccounts ?? a.balance;
      const purpose = mapped.get(a.id);
      const which = purpose ? ` ← ${PURPOSE_LABELS[purpose].toLowerCase()}` : "";
      const classes = [purpose ? "mapped" : "", a.active ? "" : "inactive"]
        .filter(Boolean)
        .join(" ");
      return (
        `<tr class="${classes}"><td><code>${escapeHtml(a.id)}</code>${which}</td>` +
        `<td>${escapeHtml(a.name)}${a.active ? "" : " (inactive)"}</td>` +
        `<td>${escapeHtml(a.accountType)}</td><td>${escapeHtml(a.accountSubType)}</td>` +
        `<td class="num">${balance === null ? "n/a" : balance.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td></tr>`
      );
    })
    .join("");

  return html(
    `<h1>QuickBooks asset accounts</h1>` +
      `<p>List every account that holds cash, each tagged <code>rebuild</code> or <code>programming</code>. ` +
      `It is one Worker secret, not a <code>wrangler.toml</code> var, and an account left off it is left out of every total:</p>` +
      `<p><code>printf '%s' "rebuild:&lt;id&gt;,rebuild:&lt;id&gt;,programming:&lt;id&gt;" | npx wrangler secret put QBO_ACCOUNTS</code></p>` +
      (invalid.length > 0
        ? `<p><strong>Unreadable entries in QBO_ACCOUNTS:</strong> ${invalid.map((i) => escapeHtml(i.reason)).join(" ")}</p>`
        : "") +
      `<table><tr><th>ID</th><th>Name</th><th>Type</th><th>Sub-type</th><th class="num">Balance</th></tr>${rows}</table>`,
  );
}

/**
 * Lists income and expense accounts with the group each one lands in, so
 * `QBO_PL_GROUPS` can be written and checked. The IDs, like asset account IDs,
 * appear nowhere in the QuickBooks UI.
 */
async function handlePlAccountList(env: Env): Promise<Response> {
  const result = await readSetup(env, tokenStore(env));

  const html = (body: string) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>QuickBooks income and expense accounts</title>` +
        `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:64rem;margin:3rem auto;padding:0 1rem}` +
        `table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}th,td{text-align:left;padding:.35rem .6rem;border-bottom:1px solid #ddd}` +
        `th{font-size:.8rem;text-transform:uppercase;color:#666}code{background:#f1f1f1;padding:.1em .35em;border-radius:3px}` +
        `.grouped{background:#eef7ee}.excluded{background:#f4f1ea}.ungrouped{background:#fdecea}.inactive{color:#999}` +
        `.inherited{color:#666}</style>${body}`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );

  if (!result.ok) {
    return html(`<h1>QuickBooks income and expense accounts</h1><p>${escapeHtml(result.detail)}</p>`);
  }

  const config = parseGroupConfig(env.QBO_PL_GROUPS);
  const explicit = new Map<string, string>();
  for (const g of config.groups) for (const id of g.ids) explicit.set(id, g.label);
  for (const id of config.excluded) explicit.set(id, "exclude");
  const parents = new Map(result.accounts.map((a) => [a.Id, a.ParentRef?.value]));

  const rows = result.accounts
    .filter((a) => a.Classification === "Revenue" || a.Classification === "Expense")
    .sort((a, b) =>
      (a.Classification ?? "").localeCompare(b.Classification ?? "") * -1 ||
      (a.FullyQualifiedName ?? a.Name).localeCompare(b.FullyQualifiedName ?? b.Name),
    )
    .map((a) => {
      const group = resolveGroup(a.Id, parents, explicit);
      const inherited = group !== null && !explicit.has(a.Id);
      const cls = [
        group === null ? "ungrouped" : group === "exclude" ? "excluded" : "grouped",
        a.Active === false ? "inactive" : "",
      ].join(" ");
      const label =
        group === null
          ? "not grouped"
          : group === "exclude"
            ? "kept out of operating figures"
            : escapeHtml(group);
      const depth = (a.FullyQualifiedName ?? a.Name).split(":").length - 1;
      return (
        `<tr class="${cls}"><td><code>${escapeHtml(a.Id)}</code></td>` +
        `<td style="padding-left:${0.6 + depth * 1.4}rem">${escapeHtml(a.Name)}${a.Active === false ? " (inactive)" : ""}</td>` +
        `<td>${a.Classification === "Revenue" ? "Income" : "Spending"}</td>` +
        `<td${inherited ? ' class="inherited"' : ""}>${label}${inherited ? " (from its parent)" : ""}</td></tr>`
      );
    })
    .join("");

  const budgets =
    result.budgets === null
      ? `<p>The budgets could not be read: ${escapeHtml(result.budgetNote ?? "")}</p>`
      : result.budgets.length === 0
        ? "<p>No budgets in QuickBooks yet.</p>"
        : `<table><tr><th>Budget</th><th>Period</th><th>Entered</th><th>Active</th></tr>${result.budgets
            .map(
              (b) =>
                `<tr><td>${escapeHtml(b.Name ?? b.Id ?? "")}</td><td>${escapeHtml(b.StartDate ?? "?")} to ${escapeHtml(b.EndDate ?? "?")}</td>` +
                `<td>${escapeHtml(b.BudgetEntryType ?? "not stated")}</td><td>${b.Active === false ? "no" : "yes"}</td></tr>`,
            )
            .join("")}</table>`;

  return html(
    `<h1>QuickBooks income and expense accounts</h1>` +
      `<p>Each account lands on one board line on the Operations tab. List groups in display order, separated by ` +
      `<code>;</code>, each a label and the account IDs it takes. A parent account brings its sub-accounts with it ` +
      `unless one is listed elsewhere. A label can hold income and spending accounts both. ` +
      `<code>exclude</code> keeps accounts out of operating figures altogether, for rebuild money. ` +
      `Every account with activity has to land somewhere, or the Operations figures stay blank and name it.</p>` +
      `<p><code>printf '%s' "Memberships=&lt;id&gt;;Events and programs=&lt;id&gt;,&lt;id&gt;;exclude=&lt;id&gt;" | npx wrangler secret put QBO_PL_GROUPS</code></p>` +
      (config.invalid.length > 0
        ? `<p><strong>Unreadable entries in QBO_PL_GROUPS:</strong> ${config.invalid.map(escapeHtml).join(" ")}</p>`
        : "") +
      `<table><tr><th>ID</th><th>Account</th><th>Side</th><th>Group</th></tr>${rows}</table>` +
      `<h2>Budgets</h2>` +
      `<p>The Operations tab uses the one active profit and loss budget that starts on the fiscal year's first day. ` +
      `It must be entered by month for budget-to-date and the projection to show.</p>` +
      budgets,
  );
}

/**
 * Fetch a fresh snapshot on a schedule. Any token refresh happens as a side
 * effect of asking for an access token, which is the point.
 */
async function keepAlive(env: Env): Promise<void> {
  if (env.QBO_MODE !== "live") return;

  const store = tokenStore(env);
  const snapshot = await getFunds(env, store);

  if (snapshot.connection === "ok" && snapshot.accounts.some((a) => a.status === "ok")) {
    await store.putCachedSnapshot(snapshot);
  }
  await store.recordScheduledRun(snapshot.connection);

  // After the run is recorded, so a failure here cannot hide whether the
  // connection itself is healthy.
  try {
    const operations = await getOperations(env, store);
    if (operations.connection === "ok" && operations.status === "ok") {
      await store.putCachedOperations(operations, env.QBO_PL_GROUPS ?? "");
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "operations_warm_failed", detail: String(error) }));
  }

  if (env.LGL_MODE === "live") {
    try {
      const community = await getCommunity(env);
      if (community.status === "ok") await store.putCachedCommunity(community);
    } catch (error) {
      console.error(JSON.stringify({ event: "community_warm_failed", detail: String(error) }));
    }
  }
}

async function handleCommunity(env: Env): Promise<Response> {
  const store = tokenStore(env);
  if (env.LGL_MODE === "live") {
    const cached = await store.getCachedCommunity(COMMUNITY_CACHE_TTL_MS);
    if (cached) return json({ ...cached.snapshot, cached: true }, env);
  }
  const snapshot = await getCommunity(env);
  if (snapshot.status === "ok" && snapshot.connection === "ok") await store.putCachedCommunity(snapshot);
  return json(snapshot, env);
}

async function handleOperations(env: Env): Promise<Response> {
  const store = tokenStore(env);
  const configKey = env.QBO_PL_GROUPS ?? "";

  const cached = await store.getCachedOperations(CACHE_TTL_MS, configKey);
  if (cached) {
    return json({ ...cached.snapshot, cached: true }, env);
  }

  const snapshot = await getOperations(env, store);
  // Only a complete read is cached, for the same reason as the cash snapshot.
  if (snapshot.connection === "ok" && snapshot.status === "ok") {
    await store.putCachedOperations(snapshot, configKey);
  }
  return json(snapshot, env);
}

async function handleFunds(env: Env): Promise<Response> {
  const store = tokenStore(env);

  const cached = await store.getCachedSnapshot(CACHE_TTL_MS);
  if (cached) {
    return json({ ...cached.snapshot, cached: true }, env);
  }

  const snapshot = await getFunds(env, store);

  // Only cache a good read. Caching a failure would keep an outage on screen
  // for fifteen minutes after QuickBooks recovered.
  const worthCaching =
    snapshot.connection === "ok" && snapshot.accounts.some((a) => a.status === "ok");
  if (worthCaching) {
    await store.putCachedSnapshot(snapshot);
  }

  return json(snapshot, env);
}
