/**
 * Operations: the fiscal year's income and spending, against budget.
 *
 * Every call here is a GET: the profit and loss report, the Budget entity and
 * the chart of accounts. Nothing writes to QuickBooks.
 *
 * Four rules shape this module, each the same honesty rule the cash panel
 * follows, applied to a year instead of a balance:
 *
 * **Completed months only.** A board report runs through the last month that
 * has ended, so an October 30 read reports through September 30. Comparing a
 * month in progress with that month's full budget makes every early read look
 * under budget.
 *
 * **Budget to date comes from a budget entered by month, or not at all.**
 * HPIC's spending is seasonal (First Fridays run May to October) and lumpy
 * (insurance lands in one month). Dividing a yearly budget by twelve makes
 * every one of those months look wrong. A budget entered any other way still
 * shows its full-year figure; the to-date and projected columns read
 * unavailable and say why.
 *
 * **Operating figures render only when every account with activity is
 * accounted for**, either grouped onto a board line or deliberately excluded.
 * An ungrouped account might be rebuild money, and counted as day-to-day
 * income it would overstate how the year is going. This is the cash panel's
 * "total renders only when every account reads" rule, for the profit and loss.
 *
 * **Our arithmetic is checked against QuickBooks' own.** Every section's lines
 * are summed and compared with the section total QuickBooks printed, month by
 * month, in cents. A mismatch means the report's shape is not what this code
 * expects, and it renders unavailable rather than a number built on a misread.
 *
 * Dates come from QuickBooks too: the fiscal year from the report's own
 * period, and "today" from its timestamp. The Worker clock is never consulted.
 */

import { FIXTURE_GROUPS, fixtureQbo } from "./operations-fixtures";
import { qboEnvironment, qboGet, type QboAccount, type QboGetResult } from "./qbo";
import type { TokenStore } from "./tokens";
import type {
  BudgetState,
  Env,
  OperationsGroup,
  OperationsLine,
  OperationsMonthly,
  OperationsSnapshot,
  PlSide,
  UngroupedAccount,
} from "./types";

export const OPERATIONS_SOURCE = "QuickBooks Online profit and loss and budget, accrual basis";

/** The reserved group label that keeps accounts out of operating figures. */
const EXCLUDE = "exclude";

/** Above this, the account list may have been truncated, so it is not trusted. */
const ACCOUNT_QUERY_LIMIT = 1000;

// --- Configuration ---

export interface PlGroupConfig {
  label: string;
  ids: string[];
}

export interface ParsedGroups {
  /** In configuration order, which is display order. */
  groups: PlGroupConfig[];
  /** Account IDs listed under `exclude`. */
  excluded: string[];
  /** Why an entry could not be used. Any entry here withholds every figure. */
  invalid: string[];
}

/**
 * Parse `QBO_PL_GROUPS`.
 *
 * As with `QBO_ACCOUNTS`, a bad entry is reported rather than skipped: a
 * skipped group would leave its accounts ungrouped or, worse, a typo'd ID
 * would leave the intended account quietly outside the line it belongs on.
 * An account listed twice is rejected because it would be counted twice.
 */
export function parseGroupConfig(raw: string | undefined): ParsedGroups {
  const groups: PlGroupConfig[] = [];
  const excluded: string[] = [];
  const invalid: string[] = [];
  const owner = new Map<string, string>();
  const labels = new Set<string>();

  for (const entry of (raw ?? "").split(";").map((e) => e.trim()).filter(Boolean)) {
    const eq = entry.indexOf("=");
    const label = eq > 0 ? entry.slice(0, eq).trim() : "";
    const ids = eq > 0 ? entry.slice(eq + 1).split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!label || ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
      invalid.push(`"${entry}" is not of the form Label=<id>,<id>.`);
      continue;
    }

    const key = label.toLowerCase();
    if (labels.has(key)) {
      invalid.push(`The group "${label}" is listed more than once.`);
      continue;
    }
    labels.add(key);

    const taken = ids.find((id, i) => owner.has(id) || ids.indexOf(id) !== i);
    if (taken) {
      const first = owner.get(taken) ?? label;
      invalid.push(
        `Account ${taken} is listed under both "${first}" and "${label}", so it would be counted twice.`,
      );
      continue;
    }
    for (const id of ids) owner.set(id, label);

    if (key === EXCLUDE) excluded.push(...ids);
    else groups.push({ label, ids });
  }

  return { groups, excluded, invalid };
}

/**
 * Which group an account belongs to: its own entry if it has one, otherwise
 * its nearest listed ancestor's. Most specific wins, so a parent can be
 * grouped while one sub-account is moved elsewhere or excluded.
 */
export function resolveGroup(
  accountId: string,
  parents: Map<string, string | undefined>,
  explicit: Map<string, string>,
): string | null {
  const seen = new Set<string>();
  let current: string | undefined = accountId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const label = explicit.get(current);
    if (label) return label;
    current = parents.get(current);
  }
  return null;
}

// --- Date arithmetic on QuickBooks' own dates (never the Worker clock) ---

function monthKeys(start: string, count = 12): string[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function shiftDate(date: string, { years = 0, days = 0 }: { years?: number; days?: number }): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d + days)).toISOString().slice(0, 10);
}

// --- The profit and loss report ---

interface QboColData {
  value?: string;
  id?: string;
}

interface QboRow {
  type?: string;
  group?: string;
  ColData?: QboColData[];
  Header?: { ColData?: QboColData[] };
  Rows?: { Row?: QboRow[] };
  Summary?: { ColData?: QboColData[] };
}

export interface QboReport {
  Header?: {
    Time?: string;
    StartPeriod?: string;
    EndPeriod?: string;
    ReportBasis?: string;
  };
  Columns?: {
    Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name: string; Value: string }[] }[];
  };
  Rows?: { Row?: QboRow[] };
}

/** One account's figures in one report, in cents, keyed by "YYYY-MM". */
interface ReportAccount {
  name: string;
  side: PlSide;
  cents: Map<string, number>;
}

export interface ParsedReport {
  time: string;
  start: string;
  end: string;
  accounts: Map<string, ReportAccount>;
  /** Data rows QuickBooks printed without an account ID, which nothing can group. */
  unidentified: { name: string; side: PlSide }[];
}

type ParseResult = { ok: true; report: ParsedReport } | { ok: false; detail: string };

/** Top-level sections that carry account lines, and which side each is on. */
const SECTION_SIDE: Record<string, PlSide> = {
  Income: "income",
  OtherIncome: "income",
  COGS: "spending",
  Expenses: "spending",
  OtherExpenses: "spending",
};

/** Top-level sections that only carry a computed total. */
const TOTAL_ONLY = new Set(["GrossProfit", "NetOperatingIncome", "NetOtherIncome", "NetIncome"]);

/** QuickBooks prints a zero as an empty string. Null means unreadable. */
function toCents(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Read a ProfitAndLoss report summarized by month into per-account monthly
 * figures, and check them against QuickBooks' own section totals.
 */
export function parseProfitAndLoss(report: QboReport): ParseResult {
  const fail = (detail: string): ParseResult => ({ ok: false, detail });
  const header = report.Header;
  if (!header?.Time || !header.StartPeriod || !header.EndPeriod) {
    return fail("The profit and loss report came back without its period or timestamp.");
  }
  if (header.ReportBasis && header.ReportBasis !== "Accrual") {
    return fail(`The profit and loss report came back on a ${header.ReportBasis} basis, not accrual.`);
  }

  // Which column holds which month. The total column is ignored: totals are
  // computed from months, so a figure can never mix two different periods.
  const monthAt = new Map<number, string>();
  for (const [index, column] of (report.Columns?.Column ?? []).entries()) {
    if (column.ColType !== "Money") continue;
    const meta = Object.fromEntries((column.MetaData ?? []).map((m) => [m.Name, m.Value]));
    if (!meta.StartDate || !meta.EndDate) {
      if (meta.ColKey === "total" || column.ColTitle === "Total") continue;
      return fail(`The report has a column ("${column.ColTitle ?? ""}") with no dates.`);
    }
    const month = meta.StartDate.slice(0, 7);
    if (!meta.StartDate.endsWith("-01") || meta.EndDate !== lastDayOfMonth(month)) {
      return fail(
        `A report column runs ${meta.StartDate} to ${meta.EndDate}, not a calendar month. ` +
          "Month-by-month figures need a fiscal year that starts on the first of a month.",
      );
    }
    monthAt.set(index, month);
  }
  if (monthAt.size === 0) return fail("The report has no monthly columns.");

  const accounts = new Map<string, ReportAccount>();
  const unidentified: { name: string; side: PlSide }[] = [];
  const sideTotals: Record<PlSide, Map<string, number>> = { income: new Map(), spending: new Map() };
  let netIncome: QboColData[] | undefined;
  let problem: string | null = null;

  const add = (map: Map<string, number>, month: string, cents: number) =>
    map.set(month, (map.get(month) ?? 0) + cents);

  /** Sum every account line under a row into `totals`, recording each account. */
  const walk = (row: QboRow, side: PlSide, totals: Map<string, number>) => {
    if (row.ColData) {
      const first = row.ColData[0];
      const lineCents = new Map<string, number>();
      for (const [index, month] of monthAt) {
        const cents = toCents(row.ColData[index]?.value);
        if (cents === null) {
          problem = `QuickBooks printed an unreadable amount on "${first?.value ?? "a line"}".`;
          return;
        }
        if (cents !== 0) lineCents.set(month, cents);
      }
      for (const [month, cents] of lineCents) add(totals, month, cents);
      if (!first?.id) {
        if (lineCents.size > 0) unidentified.push({ name: first?.value ?? "(unnamed line)", side });
      } else {
        const existing = accounts.get(first.id);
        if (existing) {
          for (const [month, cents] of lineCents) add(existing.cents, month, cents);
        } else {
          accounts.set(first.id, { name: first.value ?? `Account ${first.id}`, side, cents: lineCents });
        }
      }
    }
    for (const child of row.Rows?.Row ?? []) walk(child, side, totals);
  };

  for (const row of report.Rows?.Row ?? []) {
    const group = row.group ?? "";
    if (TOTAL_ONLY.has(group)) {
      if (group === "NetIncome") netIncome = row.Summary?.ColData;
      continue;
    }
    const side = SECTION_SIDE[group];
    if (!side) {
      const hasLines = Boolean(row.ColData) || (row.Rows?.Row ?? []).length > 0;
      if (hasLines) return fail(`The report has a section this code does not recognise ("${group || "untitled"}").`);
      continue;
    }

    const sectionTotals = new Map<string, number>();
    walk(row, side, sectionTotals);
    if (problem) return fail(problem);

    const printed = row.Summary?.ColData;
    if (printed) {
      for (const [index, month] of monthAt) {
        const expected = toCents(printed[index]?.value);
        if (expected === null || expected !== (sectionTotals.get(month) ?? 0)) {
          return fail(
            `QuickBooks' ${group} total for ${month} does not match the sum of its lines, ` +
              "so the report's layout is not what this dashboard expects.",
          );
        }
      }
    }
    for (const [month, cents] of sectionTotals) add(sideTotals[side], month, cents);
  }

  if (netIncome) {
    for (const [index, month] of monthAt) {
      const expected = toCents(netIncome[index]?.value);
      const computed = (sideTotals.income.get(month) ?? 0) - (sideTotals.spending.get(month) ?? 0);
      if (expected === null || expected !== computed) {
        return fail(`QuickBooks' net income for ${month} does not match income less spending.`);
      }
    }
  }

  return {
    ok: true,
    report: { time: header.Time, start: header.StartPeriod, end: header.EndPeriod, accounts, unidentified },
  };
}

// --- The budget ---

export interface QboBudget {
  Id?: string;
  Name?: string;
  StartDate?: string;
  EndDate?: string;
  BudgetType?: string;
  BudgetEntryType?: string;
  Active?: boolean;
  BudgetDetail?: { BudgetDate?: string; Amount?: number; AccountRef?: { value?: string; name?: string } }[];
}

interface BudgetFigures {
  state: BudgetState;
  /** Per account, cents by month. Only when the budget was entered by month. */
  monthly: Map<string, Map<string, number>> | null;
  /** Per account, the full-year total in cents, however the budget was entered. */
  fullYear: Map<string, number> | null;
}

/**
 * Pick the budget for a fiscal year and read it.
 *
 * Exactly one active profit-and-loss budget must start on the fiscal year's
 * first day. Two is ambiguous, and choosing between drafts by name or date
 * would be guessing at which one the board approved.
 */
export function readBudget(budgets: QboBudget[], fiscalYearStart: string): BudgetFigures {
  const none = (status: BudgetState["status"], note: string, name: string | null = null): BudgetFigures => ({
    state: { status, name, note },
    monthly: null,
    fullYear: null,
  });

  const candidates = budgets.filter(
    (b) =>
      b.Active !== false &&
      (!b.BudgetType || b.BudgetType === "ProfitAndLoss") &&
      b.StartDate === fiscalYearStart,
  );
  if (candidates.length === 0) {
    return none("none", `No active QuickBooks budget starts on ${fiscalYearStart}, so no budget figures are shown.`);
  }
  if (candidates.length > 1) {
    const names = candidates.map((b) => `"${b.Name ?? b.Id}"`).join(", ");
    return none(
      "ambiguous",
      `More than one active QuickBooks budget covers this year (${names}). Make only one of them active.`,
    );
  }

  const budget = candidates[0];
  const name = budget.Name ?? null;
  const fullYear = new Map<string, number>();
  const monthly = new Map<string, Map<string, number>>();
  for (const line of budget.BudgetDetail ?? []) {
    const id = line.AccountRef?.value;
    const cents = typeof line.Amount === "number" ? Math.round(line.Amount * 100) : null;
    if (!id || cents === null || !line.BudgetDate) {
      return none("unavailable", `A line of the budget "${name}" could not be read.`, name);
    }
    fullYear.set(id, (fullYear.get(id) ?? 0) + cents);
    const month = line.BudgetDate.slice(0, 7);
    const byMonth = monthly.get(id) ?? new Map<string, number>();
    byMonth.set(month, (byMonth.get(month) ?? 0) + cents);
    monthly.set(id, byMonth);
  }

  if (budget.BudgetEntryType !== "Monthly") {
    return {
      state: {
        status: "not_monthly",
        name,
        note:
          `The budget "${name}" is entered ${budget.BudgetEntryType ? budget.BudgetEntryType.toLowerCase() : "in a way QuickBooks did not state"}, not by month. ` +
          "Its full-year figures are shown, but budget to date and the projection need it entered by month, in the months the money actually moves.",
      },
      monthly: null,
      fullYear,
    };
  }
  return { state: { status: "ok", name }, monthly, fullYear };
}

// --- Assembly ---

export interface OperationsInputs {
  accounts: QboAccount[];
  /** The fiscal year being reported. */
  report: ParsedReport;
  /** The year before it, or why it could not be read. */
  comparison: ParsedReport | { failed: string };
  budgets: QboBudget[] | { failed: string };
  /** True when `report` is last year, because no month of this year has completed. */
  showingPriorYear: boolean;
}

/** Twelve monthly figures, in cents, for one account in one source. */
type Months = number[];

const zeros = (): Months => Array(12).fill(0);
const sum = (values: number[], from = 0, to = values.length) =>
  values.slice(from, to).reduce((a, b) => a + b, 0);
const dollars = (cents: number) => cents / 100;

/**
 * One account's figures from a report, by fiscal month. Index 0 is the
 * report's own first month, so last year's report lines up month for month
 * with this year's.
 */
function alignReport(report: ParsedReport, id: string): Months {
  const account = report.accounts.get(id);
  return monthKeys(report.start).map((m) => account?.cents.get(m) ?? 0);
}

interface AccountFigures {
  id: string;
  name: string;
  side: PlSide;
  group: string | null;
  actual: Months;
  budget: Months | null;
  budgetTotal: number | null;
  lastYear: Months | null;
}

export function assembleOperations(
  inputs: OperationsInputs,
  config: ParsedGroups,
  base: Pick<OperationsSnapshot, "connection" | "environment">,
): OperationsSnapshot {
  const { report } = inputs;
  const months = monthKeys(report.start);
  const today = report.time.slice(0, 10);
  const completed = inputs.showingPriorYear
    ? 12
    : months.filter((m) => lastDayOfMonth(m) < today).length;

  const fiscalYearEnd = lastDayOfMonth(months[11]);
  const period: NonNullable<OperationsSnapshot["period"]> = {
    fiscalYearStart: report.start,
    fiscalYearEnd,
    through: lastDayOfMonth(months[Math.max(completed, 1) - 1]),
    completedMonths: completed,
    showingPriorYear: inputs.showingPriorYear,
  };

  const comparison = "failed" in inputs.comparison ? null : inputs.comparison;
  const lastYear: OperationsSnapshot["lastYear"] = comparison
    ? { status: "ok" }
    : { status: "unavailable", note: (inputs.comparison as { failed: string }).failed };

  const budgetFigures: BudgetFigures =
    "failed" in inputs.budgets
      ? { state: { status: "unavailable", name: null, note: inputs.budgets.failed }, monthly: null, fullYear: null }
      : readBudget(inputs.budgets, report.start);

  const snapshot = (fields: Partial<OperationsSnapshot>): OperationsSnapshot => ({
    status: "unavailable",
    ungrouped: [],
    invalidConfig: config.invalid,
    period,
    basis: "Accrual",
    groups: [],
    totals: null,
    excluded: null,
    budget: budgetFigures.state,
    lastYear,
    monthly: null,
    trailingTwelveMonthSpending: null,
    retrievedAt: report.time,
    cached: false,
    source: OPERATIONS_SOURCE,
    ...base,
    ...fields,
  });

  // The chart of accounts: names, parents, and which side each account is on.
  const byId = new Map(inputs.accounts.map((a) => [a.Id, a]));
  const parents = new Map(inputs.accounts.map((a) => [a.Id, a.ParentRef?.value]));
  const explicit = new Map<string, string>();
  for (const g of config.groups) for (const id of g.ids) explicit.set(id, g.label);
  for (const id of config.excluded) explicit.set(id, EXCLUDE);

  const unknownIds = [...explicit.keys()].filter((id) => !byId.has(id));
  if (unknownIds.length > 0) {
    return snapshot({
      invalidConfig: [
        ...config.invalid,
        ...unknownIds.map((id) => `Account ${id} in QBO_PL_GROUPS is not in QuickBooks' chart of accounts.`),
      ],
      note: "The grouping names an account QuickBooks does not have, so it may be missing from a line.",
    });
  }

  const classificationSide = (a: QboAccount | undefined): PlSide | null =>
    a?.Classification === "Revenue" ? "income" : a?.Classification === "Expense" ? "spending" : null;

  // Every account any figure draws on: actuals this year or last, or a budget.
  const ids = new Set<string>([
    ...report.accounts.keys(),
    ...(comparison ? comparison.accounts.keys() : []),
    ...(budgetFigures.fullYear ? budgetFigures.fullYear.keys() : []),
  ]);

  const figures: AccountFigures[] = [];
  const ungrouped: UngroupedAccount[] = report.unidentified.map((u) => ({
    id: "",
    name: `${u.name} (a line QuickBooks printed without an account)`,
    side: u.side,
  }));
  if (comparison) {
    for (const u of comparison.unidentified) {
      ungrouped.push({ id: "", name: `${u.name} (last year, printed without an account)`, side: u.side });
    }
  }

  for (const id of ids) {
    const account = byId.get(id);
    const side =
      report.accounts.get(id)?.side ?? comparison?.accounts.get(id)?.side ?? classificationSide(account);
    const name = account?.Name ?? report.accounts.get(id)?.name ?? comparison?.accounts.get(id)?.name ?? `Account ${id}`;
    if (!side) {
      return snapshot({
        note: `The budget has a line on "${name}", which is not an income or expense account, so its side of the books is unknown.`,
      });
    }

    const actual = alignReport(report, id);
    const last = comparison ? alignReport(comparison, id) : null;
    const budget = budgetFigures.monthly
      ? months.map((m) => budgetFigures.monthly!.get(id)?.get(m) ?? 0)
      : null;
    const budgetTotal = budgetFigures.fullYear ? budgetFigures.fullYear.get(id) ?? 0 : null;

    // Only activity that a figure actually uses decides whether an account
    // must be grouped: this year's completed months, all of last year (the
    // trailing-twelve figure reaches into it), and the whole budget.
    const active =
      actual.slice(0, completed).some((c) => c !== 0) ||
      (last ?? []).some((c) => c !== 0) ||
      (budget ?? []).some((c) => c !== 0) ||
      (budgetTotal ?? 0) !== 0;
    if (!active) continue;

    const group = resolveGroup(id, parents, explicit);
    if (!group) {
      ungrouped.push({ id, name, side });
      continue;
    }
    figures.push({ id, name, side, group, actual, budget, budgetTotal, lastYear: last });
  }

  if (ungrouped.length > 0) {
    const names = ungrouped.map((u) => `${u.name}${u.id ? ` (${u.id})` : ""}`).join(", ");
    return snapshot({
      ungrouped,
      note:
        `${ungrouped.length} QuickBooks account(s) with activity are not in any group: ${names}. ` +
        "Until each is grouped or excluded, nothing says whether it is day-to-day money, so no operating figure is shown.",
    });
  }

  const line = (label: string, rows: AccountFigures[]): OperationsLine => {
    const actual = sum(rows.map((r) => sum(r.actual, 0, completed)));
    const monthlyBudget = budgetFigures.monthly !== null;
    const budgetToDate = monthlyBudget ? sum(rows.map((r) => sum(r.budget!, 0, completed))) : null;
    const remaining = monthlyBudget ? sum(rows.map((r) => sum(r.budget!, completed))) : null;
    const fullYear = budgetFigures.fullYear !== null ? sum(rows.map((r) => r.budgetTotal ?? 0)) : null;
    const lastYearToDate = comparison ? sum(rows.map((r) => sum(r.lastYear!, 0, completed))) : null;
    return {
      label,
      actual: dollars(actual),
      budgetToDate: budgetToDate === null ? null : dollars(budgetToDate),
      budgetFullYear: fullYear === null ? null : dollars(fullYear),
      projectedYearEnd: remaining === null ? null : dollars(actual + remaining),
      lastYearToDate: lastYearToDate === null ? null : dollars(lastYearToDate),
    };
  };

  const operating = figures.filter((f) => f.group !== EXCLUDE);
  const excludedRows = figures.filter((f) => f.group === EXCLUDE);

  // A group shows on every side it has an account on, active or not, so the
  // table's rows do not come and go with the seasons.
  const groupSides = new Map<string, Set<PlSide>>();
  for (const account of inputs.accounts) {
    if (account.Active === false) continue;
    const group = resolveGroup(account.Id, parents, explicit);
    const side = classificationSide(account);
    if (!group || group === EXCLUDE || !side) continue;
    groupSides.set(group, (groupSides.get(group) ?? new Set()).add(side));
  }
  for (const f of operating) groupSides.set(f.group!, (groupSides.get(f.group!) ?? new Set()).add(f.side));

  const groups: OperationsGroup[] = [];
  for (const side of ["income", "spending"] as const) {
    for (const { label } of config.groups) {
      if (!groupSides.get(label)?.has(side)) continue;
      const rows = operating.filter((f) => f.group === label && f.side === side);
      const accounts = rows
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => line(r.name, [r]));
      groups.push({ ...line(label, rows), side, accounts });
    }
  }

  const income = line("Income", operating.filter((f) => f.side === "income"));
  const spending = line("Spending", operating.filter((f) => f.side === "spending"));
  const minus = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 100) / 100);
  const net: OperationsLine = {
    label: "Net",
    actual: minus(income.actual, spending.actual)!,
    budgetToDate: minus(income.budgetToDate, spending.budgetToDate),
    budgetFullYear: minus(income.budgetFullYear, spending.budgetFullYear),
    projectedYearEnd: minus(income.projectedYearEnd, spending.projectedYearEnd),
    lastYearToDate: minus(income.lastYearToDate, spending.lastYearToDate),
  };

  const sideMonths = (side: PlSide, pick: (f: AccountFigures) => Months | null): Months | null => {
    const rows = operating.filter((f) => f.side === side);
    const total = zeros();
    for (const r of rows) {
      const values = pick(r);
      if (!values) return null;
      values.forEach((v, i) => (total[i] += v));
    }
    return total;
  };

  const monthlySide = (side: PlSide) => {
    const actual = sideMonths(side, (f) => f.actual)!;
    const budget = budgetFigures.monthly ? sideMonths(side, (f) => f.budget) : null;
    const last = comparison ? sideMonths(side, (f) => f.lastYear) : null;
    return {
      actual: actual.map((c, i) => (i < completed ? dollars(c) : null)),
      budget: budget ? budget.map(dollars) : null,
      lastYear: last ? last.map(dollars) : null,
    };
  };
  const monthly: OperationsMonthly = { months, income: monthlySide("income"), spending: monthlySide("spending") };

  // The last twelve completed months of operating spending: this year's
  // completed months, and last year's from the same month on.
  const spendingThisYear = sideMonths("spending", (f) => f.actual)!;
  const spendingLastYear = comparison ? sideMonths("spending", (f) => f.lastYear) : null;
  const trailing =
    completed === 12
      ? sum(spendingThisYear)
      : spendingLastYear
        ? sum(spendingThisYear, 0, completed) + sum(spendingLastYear, completed)
        : null;

  return snapshot({
    status: "ok",
    groups,
    totals: { income, spending, net },
    excluded:
      excludedRows.length > 0
        ? {
            income: dollars(sum(excludedRows.filter((r) => r.side === "income").map((r) => sum(r.actual, 0, completed)))),
            spending: dollars(sum(excludedRows.filter((r) => r.side === "spending").map((r) => sum(r.actual, 0, completed)))),
            accounts: excludedRows.map((r) => r.name).sort(),
          }
        : null,
    monthly,
    trailingTwelveMonthSpending: trailing === null ? null : dollars(trailing),
  });
}

// --- Reading QuickBooks ---

function profitAndLossPath(range: { macro: string } | { start: string; end: string }): string {
  const period =
    "macro" in range
      ? `date_macro=${encodeURIComponent(range.macro)}`
      : `start_date=${range.start}&end_date=${range.end}`;
  return `reports/ProfitAndLoss?${period}&summarize_column_by=Month&accounting_method=Accrual`;
}

function queryPath(statement: string): string {
  return `query?query=${encodeURIComponent(statement)}`;
}

/** Every account, active or not: last year's activity can sit on an account since made inactive. */
export const ACCOUNT_QUERY = `select * from Account where Active in (true, false) maxresults ${ACCOUNT_QUERY_LIMIT}`;

type Read<T> = { ok: true; value: T } | { ok: false; unauthorized: boolean; detail: string };

function settle<T, R>(result: QboGetResult<T>, map: (body: T) => Read<R>): Read<R> {
  if (!result.ok) return { ok: false, unauthorized: result.kind === "unauthorized", detail: result.detail };
  return map(result.body);
}

async function readReport(env: Env, token: string, range: Parameters<typeof profitAndLossPath>[0]): Promise<Read<ParsedReport>> {
  const result = await qboGet<QboReport>(env, token, profitAndLossPath(range), "profit_and_loss");
  return settle(result, (body) => {
    const parsed = parseProfitAndLoss(body);
    return parsed.ok ? { ok: true, value: parsed.report } : { ok: false, unauthorized: false, detail: parsed.detail };
  });
}

export async function readAccounts(env: Env, token: string): Promise<Read<QboAccount[]>> {
  const result = await qboGet<{ QueryResponse?: { Account?: QboAccount[] } }>(
    env,
    token,
    queryPath(ACCOUNT_QUERY),
    "account_query",
  );
  return settle(result, (body) => {
    const accounts = body.QueryResponse?.Account ?? [];
    if (accounts.length >= ACCOUNT_QUERY_LIMIT) {
      return {
        ok: false,
        unauthorized: false,
        detail: `QuickBooks returned ${accounts.length} accounts, the most one read allows, so the list may be incomplete.`,
      };
    }
    return { ok: true, value: accounts };
  });
}

export async function readBudgets(env: Env, token: string): Promise<Read<QboBudget[]>> {
  const result = await qboGet<{ QueryResponse?: { Budget?: QboBudget[] } }>(
    env,
    token,
    queryPath("select * from Budget"),
    "budget_query",
  );
  return settle(result, (body) => ({ ok: true, value: body.QueryResponse?.Budget ?? [] }));
}

/** One complete pass over QuickBooks. Returns the inputs, or the first failure. */
async function readInputs(env: Env, token: string): Promise<{ ok: true; inputs: OperationsInputs } | { ok: false; unauthorized: boolean; detail: string }> {
  const [accounts, thisYear, budgets] = await Promise.all([
    readAccounts(env, token),
    readReport(env, token, { macro: "This Fiscal Year" }),
    readBudgets(env, token),
  ]);
  if (!accounts.ok) return accounts;
  if (!thisYear.ok) return thisYear;
  if (!budgets.ok && budgets.unauthorized) return budgets;

  // Which year to report. In a fiscal year's first month nothing has
  // completed yet, so the year just ended is reported in full instead.
  const fiscalStart = thisYear.value.start;
  const today = thisYear.value.time.slice(0, 10);
  const anyCompleted = lastDayOfMonth(monthKeys(fiscalStart, 1)[0]) < today;

  let report = thisYear.value;
  if (!anyCompleted) {
    const prior = await readReport(env, token, {
      start: shiftDate(fiscalStart, { years: -1 }),
      end: shiftDate(fiscalStart, { days: -1 }),
    });
    if (!prior.ok) return prior;
    // Keep this year's timestamp: it is when the data was read.
    report = { ...prior.value, time: thisYear.value.time };
  }

  const comparisonRead = await readReport(env, token, {
    start: shiftDate(report.start, { years: -1 }),
    end: shiftDate(report.start, { days: -1 }),
  });
  if (!comparisonRead.ok && comparisonRead.unauthorized) return comparisonRead;

  return {
    ok: true,
    inputs: {
      accounts: accounts.value,
      report,
      comparison: comparisonRead.ok ? comparisonRead.value : { failed: `Last year could not be read: ${comparisonRead.detail}` },
      budgets: budgets.ok ? budgets.value : { failed: `The budget could not be read: ${budgets.detail}` },
      showingPriorYear: !anyCompleted,
    },
  };
}

function emptySnapshot(
  env: Env,
  status: OperationsSnapshot["status"],
  connection: OperationsSnapshot["connection"],
  note: string,
  invalidConfig: string[] = [],
): OperationsSnapshot {
  return {
    status,
    note,
    ungrouped: [],
    invalidConfig,
    period: null,
    basis: "Accrual",
    groups: [],
    totals: null,
    excluded: null,
    budget: { status: "unavailable", name: null },
    lastYear: { status: "unavailable" },
    monthly: null,
    trailingTwelveMonthSpending: null,
    retrievedAt: null,
    cached: false,
    source: OPERATIONS_SOURCE,
    connection,
    environment: qboEnvironment(env),
  };
}

/**
 * The chart of accounts and the budgets, for the setup page that maps
 * accounts onto board lines. A setup tool, not part of the dashboard.
 */
export async function readSetup(
  env: Env,
  store: DurableObjectStub<TokenStore>,
): Promise<{ ok: true; accounts: QboAccount[]; budgets: QboBudget[] | null; budgetNote?: string } | { ok: false; detail: string }> {
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
  const [accounts, budgets] = await Promise.all([
    readAccounts(env, token.accessToken),
    readBudgets(env, token.accessToken),
  ]);
  if (!accounts.ok) return { ok: false, detail: accounts.detail };
  return budgets.ok
    ? { ok: true, accounts: accounts.value, budgets: budgets.value }
    : { ok: true, accounts: accounts.value, budgets: null, budgetNote: budgets.detail };
}

/** Assemble the Operations snapshot. */
export async function getOperations(env: Env, store: DurableObjectStub<TokenStore>): Promise<OperationsSnapshot> {
  if (env.QBO_MODE === "fixture") {
    // Through the same parser as live data, so fixture mode exercises it.
    const raw = fixtureQbo();
    const thisYear = parseProfitAndLoss(raw.thisYear);
    const lastYear = parseProfitAndLoss(raw.lastYear);
    if (!thisYear.ok) return emptySnapshot(env, "unavailable", "fixture", thisYear.detail);
    const inputs: OperationsInputs = {
      accounts: raw.accounts,
      report: thisYear.report,
      comparison: lastYear.ok ? lastYear.report : { failed: lastYear.detail },
      budgets: raw.budgets,
      showingPriorYear: false,
    };
    const config = parseGroupConfig(env.QBO_PL_GROUPS || FIXTURE_GROUPS);
    return {
      ...assembleOperations(inputs, config, { connection: "fixture", environment: qboEnvironment(env) }),
      source: `${OPERATIONS_SOURCE} (fixture data)`,
    };
  }

  const config = parseGroupConfig(env.QBO_PL_GROUPS);
  if (config.invalid.length > 0) {
    return emptySnapshot(
      env,
      "unavailable",
      "ok",
      "The grouping configuration has an entry that cannot be read, so an account may be missing from a line.",
      config.invalid,
    );
  }
  if (config.groups.length === 0) {
    return emptySnapshot(
      env,
      "not_configured",
      "ok",
      "No grouping is configured yet, so nothing says which accounts are day-to-day ones. Set QBO_PL_GROUPS on the Worker; /admin/pl-accounts lists the accounts.",
    );
  }

  const token = await store.getAccessToken();
  if (!token.ok) {
    const needsReauth = token.reason === "needs_reauth";
    return emptySnapshot(
      env,
      "unavailable",
      needsReauth ? "needs_reauth" : "not_connected",
      needsReauth
        ? "QuickBooks needs to be reconnected. Visit /oauth/start to re-authorize."
        : token.detail ?? "QuickBooks has never been connected. Visit /oauth/start to authorize.",
    );
  }

  let read = await readInputs(env, token.accessToken);
  // As with account reads: a token believed valid can still be rejected, so
  // force one refresh and try the whole pass once more.
  if (!read.ok && read.unauthorized) {
    const retry = await store.getAccessToken(true);
    if (retry.ok) read = await readInputs(env, retry.accessToken);
  }
  if (!read.ok) {
    return emptySnapshot(env, "unavailable", "ok", `QuickBooks could not be read: ${read.detail}`);
  }

  return assembleOperations(read.inputs, config, { connection: "ok", environment: qboEnvironment(env) });
}
