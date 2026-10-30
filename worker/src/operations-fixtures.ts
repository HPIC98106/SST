/**
 * Recorded-shape QuickBooks data for the Operations tab, used when
 * QBO_MODE=fixture and by the tests.
 *
 * The figures are invented. The chart of accounts is shaped like HPIC's:
 * parent accounts with sub-accounts, First Fridays income and costs only from
 * May to October, insurance landing in a single month, and rebuild money that
 * has to be kept out of operating figures. Those are the cases that make a
 * straight-line comparison wrong, so they are the ones worth rendering in
 * development.
 *
 * `buildProfitAndLoss` produces the JSON layout of QuickBooks' ProfitAndLoss
 * report summarized by month: nested sections for parent accounts, a parent's
 * own postings as a line inside its section, and printed totals per section.
 * The parser checks its sums against those printed totals.
 */

import type { QboBudget, QboReport } from "./operations";
import type { QboAccount } from "./qbo";

export interface FixtureLine {
  id: string;
  name: string;
  parentId?: string;
  /** Dollars per fiscal month. Missing months are zero. */
  months: number[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function months12(start: string): { start: string; end: string; title: string }[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(y, m + i, 0));
    return {
      start: first.toISOString().slice(0, 10),
      end: last.toISOString().slice(0, 10),
      title: `${MONTH_NAMES[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
    };
  });
}

/** QuickBooks prints zero as an empty string. */
const money = (n: number) => (Math.round(n * 100) === 0 ? "" : n.toFixed(2));
const values = (months: number[]) => Array.from({ length: 12 }, (_, i) => months[i] ?? 0);
const total = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100;
const addInto = (into: number[], v: number[]) => v.forEach((x, i) => (into[i] = Math.round((into[i] + x) * 100) / 100));

type Row = Record<string, unknown>;

function cells(label: { value: string; id?: string }, v: number[]) {
  return [label, ...v.map((x) => ({ value: money(x) })), { value: money(total(v)) }];
}

/** Rows for one side, nesting each parent's children in a section of its own. */
function rowsFor(lines: FixtureLine[], parentId: string | undefined, sums: number[]): Row[] {
  const rows: Row[] = [];
  for (const line of lines.filter((l) => l.parentId === parentId)) {
    const own = values(line.months);
    const children = lines.filter((l) => l.parentId === line.id);
    if (children.length === 0) {
      rows.push({ ColData: cells({ value: line.name, id: line.id }, own), type: "Data" });
      addInto(sums, own);
      continue;
    }
    const sectionSums = Array(12).fill(0);
    const inner: Row[] = [];
    if (own.some((x) => x !== 0)) {
      inner.push({ ColData: cells({ value: line.name, id: line.id }, own), type: "Data" });
      addInto(sectionSums, own);
    }
    inner.push(...rowsFor(lines, line.id, sectionSums));
    rows.push({
      Header: { ColData: [{ value: line.name, id: line.id }, ...Array(13).fill({ value: "" })] },
      Rows: { Row: inner },
      Summary: { ColData: cells({ value: `Total ${line.name}` }, sectionSums) },
      type: "Section",
    });
    addInto(sums, sectionSums);
  }
  return rows;
}

export function buildProfitAndLoss(opts: {
  start: string;
  time: string;
  income: FixtureLine[];
  spending: FixtureLine[];
  basis?: string;
}): QboReport {
  const cols = months12(opts.start);
  const income = Array(12).fill(0);
  const spending = Array(12).fill(0);
  const incomeRows = rowsFor(opts.income, undefined, income);
  const spendingRows = rowsFor(opts.spending, undefined, spending);
  const net = income.map((x, i) => Math.round((x - spending[i]) * 100) / 100);

  return {
    Header: {
      Time: opts.time,
      StartPeriod: cols[0].start,
      EndPeriod: cols[11].end,
      ReportBasis: opts.basis ?? "Accrual",
    },
    Columns: {
      Column: [
        { ColTitle: "", ColType: "Account", MetaData: [{ Name: "ColKey", Value: "account" }] },
        ...cols.map((c) => ({
          ColTitle: c.title,
          ColType: "Money",
          MetaData: [
            { Name: "StartDate", Value: c.start },
            { Name: "EndDate", Value: c.end },
            { Name: "ColKey", Value: c.title },
          ],
        })),
        { ColTitle: "Total", ColType: "Money", MetaData: [{ Name: "ColKey", Value: "total" }] },
      ],
    },
    Rows: {
      Row: [
        {
          Header: { ColData: [{ value: "Income" }] },
          Rows: { Row: incomeRows },
          Summary: { ColData: cells({ value: "Total Income" }, income) },
          type: "Section",
          group: "Income",
        },
        { Summary: { ColData: cells({ value: "Gross Profit" }, income) }, type: "Section", group: "GrossProfit" },
        {
          Header: { ColData: [{ value: "Expenses" }] },
          Rows: { Row: spendingRows },
          Summary: { ColData: cells({ value: "Total Expenses" }, spending) },
          type: "Section",
          group: "Expenses",
        },
        { Summary: { ColData: cells({ value: "Net Operating Income" }, net) }, type: "Section", group: "NetOperatingIncome" },
        { Summary: { ColData: cells({ value: "Net Income" }, net) }, type: "Section", group: "NetIncome" },
      ],
    },
  } as QboReport;
}

export function buildBudget(opts: {
  name: string;
  start: string;
  entryType?: string;
  active?: boolean;
  lines: { accountId: string; months: number[] }[];
}): QboBudget {
  const cols = months12(opts.start);
  return {
    Id: opts.name.replace(/\W/g, ""),
    Name: opts.name,
    StartDate: cols[0].start,
    EndDate: cols[11].end,
    BudgetType: "ProfitAndLoss",
    BudgetEntryType: opts.entryType ?? "Monthly",
    Active: opts.active ?? true,
    BudgetDetail: opts.lines.flatMap((line) =>
      values(line.months).flatMap((amount, i) =>
        amount === 0 ? [] : [{ BudgetDate: cols[i].start, Amount: amount, AccountRef: { value: line.accountId } }],
      ),
    ),
  };
}

// --- The fixture company ---

type Kind = "Revenue" | "Expense";

const CHART: { id: string; name: string; kind: Kind; parentId?: string }[] = [
  { id: "300", name: "Contributions", kind: "Revenue" },
  { id: "301", name: "Membership dues", kind: "Revenue", parentId: "300" },
  { id: "302", name: "Individual donations", kind: "Revenue", parentId: "300" },
  { id: "303", name: "Grants", kind: "Revenue", parentId: "300" },
  { id: "304", name: "Sponsorships", kind: "Revenue", parentId: "300" },
  { id: "310", name: "Program income", kind: "Revenue" },
  { id: "311", name: "First Fridays", kind: "Revenue", parentId: "310" },
  { id: "312", name: "Auction", kind: "Revenue", parentId: "310" },
  { id: "320", name: "Interest income", kind: "Revenue" },
  { id: "330", name: "Rebuild contributions", kind: "Revenue" },
  { id: "400", name: "Events and programming", kind: "Expense" },
  { id: "401", name: "Food and beverage", kind: "Expense", parentId: "400" },
  { id: "402", name: "Performers", kind: "Expense", parentId: "400" },
  { id: "403", name: "Merchant fees", kind: "Expense", parentId: "400" },
  { id: "404", name: "Porta-potty rental", kind: "Expense", parentId: "400" },
  { id: "410", name: "Operations", kind: "Expense" },
  { id: "411", name: "Insurance", kind: "Expense", parentId: "410" },
  { id: "412", name: "Software and website", kind: "Expense", parentId: "410" },
  { id: "413", name: "Bookkeeping", kind: "Expense", parentId: "410" },
  { id: "414", name: "Utilities", kind: "Expense", parentId: "410" },
];

export function fixtureAccounts(): QboAccount[] {
  return CHART.map((a) => ({
    Id: a.id,
    Name: a.name,
    FullyQualifiedName: a.parentId ? `${CHART.find((p) => p.id === a.parentId)!.name}:${a.name}` : a.name,
    Classification: a.kind,
    AccountType: a.kind === "Revenue" ? "Income" : "Expense",
    Active: true,
    SubAccount: Boolean(a.parentId),
    ParentRef: a.parentId ? { value: a.parentId } : undefined,
  }));
}

/** This year, by month. October is in progress on the fixture's read date. */
const THIS_YEAR: Record<string, number[]> = {
  "301": [150, 100, 900, 1000, 1700, 2400, 1600, 1700, 3200, 900],
  "302": [200, 0, 300, 250, 400, 600, 300, 350, 900, 200],
  "303": [0, 0, 5000, 0, 0, 4000, 0, 0, 2500],
  "304": [0, 0, 0, 0, 1000, 0, 0, 1000],
  "311": [0, 0, 0, 0, 1800, 2100, 2300, 2200, 2000, 1900],
  "312": [0, 0, 0, 7500],
  "320": [8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
  "330": [0, 0, 60000, 0, 0, 0, 0, 120000],
  "401": [0, 0, 0, 0, 800, 900, 950, 900, 850, 800],
  "402": [0, 0, 0, 0, 800, 800, 800, 800, 800, 800],
  "403": [20, 15, 60, 180, 120, 140, 120, 130, 170, 90],
  "404": [0, 0, 0, 0, 300, 300, 300, 300, 300, 300],
  "411": [0, 0, 2400],
  "412": [160, 160, 160, 160, 160, 160, 160, 160, 160, 160],
  "413": [190, 190, 190, 190, 190, 190, 190, 190, 190, 190],
  "414": [80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
};

/** Last year: a smaller membership, a smaller auction, no sponsorships. */
const LAST_YEAR: Record<string, number[]> = {
  "301": [100, 80, 600, 700, 1100, 1500, 1200, 1300, 2600, 800, 150, 200],
  "302": [150, 0, 200, 150, 300, 400, 250, 250, 700, 150, 300, 6500],
  "303": [0, 0, 4000, 0, 0, 3000, 0, 0, 0, 0, 0, 5000],
  "311": [0, 0, 0, 0, 1500, 1700, 1900, 1800, 1700, 1600],
  "312": [0, 0, 0, 6000],
  "320": [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  "330": [0, 0, 0, 0, 0, 90000, 0, 0, 0, 0, 0, 150000],
  "401": [0, 0, 0, 0, 700, 800, 800, 800, 750, 700],
  "402": [0, 0, 0, 0, 600, 600, 600, 600, 600, 600],
  "403": [15, 10, 50, 150, 100, 110, 100, 100, 140, 80, 20, 150],
  "404": [0, 0, 0, 0, 250, 250, 250, 250, 250, 250],
  "411": [0, 0, 1200],
  "412": [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150],
  "413": [120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120],
  "414": [400, 400, 450, 450, 450, 450, 450, 450, 450, 450, 400, 400],
};

/** The budget, entered by month in the months the money actually moves. */
const BUDGET: Record<string, number[]> = {
  "301": [100, 100, 700, 800, 1300, 1800, 1300, 1400, 2800, 900, 200, 200],
  "302": [200, 100, 250, 200, 350, 500, 300, 300, 800, 200, 400, 6000],
  "303": [0, 0, 5000, 0, 0, 4000, 0, 0, 0, 0, 0, 6000],
  "304": [0, 0, 0, 0, 1000, 0, 0, 1000],
  "311": [0, 0, 0, 0, 1600, 1900, 2000, 2000, 1900, 1800],
  "320": [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  "401": [0, 0, 0, 0, 750, 850, 900, 900, 850, 750],
  "402": [0, 0, 0, 0, 800, 800, 800, 800, 800, 800],
  "403": [20, 20, 50, 100, 100, 120, 110, 110, 150, 80, 30, 120],
  "404": [0, 0, 0, 0, 300, 300, 300, 300, 300, 300],
  "411": [0, 0, 2500],
  "412": [250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250],
  "413": [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
  "414": [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
};

export const FIXTURE_TIME = "2026-10-14T09:12:00.000-07:00";

export const FIXTURE_GROUPS =
  "Memberships=301;Donations and sponsorships=302,304;Operating grants=303;" +
  "Events and programs=310,400;Other=320;Operations=410;exclude=330";

export function linesFrom(figures: Record<string, number[]>, kind: Kind): FixtureLine[] {
  // Parents come first so children nest under them; a parent with no figures
  // of its own still appears, as QuickBooks prints it.
  return CHART.filter((a) => a.kind === kind && (figures[a.id] || CHART.some((c) => c.parentId === a.id)))
    .map((a) => ({ id: a.id, name: a.name, parentId: a.parentId, months: figures[a.id] ?? [] }));
}

export const FIXTURE_FIGURES = { thisYear: THIS_YEAR, lastYear: LAST_YEAR, budget: BUDGET };

/** Everything the fixture company would return. */
export function fixtureQbo(): {
  accounts: QboAccount[];
  thisYear: QboReport;
  lastYear: QboReport;
  budgets: QboBudget[];
} {
  return {
    accounts: fixtureAccounts(),
    thisYear: buildProfitAndLoss({
      start: "2026-01-01",
      time: FIXTURE_TIME,
      income: linesFrom(THIS_YEAR, "Revenue"),
      spending: linesFrom(THIS_YEAR, "Expense"),
    }),
    lastYear: buildProfitAndLoss({
      start: "2025-01-01",
      time: FIXTURE_TIME,
      income: linesFrom(LAST_YEAR, "Revenue"),
      spending: linesFrom(LAST_YEAR, "Expense"),
    }),
    budgets: [
      buildBudget({
        name: "FY2026 Board budget",
        start: "2026-01-01",
        lines: Object.entries(BUDGET).map(([accountId, months]) => ({ accountId, months })),
      }),
    ],
  };
}
