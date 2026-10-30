/**
 * The Operations tab: the year's income and spending against budget.
 *
 * What is pinned here is mostly where the code must refuse a number:
 *
 *  - a month still in progress is never compared with a full month's budget;
 *  - a budget not entered by month never yields budget-to-date, because an
 *    even split by twelve misreads every seasonal month;
 *  - an account with activity that no group claims withholds every operating
 *    figure, because it might be rebuild money;
 *  - excluded (rebuild) money is kept out of every figure, and named;
 *  - a report whose lines do not sum to QuickBooks' own totals is rejected.
 *
 * And, as everywhere in this Worker, that every request is a GET.
 */

import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthEndpoints } from "../src/endpoints";
import {
  assembleOperations,
  getOperations,
  parseGroupConfig,
  parseProfitAndLoss,
  type OperationsInputs,
  type ParsedReport,
  type QboReport,
} from "../src/operations";
import {
  FIXTURE_FIGURES,
  FIXTURE_GROUPS,
  buildBudget,
  buildProfitAndLoss,
  fixtureAccounts,
  fixtureQbo,
  linesFrom,
} from "../src/operations-fixtures";
import type { Env, OperationsSnapshot } from "../src/types";

const BASE = { connection: "ok", environment: "production" } as const;
const SPENDING_IDS = ["401", "402", "403", "404", "411", "412", "413", "414"];

function parse(report: QboReport): ParsedReport {
  const parsed = parseProfitAndLoss(report);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.report;
}

function fixtureInputs(overrides: Partial<OperationsInputs> = {}): OperationsInputs {
  const raw = fixtureQbo();
  return {
    accounts: raw.accounts,
    report: parse(raw.thisYear),
    comparison: parse(raw.lastYear),
    budgets: raw.budgets,
    showingPriorYear: false,
    ...overrides,
  };
}

const assemble = (overrides: Partial<OperationsInputs> = {}, groups = FIXTURE_GROUPS) =>
  assembleOperations(fixtureInputs(overrides), parseGroupConfig(groups), BASE);

const group = (snapshot: OperationsSnapshot, label: string, side: "income" | "spending" = "income") =>
  snapshot.groups.find((g) => g.label === label && g.side === side);

const total = (values: number[] | undefined, from = 0, to = 12) =>
  (values ?? []).slice(from, to).reduce((a, b) => a + b, 0);

describe("QBO_PL_GROUPS", () => {
  it("reads groups in order, with exclude kept apart", () => {
    const parsed = parseGroupConfig("Memberships=301; Events and programs=310,400 ;exclude=330");
    expect(parsed.invalid).toEqual([]);
    expect(parsed.groups).toEqual([
      { label: "Memberships", ids: ["301"] },
      { label: "Events and programs", ids: ["310", "400"] },
    ]);
    expect(parsed.excluded).toEqual(["330"]);
  });

  it("rejects a malformed entry rather than skipping it", () => {
    const parsed = parseGroupConfig("Memberships=301;Events and programs 310");
    expect(parsed.invalid).toHaveLength(1);
    expect(parsed.invalid[0]).toContain("Events and programs 310");
  });

  it("rejects an account listed under two groups, which would count it twice", () => {
    const parsed = parseGroupConfig("Memberships=301;Other=320,301");
    expect(parsed.invalid[0]).toContain("Account 301");
    expect(parsed.invalid[0]).toContain("counted twice");
  });

  it("rejects a group listed twice", () => {
    expect(parseGroupConfig("Other=320;other=302").invalid[0]).toContain("more than once");
  });
});

describe("the year so far", () => {
  it("reports through the last completed month, never the month in progress", () => {
    // The fixture is read on October 14: September is the last whole month.
    const snapshot = assemble();
    expect(snapshot.status).toBe("ok");
    expect(snapshot.period).toMatchObject({ through: "2026-09-30", completedMonths: 9, showingPriorYear: false });
    expect(snapshot.basis).toBe("Accrual");

    const dues = FIXTURE_FIGURES.thisYear["301"];
    // October's $900 is already in QuickBooks, and must not be counted.
    expect(group(snapshot, "Memberships")?.actual).toBe(total(dues, 0, 9));
  });

  it("compares with the budget for the same months, and projects with the months left", () => {
    const snapshot = assemble();
    const budget = FIXTURE_FIGURES.budget["301"];
    const dues = group(snapshot, "Memberships")!;
    expect(dues.budgetToDate).toBe(total(budget, 0, 9));
    expect(dues.budgetFullYear).toBe(total(budget));
    expect(dues.projectedYearEnd).toBe(total(FIXTURE_FIGURES.thisYear["301"], 0, 9) + total(budget, 9));
    expect(dues.lastYearToDate).toBe(total(FIXTURE_FIGURES.lastYear["301"], 0, 9));
    expect(snapshot.budget).toMatchObject({ status: "ok", name: "FY2026 Board budget" });
  });

  it("rolls sub-accounts up through their parent, and shows one label on both sides", () => {
    const snapshot = assemble();
    const programsIncome = group(snapshot, "Events and programs", "income")!;
    const t = FIXTURE_FIGURES.thisYear;
    expect(programsIncome.actual).toBe(total(t["311"], 0, 9) + total(t["312"], 0, 9));
    expect(programsIncome.accounts.map((a) => a.label)).toEqual(["Auction", "First Fridays"]);

    const programsSpending = group(snapshot, "Events and programs", "spending")!;
    expect(programsSpending.actual).toBe(["401", "402", "403", "404"].reduce((s, id) => s + total(t[id], 0, 9), 0));
  });

  it("keeps excluded rebuild money out of every figure, and says how much was kept out", () => {
    const snapshot = assemble();
    const rebuild = total(FIXTURE_FIGURES.thisYear["330"], 0, 9);
    expect(snapshot.excluded).toEqual({ income: rebuild, spending: 0, accounts: ["Rebuild contributions"] });

    const operatingIncome = snapshot.groups.filter((g) => g.side === "income").reduce((s, g) => s + g.actual, 0);
    expect(snapshot.totals?.income.actual).toBeCloseTo(operatingIncome, 2);
    expect(snapshot.groups.some((g) => g.accounts.some((a) => a.label === "Rebuild contributions"))).toBe(false);
  });

  it("nets income against spending on every column", () => {
    const { totals } = assemble();
    expect(totals!.net.actual).toBeCloseTo(totals!.income.actual - totals!.spending.actual, 2);
    expect(totals!.net.budgetToDate).toBeCloseTo(totals!.income.budgetToDate! - totals!.spending.budgetToDate!, 2);
  });

  it("averages operating spending over the last twelve completed months", () => {
    const snapshot = assemble();
    const expected = SPENDING_IDS.reduce(
      (s, id) => s + total(FIXTURE_FIGURES.thisYear[id], 0, 9) + total(FIXTURE_FIGURES.lastYear[id], 9),
      0,
    );
    expect(snapshot.trailingTwelveMonthSpending).toBeCloseTo(expected, 2);
  });

  it("charts completed months only, with the full year of budget", () => {
    const { monthly } = assemble();
    expect(monthly!.months[0]).toBe("2026-01");
    expect(monthly!.income.actual.slice(9)).toEqual([null, null, null]);
    expect(monthly!.income.budget).toHaveLength(12);
  });
});

describe("budgets the comparison cannot use", () => {
  it("never splits a yearly budget evenly across the months", () => {
    const yearly = buildBudget({
      name: "FY2026 yearly",
      start: "2026-01-01",
      entryType: "Yearly",
      lines: [{ accountId: "301", months: [12000] }],
    });
    const snapshot = assemble({ budgets: [yearly] });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.budget.status).toBe("not_monthly");
    const dues = group(snapshot, "Memberships")!;
    expect(dues.budgetFullYear).toBe(12000);
    expect(dues.budgetToDate).toBeNull();
    expect(dues.projectedYearEnd).toBeNull();
    expect(snapshot.monthly!.income.budget).toBeNull();
  });

  it("shows actuals without budget columns when no budget covers the year", () => {
    const lastYearsBudget = buildBudget({ name: "FY2025", start: "2025-01-01", lines: [{ accountId: "301", months: [1] }] });
    const snapshot = assemble({ budgets: [lastYearsBudget] });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.budget.status).toBe("none");
    expect(group(snapshot, "Memberships")?.budgetFullYear).toBeNull();
    expect(group(snapshot, "Memberships")?.actual).toBeGreaterThan(0);
  });

  it("refuses to choose between two active budgets for the same year", () => {
    const a = buildBudget({ name: "Draft", start: "2026-01-01", lines: [{ accountId: "301", months: [1] }] });
    const b = buildBudget({ name: "Approved", start: "2026-01-01", lines: [{ accountId: "301", months: [2] }] });
    const snapshot = assemble({ budgets: [a, b] });
    expect(snapshot.budget.status).toBe("ambiguous");
    expect(snapshot.budget.note).toContain('"Draft"');
    expect(group(snapshot, "Memberships")?.budgetToDate).toBeNull();
  });

  it("ignores an inactive budget", () => {
    const old = buildBudget({ name: "Old", start: "2026-01-01", active: false, lines: [{ accountId: "301", months: [1] }] });
    const snapshot = assemble({ budgets: [old, ...fixtureQbo().budgets] });
    expect(snapshot.budget).toMatchObject({ status: "ok", name: "FY2026 Board budget" });
  });
});

describe("accounts no group claims", () => {
  it("withholds every operating figure and names the account", () => {
    // Without the exclude entry, rebuild contributions belong to no group.
    const snapshot = assemble({}, FIXTURE_GROUPS.replace(";exclude=330", ""));
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.totals).toBeNull();
    expect(snapshot.groups).toEqual([]);
    expect(snapshot.ungrouped).toEqual([{ id: "330", name: "Rebuild contributions", side: "income" }]);
    expect(snapshot.note).toContain("Rebuild contributions");
  });

  it("counts an account with activity only last year", () => {
    const lastYearOnly = { ...FIXTURE_FIGURES.lastYear, "304": [500] };
    const comparison = parse(
      buildProfitAndLoss({
        start: "2025-01-01",
        time: "2026-10-14T09:00:00-07:00",
        income: linesFrom(lastYearOnly, "Revenue"),
        spending: linesFrom(lastYearOnly, "Expense"),
      }),
    );
    const snapshot = assemble({ comparison }, FIXTURE_GROUPS.replace("Donations and sponsorships=302,304", "Donations=302"));
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.ungrouped.map((u) => u.id)).toContain("304");
  });

  it("rejects an ID the chart of accounts does not have", () => {
    const snapshot = assemble({}, FIXTURE_GROUPS + ";Other income=999");
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.invalidConfig.join(" ")).toContain("Account 999");
  });
});

describe("the profit and loss parser", () => {
  it("rejects a report whose lines do not sum to QuickBooks' own total", () => {
    const report = fixtureQbo().thisYear;
    const income = report.Rows!.Row![0];
    income.Summary!.ColData![3] = { value: "999999.00" };
    const parsed = parseProfitAndLoss(report);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.detail).toContain("does not match");
  });

  it("rejects a report on a cash basis", () => {
    const report = buildProfitAndLoss({
      start: "2026-01-01",
      time: "2026-10-14T09:00:00-07:00",
      income: [],
      spending: [],
      basis: "Cash",
    });
    expect(parseProfitAndLoss(report)).toMatchObject({ ok: false });
  });

  it("rejects a section it does not recognise rather than guessing its side", () => {
    const report = fixtureQbo().thisYear;
    report.Rows!.Row![0].group = "Mystery";
    expect(parseProfitAndLoss(report)).toMatchObject({ ok: false });
  });

  it("reads a parent account's own postings alongside its sub-accounts", () => {
    const report = buildProfitAndLoss({
      start: "2026-01-01",
      time: "2026-10-14T09:00:00-07:00",
      income: [
        { id: "300", name: "Contributions", months: [50] },
        { id: "301", name: "Membership dues", parentId: "300", months: [100] },
      ],
      spending: [],
    });
    const parsed = parse(report);
    expect(parsed.accounts.get("300")?.cents.get("2026-01")).toBe(5000);
    expect(parsed.accounts.get("301")?.cents.get("2026-01")).toBe(10000);
  });
});

// --- The live read path, with QuickBooks stubbed ---

const ENDPOINTS: OAuthEndpoints = {
  authorization: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

interface Seen {
  url: string;
  method: string;
  auth: string | null;
}

let respond: ((url: string, seen: Seen) => Response) | null = null;
let requests: Seen[] = [];
let logged: string[] = [];

beforeEach(() => {
  respond = null;
  requests = [];
  logged = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const seen = { url, method: init?.method ?? "GET", auth: headers.get("Authorization") };
    requests.push(seen);
    if (!respond) throw new TypeError("Network connection lost.");
    return respond(url, seen);
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

function liveEnv(groups = FIXTURE_GROUPS): Env {
  return { ...env, QBO_MODE: "live", QBO_ENV: "production", QBO_REALM_ID: "9130000000000001", QBO_PL_GROUPS: groups } as Env;
}

async function connectedStore(name: string) {
  const stub = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName(name));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAll();
    await state.storage.put("endpoints", { endpoints: ENDPOINTS, at: Date.now() });
  });
  await stub.seed({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "bearer" });
  return stub;
}

/** A stub QuickBooks that answers like the fixture company, reading on `time`. */
function quickbooks(time = "2026-10-14T09:12:00-07:00", overrides: (url: string) => Response | null = () => null) {
  const raw = fixtureQbo();
  const report = (start: string, figures: Record<string, number[]>) =>
    buildProfitAndLoss({ start, time, income: linesFrom(figures, "Revenue"), spending: linesFrom(figures, "Expense") });
  const thisYearStart = `${time.slice(0, 4)}-01-01`;

  return (url: string): Response => {
    const override = overrides(url);
    if (override) return override;
    const decoded = decodeURIComponent(url);
    if (decoded.includes("from Account")) return ok({ QueryResponse: { Account: raw.accounts }, time });
    if (decoded.includes("from Budget")) return ok({ QueryResponse: { Budget: raw.budgets }, time });
    if (decoded.includes("date_macro=This Fiscal Year")) return ok(report(thisYearStart, FIXTURE_FIGURES.thisYear));
    const start = /start_date=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
    if (start) return ok(report(start, FIXTURE_FIGURES.lastYear));
    return new Response("not stubbed", { status: 404 });
  };
}

describe("reading QuickBooks", () => {
  it("assembles the year from GET requests only, on an accrual basis", async () => {
    const store = await connectedStore("ops-live");
    respond = quickbooks();

    const snapshot = await getOperations(liveEnv(), store);

    expect(snapshot.status).toBe("ok");
    expect(snapshot.connection).toBe("ok");
    expect(snapshot.retrievedAt).toBe("2026-10-14T09:12:00-07:00");
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    const reports = requests.filter((r) => r.url.includes("reports/ProfitAndLoss"));
    expect(reports).toHaveLength(2);
    expect(reports.every((r) => r.url.includes("accounting_method=Accrual") && r.url.includes("minorversion="))).toBe(true);
    // Last year is asked for by explicit dates derived from QuickBooks' own period.
    expect(reports.some((r) => r.url.includes("start_date=2025-01-01&end_date=2025-12-31"))).toBe(true);
  });

  it("asks QuickBooks for nothing when no grouping is configured", async () => {
    const store = await connectedStore("ops-unconfigured");
    respond = quickbooks();
    const snapshot = await getOperations(liveEnv(""), store);
    expect(snapshot.status).toBe("not_configured");
    expect(requests).toEqual([]);
  });

  it("reports last year's full results in a fiscal year's first month", async () => {
    const store = await connectedStore("ops-january");
    respond = quickbooks("2027-01-15T08:00:00-08:00");

    const snapshot = await getOperations(liveEnv(), store);

    expect(snapshot.status).toBe("ok");
    expect(snapshot.period).toMatchObject({
      fiscalYearStart: "2026-01-01",
      through: "2026-12-31",
      completedMonths: 12,
      showingPriorYear: true,
    });
    // Compared with the year before that.
    expect(requests.some((r) => r.url.includes("start_date=2025-01-01"))).toBe(true);
    // The timestamp is still when the data was read.
    expect(snapshot.retrievedAt).toBe("2027-01-15T08:00:00-08:00");
  });

  it("still shows the year when last year cannot be read, without last year's column", async () => {
    const store = await connectedStore("ops-no-last-year");
    respond = quickbooks(undefined, (url) =>
      url.includes("start_date=") ? new Response("{}", { status: 500, headers: { intuit_tid: "tid-ly" } }) : null,
    );

    const snapshot = await getOperations(liveEnv(), store);

    expect(snapshot.status).toBe("ok");
    expect(snapshot.lastYear.status).toBe("unavailable");
    expect(group(snapshot, "Memberships")?.lastYearToDate).toBeNull();
    expect(snapshot.trailingTwelveMonthSpending).toBeNull();
    expect(JSON.parse(logged[0])).toMatchObject({ event: "qbo_error", operation: "profit_and_loss", intuitTid: "tid-ly" });
  });

  it("shows nothing, and logs the intuit_tid, when this year's report fails", async () => {
    const store = await connectedStore("ops-report-fails");
    respond = quickbooks(undefined, (url) =>
      url.includes("date_macro") ? new Response("{}", { status: 500, headers: { intuit_tid: "tid-ty" } }) : null,
    );

    const snapshot = await getOperations(liveEnv(), store);

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.totals).toBeNull();
    expect(snapshot.note).toContain("tid-ty");
    for (const line of logged) {
      expect(line).not.toContain("access-1");
      expect(line).not.toContain("9130000000000001");
    }
  });

  it("refreshes a rejected token once and retries the whole read", async () => {
    const store = await connectedStore("ops-401");
    const answer = quickbooks();
    respond = (url, seen) => {
      if (url === ENDPOINTS.token) {
        return ok({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600, token_type: "bearer" });
      }
      if (seen.auth === "Bearer access-1" && url.includes("reports/")) return new Response("{}", { status: 401 });
      return answer(url);
    };

    const snapshot = await getOperations(liveEnv(), store);

    expect(snapshot.status).toBe("ok");
    expect(requests.filter((r) => r.url === ENDPOINTS.token)).toHaveLength(1);
  });

  it("does not let an Account query hitting the read limit pass as complete", async () => {
    const store = await connectedStore("ops-too-many-accounts");
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...fixtureAccounts()[0], Id: String(5000 + i) }));
    respond = quickbooks(undefined, (url) =>
      decodeURIComponent(url).includes("from Account") ? ok({ QueryResponse: { Account: many } }) : null,
    );

    const snapshot = await getOperations(liveEnv(), store);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.note).toContain("incomplete");
  });
});
