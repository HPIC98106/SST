/**
 * The only place this app talks to the network.
 *
 * The frontend holds no credentials and nothing about HPIC in its bundle. It sends
 * the shared passphrase and receives labels, amounts, and links into LGL and
 * QuickBooks. A link can carry a QuickBooks account ID, which opens nothing without
 * QuickBooks' own login, and none names the company.
 */

import type { CommunitySnapshot, FundsSnapshot, GrantDetailsSnapshot, GrantSnapshot, OperationsSnapshot } from "./types";

const WORKER_URL: string = import.meta.env.VITE_WORKER_URL ?? "http://127.0.0.1:8787";

/** Thrown when the passphrase is wrong or missing, so the gate can reappear. */
export class NotAuthorizedError extends Error {}

async function get<T>(path: string, passphrase: string): Promise<T> {
  const response = await fetch(`${WORKER_URL}${path}`, {
    headers: { "X-HPIC-Auth": passphrase },
  });

  if (response.status === 401) {
    throw new NotAuthorizedError("Passphrase not accepted.");
  }
  if (!response.ok) {
    throw new Error(`The server returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function fetchFunds(passphrase: string): Promise<FundsSnapshot> {
  return get<FundsSnapshot>("/api/funds", passphrase);
}

export function fetchOperations(passphrase: string): Promise<OperationsSnapshot> {
  return get<OperationsSnapshot>("/api/operations", passphrase);
}

export function fetchGrants(passphrase: string): Promise<GrantSnapshot> {
  return get<GrantSnapshot>("/api/grants", passphrase);
}

export function fetchGrantDetails(passphrase: string): Promise<GrantDetailsSnapshot> {
  return get<GrantDetailsSnapshot>("/api/grant-details", passphrase);
}

export function fetchCommunity(passphrase: string): Promise<CommunitySnapshot> {
  return get<CommunitySnapshot>("/api/community", passphrase);
}
