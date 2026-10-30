/**
 * Recorded QuickBooks response shapes, used when QBO_MODE=fixture.
 *
 * These exist so the whole dashboard — Worker, frontend, degradation paths —
 * can be built and reviewed before an Intuit developer app and sandbox company
 * exist, and so the UI stays testable afterwards without burning API calls.
 *
 * Shapes are copied from Intuit's published Account samples. Two accounts are
 * rebuild accounts, so the panel shows a group with a real subtotal, and one
 * carries a CurrentBalanceWithSubAccounts that differs from CurrentBalance, so
 * the sub-account notice renders in development.
 */

import type { AccountReadResult, QboAccount } from "./qbo";

/** A stable, obviously-fake retrieval timestamp. */
const FIXTURE_TIME = "2026-08-12T09:14:03.412-07:00";

const FIXTURE_ACCOUNTS: Record<string, QboAccount> = {
  "35": {
    Id: "35",
    Name: "Operating Checking",
    FullyQualifiedName: "Operating Checking",
    Classification: "Asset",
    AccountType: "Bank",
    AccountSubType: "Checking",
    CurrentBalance: 84213.55,
    CurrentBalanceWithSubAccounts: 84213.55,
    MetaData: { LastUpdatedTime: "2026-08-11T16:02:44-07:00" },
  },
  "36": {
    Id: "36",
    Name: "Rebuild Savings",
    FullyQualifiedName: "Rebuild Savings",
    Classification: "Asset",
    AccountType: "Bank",
    AccountSubType: "Savings",
    CurrentBalance: 512000.0,
    CurrentBalanceWithSubAccounts: 512480.19,
    MetaData: { LastUpdatedTime: "2026-08-11T16:02:44-07:00" },
  },
  "37": {
    Id: "37",
    Name: "Rebuild Checking",
    FullyQualifiedName: "Rebuild Checking",
    Classification: "Asset",
    AccountType: "Bank",
    AccountSubType: "Checking",
    CurrentBalance: 31406.12,
    CurrentBalanceWithSubAccounts: 31406.12,
    MetaData: { LastUpdatedTime: "2026-08-11T16:02:44-07:00" },
  },
};

export function fixtureAccount(id: string): AccountReadResult {
  const account = FIXTURE_ACCOUNTS[id];
  if (!account) {
    return { ok: false, kind: "not_found", detail: `No fixture account ${id}` };
  }
  return { ok: true, time: FIXTURE_TIME, account };
}

export const FIXTURE_RETRIEVED_AT = FIXTURE_TIME;
