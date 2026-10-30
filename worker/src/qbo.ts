/**
 * QuickBooks Online reads. Everything in this file is a GET against the
 * Accounting API — the dashboard is read-only by design and must never write
 * to QuickBooks.
 *
 * Balances come from the Account entity. There is no dedicated balance
 * endpoint, and the bank-feed "Bank balance" shown in the QuickBooks UI is not
 * exposed by the API at all; what we get is the QuickBooks book balance (the
 * "In QuickBooks" figure). That is the right number for this dashboard — QBO is
 * the system of record — but the UI labels it honestly rather than calling it
 * a bank balance.
 *
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account
 */

import type {
  AccountPurpose,
  AccountSnapshot,
  Env,
  FundsSnapshot,
  PurposeSubtotal,
} from "./types";
import { FIXTURE_RETRIEVED_AT, fixtureAccount } from "./fixtures";
import type { TokenStore } from "./tokens";

const BASE_URLS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
} as const;

/**
 * Minor versions 1-74 were discontinued on August 1, 2025; anything below 75
 * is ignored and answered as 75, and an unspecified version also defaults to
 * 75 today. Pin it explicitly so a future change to that default cannot move
 * the data under us without a code change.
 */
const MINOR_VERSION = "75";

export interface QboAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  AccountSubType?: string;
  Classification?: string;
  CurrentBalance?: number;
  CurrentBalanceWithSubAccounts?: number;
  Active?: boolean;
  SubAccount?: boolean;
  MetaData?: { LastUpdatedTime?: string };
}

interface QboAccountResponse {
  Account: QboAccount;
  /** QuickBooks' own response timestamp — the honest retrieval time. */
  time: string;
}

export type AccountReadResult =
  | { ok: true; account: QboAccount; time: string }
  | { ok: false; kind: "unauthorized" | "not_found" | "error"; detail: string };

export interface AccountConfig {
  id: string;
  purpose: AccountPurpose;
}

/** A `QBO_ACCOUNTS` entry that could not be used, and why. */
export interface InvalidAccountEntry {
  raw: string;
  reason: string;
}

/** Display order on the panel: rebuild first, since readiness is measured against it. */
const PURPOSES: AccountPurpose[] = ["rebuild", "programming"];

export const PURPOSE_LABELS: Record<AccountPurpose, string> = {
  rebuild: "Rebuild",
  programming: "Programming",
};

/** Used in fixture mode when no accounts are configured, so the UI has something to show. */
const FIXTURE_ACCOUNTS = "rebuild:36,rebuild:37,programming:35";

export const SOURCE_LABEL = "QuickBooks Online, book balance";

/**
 * Parse `QBO_ACCOUNTS`.
 *
 * A bad entry is returned rather than skipped. Skipping it would drop an
 * account from every total without a word, and a typo'd rebuild account would
 * show up as the rebuild being poorer than it is. A duplicate is rejected for
 * the opposite reason: counted twice, it overstates cash.
 */
export function parseAccountConfig(raw: string | undefined): {
  configs: AccountConfig[];
  invalid: InvalidAccountEntry[];
} {
  const configs: AccountConfig[] = [];
  const invalid: InvalidAccountEntry[] = [];
  const seen = new Set<string>();

  for (const entry of (raw ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const match = /^(rebuild|programming):(\d+)$/.exec(entry);
    if (!match) {
      invalid.push({
        raw: entry,
        reason: `"${entry}" is not of the form rebuild:<id> or programming:<id>.`,
      });
      continue;
    }
    const [, purpose, id] = match;
    if (seen.has(id)) {
      invalid.push({ raw: entry, reason: `Account ${id} is listed more than once, so it would be counted twice.` });
      continue;
    }
    seen.add(id);
    configs.push({ id, purpose: purpose as AccountPurpose });
  }

  return { configs, invalid };
}

/** Anything but an explicit "production" is a sandbox — never guess upward. */
export function qboEnvironment(env: Env): "sandbox" | "production" {
  return env.QBO_ENV === "production" ? "production" : "sandbox";
}

function baseUrl(env: Env): string {
  return BASE_URLS[qboEnvironment(env)];
}

/**
 * Write one failed QuickBooks call to the Worker log, as a single JSON line.
 *
 * The dashboard shows an account's error only until the next read succeeds, so
 * without this a failure that fixed itself leaves no trace to share with Intuit
 * support. `intuit_tid` is the field their support team asks for. Deliberately
 * excluded: the access token, the company (realm) ID and the request URL, so a
 * log line can be pasted into a support case as it stands.
 */
function logQboFailure(
  operation: string,
  fields: { status?: number; intuitTid?: string; detail?: string },
): void {
  console.error(JSON.stringify({ event: "qbo_error", operation, ...fields }));
}

/** Intuit's error body, trimmed. Read for the log only; it never reaches the dashboard. */
async function errorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Read a single account by ID. */
async function readAccount(
  env: Env,
  accessToken: string,
  accountId: string,
): Promise<AccountReadResult> {
  const url =
    `${baseUrl(env)}/v3/company/${env.QBO_REALM_ID}` +
    `/account/${encodeURIComponent(accountId)}?minorversion=${MINOR_VERSION}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    logQboFailure("account_read", { detail: `Could not reach QuickBooks: ${String(error)}` });
    return { ok: false, kind: "error", detail: `Could not reach QuickBooks: ${String(error)}` };
  }

  // intuit_tid identifies the request in Intuit's logs; worth surfacing when
  // someone has to open a support case.
  const tid = response.headers.get("intuit_tid") ?? "none";

  if (response.status === 401) {
    logQboFailure("account_read", { status: 401, intuitTid: tid, detail: await errorBody(response) });
    return { ok: false, kind: "unauthorized", detail: "Access token rejected" };
  }
  if (!response.ok) {
    logQboFailure("account_read", {
      status: response.status,
      intuitTid: tid,
      detail: await errorBody(response),
    });
    const kind = response.status === 404 || response.status === 400 ? "not_found" : "error";
    return {
      ok: false,
      kind,
      detail: `QuickBooks returned ${response.status} (intuit_tid: ${tid})`,
    };
  }

  const body = (await response.json()) as QboAccountResponse;
  if (!body.Account) {
    logQboFailure("account_read", { status: response.status, intuitTid: tid, detail: "Response had no Account" });
    return { ok: false, kind: "error", detail: "QuickBooks response had no Account" };
  }
  return { ok: true, account: body.Account, time: body.time };
}

const usdFormat = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Until QuickBooks has been read, the ID is all we know an account by. */
function placeholderLabel(config: AccountConfig): string {
  return `QuickBooks account ${config.id}`;
}

/**
 * Turn one account read into a display row.
 *
 * We show CurrentBalanceWithSubAccounts as the headline: it equals
 * CurrentBalance when an account has no sub-accounts, and when it does have
 * them it is the number a treasurer means by "the rebuild fund". Where the two
 * differ we say so, so that the account mapping gets reviewed rather than
 * silently misread.
 */
function toSnapshot(config: AccountConfig, result: AccountReadResult): AccountSnapshot {
  if (!result.ok) {
    return {
      key: config.id,
      purpose: config.purpose,
      label: placeholderLabel(config),
      status: "unavailable",
      balance: null,
      hasSubAccounts: false,
      note:
        result.kind === "not_found"
          ? "Account not found in QuickBooks: check the configured account ID."
          : result.detail,
    };
  }

  const { account } = result;
  const label = account.FullyQualifiedName ?? account.Name;
  const rollup = account.CurrentBalanceWithSubAccounts;
  const own = account.CurrentBalance;
  const balance = rollup ?? own;

  if (typeof balance !== "number") {
    return {
      key: config.id,
      purpose: config.purpose,
      label,
      status: "unavailable",
      balance: null,
      hasSubAccounts: false,
      note: "QuickBooks returned no balance for this account. Balances are only valid for balance-sheet accounts.",
    };
  }

  const hasSubAccounts =
    typeof rollup === "number" && typeof own === "number" && rollup !== own;

  const notes: string[] = [];
  if (hasSubAccounts) notes.push(`Includes sub-accounts. This account alone is ${usdFormat(own!)}.`);
  // Undeposited Funds is QuickBooks' holding account for payments recorded but
  // not yet deposited. It counts as cash, but it is not in any bank, and a
  // balance that sits there for long is usually a deposit never recorded.
  if (account.AccountSubType === "UndepositedFunds") {
    notes.push("Payments recorded in QuickBooks but not yet deposited to a bank.");
  }

  return {
    key: config.id,
    purpose: config.purpose,
    label,
    status: "ok",
    balance,
    hasSubAccounts,
    note: notes.length > 0 ? notes.join(" ") : undefined,
  };
}

/** A row for a `QBO_ACCOUNTS` entry that could not be parsed. */
function invalidRow(entry: InvalidAccountEntry): AccountSnapshot {
  return {
    key: entry.raw,
    purpose: null,
    label: "Unreadable account configuration",
    status: "unavailable",
    balance: null,
    hasSubAccounts: false,
    note: `${entry.reason} Fix QBO_ACCOUNTS on the Worker.`,
  };
}

/** An account row for when we could not authenticate at all. */
function connectionUnavailable(config: AccountConfig, detail: string): AccountSnapshot {
  return {
    key: config.id,
    purpose: config.purpose,
    label: placeholderLabel(config),
    status: "unavailable",
    balance: null,
    hasSubAccounts: false,
    note: detail,
  };
}

/**
 * Sum a set of accounts, or refuse to.
 *
 * Returns null unless every account reported successfully. A total that
 * silently drops a failed account understates cash, and in the readiness panel
 * a rebuild figure missing one account makes a phase look further off than it
 * is. Better to show nothing and say why.
 */
function sumIfComplete(
  accounts: AccountSnapshot[],
  whenEmpty: string,
): { total: number | null; note?: string } {
  if (accounts.length === 0) return { total: null, note: whenEmpty };
  const missing = accounts.filter((a) => a.status !== "ok");
  if (missing.length === accounts.length) {
    return { total: null, note: "No account balances could be read." };
  }
  if (missing.length > 0) {
    return {
      total: null,
      note: `Not shown: ${missing.map((a) => a.label).join(", ")} could not be read, so any total would understate cash.`,
    };
  }
  return { total: accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0) };
}

/**
 * Total cash on hand, and the subtotal for each purpose.
 *
 * An unparseable config entry blocks every figure, not just the total: there
 * is no telling which group the account it meant belongs to, and a rebuild
 * subtotal quietly missing an account is the number readiness is built on.
 */
function totals(
  accounts: AccountSnapshot[],
  invalid: InvalidAccountEntry[],
): Pick<FundsSnapshot, "subtotals" | "totalCash" | "totalCashNote"> {
  if (invalid.length > 0) {
    const note = "The account configuration has an entry that cannot be read, so an account may be missing from this figure.";
    return {
      subtotals: PURPOSES.map((purpose) => ({ purpose, label: PURPOSE_LABELS[purpose], total: null, note })),
      totalCash: null,
      totalCashNote: note,
    };
  }

  const subtotals: PurposeSubtotal[] = PURPOSES.map((purpose) => {
    const { total, note } = sumIfComplete(
      accounts.filter((a) => a.purpose === purpose),
      `No account is configured as ${PURPOSE_LABELS[purpose].toLowerCase()} cash.`,
    );
    return { purpose, label: PURPOSE_LABELS[purpose], total, note };
  });
  const { total, note } = sumIfComplete(accounts, "No QuickBooks accounts have been configured yet.");
  return { subtotals, totalCash: total, totalCashNote: note };
}

export interface AccountListEntry {
  id: string;
  name: string;
  accountType: string;
  accountSubType: string;
  balance: number | null;
  balanceWithSubAccounts: number | null;
  active: boolean;
  isSubAccount: boolean;
}

/**
 * List the company's asset accounts, for mapping operating and rebuild fund to
 * their QuickBooks IDs.
 *
 * This exists because chart-of-accounts IDs are not visible anywhere in the
 * QuickBooks UI, and they have to be configured before the dashboard shows a
 * single number. It is a setup tool, not part of the board-facing dashboard.
 */
export async function listAssetAccounts(
  env: Env,
  store: DurableObjectStub<TokenStore>,
): Promise<{ ok: true; accounts: AccountListEntry[] } | { ok: false; detail: string }> {
  const token = await store.getAccessToken();
  if (!token.ok) {
    return {
      ok: false,
      detail:
        token.reason === "needs_reauth"
          ? "QuickBooks needs to be reconnected. Visit /oauth/start."
          : "QuickBooks is not connected. Visit /oauth/start.",
    };
  }

  // Classification is a filterable field. Active is filtered below rather than
  // in the query, to keep the query string simple and hard to get wrong.
  const statement = "select * from Account where Classification = 'Asset'";
  const url =
    `${baseUrl(env)}/v3/company/${env.QBO_REALM_ID}/query` +
    `?query=${encodeURIComponent(statement)}&minorversion=${MINOR_VERSION}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token.accessToken}` },
    });
  } catch (error) {
    logQboFailure("account_list", { detail: `Could not reach QuickBooks: ${String(error)}` });
    return { ok: false, detail: `Could not reach QuickBooks: ${String(error)}` };
  }

  if (!response.ok) {
    const tid = response.headers.get("intuit_tid") ?? "none";
    logQboFailure("account_list", {
      status: response.status,
      intuitTid: tid,
      detail: await errorBody(response),
    });
    return { ok: false, detail: `QuickBooks returned ${response.status} (intuit_tid: ${tid})` };
  }

  const body = (await response.json()) as { QueryResponse?: { Account?: QboAccount[] } };
  const accounts = (body.QueryResponse?.Account ?? []).map((a) => ({
    id: a.Id,
    name: a.FullyQualifiedName ?? a.Name,
    accountType: a.AccountType ?? "",
    accountSubType: a.AccountSubType ?? "",
    balance: typeof a.CurrentBalance === "number" ? a.CurrentBalance : null,
    balanceWithSubAccounts:
      typeof a.CurrentBalanceWithSubAccounts === "number"
        ? a.CurrentBalanceWithSubAccounts
        : null,
    active: a.Active !== false,
    isSubAccount: a.SubAccount === true,
  }));

  return { ok: true, accounts };
}

/** Assemble the Phase 1 funds snapshot. */
export async function getFunds(env: Env, store: DurableObjectStub<TokenStore>): Promise<FundsSnapshot> {
  if (env.QBO_MODE === "fixture") {
    return fixtureSnapshot(env);
  }

  const { configs, invalid } = parseAccountConfig(env.QBO_ACCOUNTS);

  const token = await store.getAccessToken();
  if (!token.ok) {
    const detail =
      token.reason === "needs_reauth"
        ? "QuickBooks needs to be reconnected. Visit /oauth/start to re-authorize."
        : token.detail ?? "QuickBooks has never been connected. Visit /oauth/start to authorize.";
    const accounts = [
      ...configs.map((c) => connectionUnavailable(c, detail)),
      ...invalid.map(invalidRow),
    ];
    return {
      accounts,
      ...totals(accounts, invalid),
      retrievedAt: null,
      cached: false,
      source: SOURCE_LABEL,
      // Never report "ok" when we could not reach QuickBooks at all. A panel
      // full of blanks under a healthy-looking status is the kind of quiet
      // dishonesty this dashboard exists to avoid.
      connection: token.reason === "needs_reauth" ? "needs_reauth" : "not_connected",
      environment: qboEnvironment(env),
    };
  }

  let results = await Promise.all(
    configs.map(async (c) => ({
      config: c,
      result: await readAccount(env, token.accessToken, c.id),
    })),
  );

  // A token we believed was valid can still be rejected — for instance if it
  // expired between our expiry check and the call. Force one refresh and retry
  // only the calls that failed that way.
  if (results.some((r) => !r.result.ok && r.result.kind === "unauthorized")) {
    const retryToken = await store.getAccessToken(true);
    if (retryToken.ok) {
      results = await Promise.all(
        results.map(async (r) => {
          if (r.result.ok || r.result.kind !== "unauthorized") return r;
          return {
            config: r.config,
            result: await readAccount(env, retryToken.accessToken, r.config.id),
          };
        }),
      );
    }
  }

  const accounts = [
    ...results.map((r) => toSnapshot(r.config, r.result)),
    ...invalid.map(invalidRow),
  ];

  const firstSuccess = results.find((r) => r.result.ok);
  const retrievedAt = firstSuccess?.result.ok ? firstSuccess.result.time : null;

  return {
    accounts,
    ...totals(accounts, invalid),
    retrievedAt,
    cached: false,
    source: SOURCE_LABEL,
    connection: "ok",
    environment: qboEnvironment(env),
  };
}

/** Fixture mode: exercises the whole UI before any credentials exist. */
function fixtureSnapshot(env: Env): FundsSnapshot {
  const { configs, invalid } = parseAccountConfig(env.QBO_ACCOUNTS || FIXTURE_ACCOUNTS);
  const accounts = [
    ...configs.map((c) => toSnapshot(c, fixtureAccount(c.id))),
    ...invalid.map(invalidRow),
  ];
  return {
    accounts,
    ...totals(accounts, invalid),
    retrievedAt: FIXTURE_RETRIEVED_AT,
    cached: false,
    source: `${SOURCE_LABEL} (fixture data)`,
    connection: "fixture",
    environment: qboEnvironment(env),
  };
}
