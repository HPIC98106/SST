/**
 * Grant details: each award on its own.
 *
 * Pinned: only a dated child is money received, so a schedule never counts; a
 * failed or partial payment read leaves Received blank rather than Still to arrive
 * large; Spent is null, never $0; rebuild and programs are totalled apart, and the
 * rebuild totals agree with the funnel; payments linked to no award stay out and
 * are counted; a note and an individual's name never leave the Worker; and every
 * request is a GET behind the passphrase.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleGrantDetails, getGrantDetails } from "../src/grant-details";
import worker from "../src/index";
import { getGrants, type LglGift, type ReadResult } from "../src/lgl";
import type { Env } from "../src/types";

const ENV = {
  ...env,
  LGL_MODE: "live",
  LGL_API_KEY: "test",
  ACCESS_PASSPHRASE: "test",
  LGL_GRANT_CAMPAIGN_IDS: "871",
  LGL_GRANT_GIFT_CATEGORY_IDS: "6031",
  LGL_GRANT_PAYMENT_CATEGORY_IDS: "6076",
  LGL_UI_BASE_URL: "https://example.littlegreenlight.com",
} as Env;

const BASE = { retrievedAt: "Fri, 30 Oct 2026 17:00:00 GMT", connection: "ok", source: "LGL" } as const;

let next = 1000;
const award = (fields: Partial<LglGift> = {}): LglGift =>
  ({
    id: next++,
    gift_type_id: 7,
    gift_type_name: "Pledge",
    gift_category_id: 6031,
    campaign_id: 871,
    constituent_id: 1,
    received_amount: 1000,
    received_date: "2026-03-01",
    ...fields,
  }) as LglGift;
const payment = (parent: number | null, amount: number, date: string | null = "2026-04-01", fields: Partial<LglGift> = {}): LglGift =>
  ({
    id: next++,
    gift_type_id: 1,
    gift_type_name: "Gift",
    gift_category_id: 6076,
    parent_gift_id: parent,
    received_amount: amount,
    received_date: date,
    ...fields,
  }) as LglGift;
const installment = (parent: number, amount: number, date: string | null = null): LglGift =>
  payment(parent, amount, date, { gift_type_id: 13, gift_type_name: "Installment", gift_category_id: null });

const read = (items: LglGift[]): ReadResult<LglGift> => ({ ok: true, items, complete: true, date: null });
const none = read([]);
const FUNDERS = new Map([[1, { id: 1, is_org: true, org_name: "City Arts Office" }]]);
const assemble = (
  awards: LglGift[],
  payments: ReadResult<LglGift> | null = none,
  installments: ReadResult<LglGift> = none,
) => assembleGrantDetails(ENV, awards, payments, installments, FUNDERS, BASE);

describe("what a grant has received", () => {
  it("counts dated payments and decrements what is still to arrive", () => {
    const a = award({ received_amount: 1000 });
    const grant = assemble([a], read([payment(a.id, 250), payment(a.id, 150, "2026-05-01")])).grants[0];
    expect(grant).toMatchObject({ awarded: 1000, received: 400, stillToArrive: 600, status: "partial", overBy: null });
    expect(grant.payments.map((p) => p.amount)).toEqual([150, 250]);
  });

  it("reports a schedule without counting it as money", () => {
    const a = award({ received_amount: 1000 });
    const grant = assemble([a], none, read([installment(a.id, 500), installment(a.id, 500)])).grants[0];
    expect(grant).toMatchObject({ received: 0, stillToArrive: 1000, status: "awaiting", scheduled: [500, 500] });
  });

  it("counts an installment once it has a date", () => {
    const a = award({ received_amount: 1000 });
    const grant = assemble([a], none, read([installment(a.id, 400, "2026-06-01")])).grants[0];
    expect(grant).toMatchObject({ received: 400, status: "partial", scheduled: [] });
  });

  it("does not count a record twice when both reads return it", () => {
    const a = award({ received_amount: 1000 });
    const both = installment(a.id, 400, "2026-06-01");
    expect(assemble([a], read([both]), read([both])).grants[0].received).toBe(400);
  });

  it("does not count a soft credit as money", () => {
    const a = award({ received_amount: 1000 });
    const soft = payment(a.id, 400, "2026-06-01", { gift_type_name: "Soft Credit" });
    expect(assemble([a], read([soft])).grants[0].received).toBe(0);
  });

  it("says when a grant is received in full, and when it has gone past its award", () => {
    const full = award({ received_amount: 1000 });
    const over = award({ received_amount: 1000 });
    const snapshot = assemble([full, over], read([payment(full.id, 1000), payment(over.id, 1250)]));
    const by = (id: number) => snapshot.grants.find((g) => g.id === id)!;
    expect(by(full.id)).toMatchObject({ status: "full", stillToArrive: 0 });
    expect(by(over.id)).toMatchObject({ status: "over", stillToArrive: 0, overBy: 250 });
  });

  it.each([
    ["no category is configured", null, none],
    ["the payment read failed", { ok: false, detail: "down" } as ReadResult<LglGift>, none],
    ["the payment read stopped early", { ok: true, items: [], complete: false, date: null } as ReadResult<LglGift>, none],
    ["the installment read failed", none, { ok: false, detail: "down" } as ReadResult<LglGift>],
  ])("shows no received figure when %s", (_why, payments, installments) => {
    const snapshot = assemble([award({ received_amount: 1000 })], payments, installments);
    expect(snapshot.grants[0]).toMatchObject({ received: null, stillToArrive: null, status: "unknown" });
    expect(snapshot.totals.rebuild).toMatchObject({ awarded: 1000, received: null, stillToArrive: null });
    expect(snapshot.note).toContain("could not be read completely");
  });

  it("keeps spending blank rather than calling it $0", () => {
    expect(assemble([award()]).grants[0].spent).toBeNull();
  });
});

describe("links into LGL", () => {
  it("opens exactly the records behind each figure, by gift ID", () => {
    const UI = ENV.LGL_UI_BASE_URL;
    const a = award({ received_amount: 1000 });
    const other = award({ campaign_id: 841, received_amount: 300 });
    const paid = payment(a.id, 100);
    const stray = payment(null, 50);
    const schedule = installment(other.id, 300);
    const snapshot = assemble([a, other], read([paid, stray]), read([schedule]));
    const byId = (id: number) => snapshot.grants.find((g) => g.id === id)!;

    expect(byId(a.id).url).toBe(`${UI}/gifts/${a.id}`);
    expect(byId(a.id).receivedUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${paid.id}`);
    expect(byId(other.id).receivedUrl).toBeNull();
    expect(snapshot.totals.rebuild.awardedUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${a.id}`);
    expect(snapshot.totals.rebuild.receivedUrl).toBe(`${UI}/fundraising/search/gt/gift/gids/${paid.id}`);
    expect(snapshot.totals.operating.receivedUrl).toBeNull();
    expect(snapshot.unlinkedPayments?.url).toBe(`${UI}/fundraising/search/gt/gift/gids/${stray.id}`);
  });
});

describe("the list as a whole", () => {
  it("totals rebuild and programs apart", () => {
    const rebuild = award({ received_amount: 1000 });
    const programs = award({ campaign_id: 841, received_amount: 300 });
    const { totals } = assemble([rebuild, programs], read([payment(rebuild.id, 100), payment(programs.id, 30)]));
    expect(totals.rebuild).toMatchObject({ count: 1, awarded: 1000, received: 100, stillToArrive: 900 });
    expect(totals.operating).toMatchObject({ count: 1, awarded: 300, received: 30, stillToArrive: 270 });
  });

  it("lists most still to arrive first, then the newest award", () => {
    const received = award({ received_amount: 100, received_date: "2026-05-01" });
    const older = award({ received_amount: 100, received_date: "2024-05-01" });
    const big = award({ received_amount: 900 });
    const small = award({ received_amount: 50 });
    const snapshot = assemble([older, small, big, received], read([payment(received.id, 100), payment(older.id, 100)]));
    expect(snapshot.grants.map((g) => g.id)).toEqual([big.id, small.id, received.id, older.id]);
  });

  it("counts payments linked to no award, and adds them to no grant", () => {
    const a = award();
    const snapshot = assemble([a], read([payment(null, 700), payment(99999, 50)]));
    expect(snapshot.unlinkedPayments).toMatchObject({ count: 2, amount: 750 });
    expect(snapshot.grants[0].received).toBe(0);
  });
});

describe("naming a grant", () => {
  const named = (value: string) =>
    award({ custom_fields: [{ name: "Grant Name", key: "a1b2c3d4_uuid", values: [{ name: value }] }] });

  it("uses the Grant Name field in LGL, matched on its name", () => {
    expect(assemble([named("Sustained Support")]).grants[0]).toMatchObject({ name: "Sustained Support", named: true });
  });

  it("falls back to the funder and award year", () => {
    expect(assemble([award()]).grants[0]).toMatchObject({ name: "City Arts Office, 2026", named: false, funder: "City Arts Office" });
  });

  it("falls back to the record when the funder could not be read", () => {
    const a = award({ constituent_id: 2 });
    expect(assemble([a]).grants[0]).toMatchObject({ name: `Grant ${a.id}`, funder: null });
  });

  it("never names an individual funder", () => {
    const a = award({ constituent_id: 3 });
    const person = new Map([[3, { id: 3, is_org: false, first_name: "Pat", last_name: "Example", sort_name: "Example, Pat" }]]);
    const snapshot = assembleGrantDetails(ENV, [a], none, none, person, BASE);
    expect(snapshot.grants[0].funder).toBe("Individual funder");
    expect(JSON.stringify(snapshot)).not.toContain("Example");
  });

  it("never sends a note to the page", () => {
    const a = award({ note: "From staffer@example.gov on 1/15/2026" });
    const b = payment(a.id, 100, "2026-04-01", { note: "Internal remark" });
    const body = JSON.stringify(assemble([a], read([b])));
    expect(body).not.toContain("staffer");
    expect(body).not.toContain("Internal remark");
  });
});

describe("payment terms", () => {
  const withTerms = (value: string) =>
    award({ custom_fields: [{ name: "Payment Terms", key: "uuid", values: [{ name: value }] }] });

  it("reads them, and reports unset and unreadable apart", () => {
    expect(assemble([withTerms("Reimbursable")]).grants[0]).toMatchObject({ terms: "reimbursable", termsUnreadable: null });
    expect(assemble([award()]).grants[0]).toMatchObject({ terms: "unknown", termsUnreadable: null });
    expect(assemble([withTerms("Quarterly")]).grants[0]).toMatchObject({ terms: "unknown", termsUnreadable: "Quarterly" });
  });
});

describe("reading LGL", () => {
  afterEach(() => vi.unstubAllGlobals());

  const route = (awards: LglGift[], children: LglGift[], methods: string[] = [], asked: string[] = []) =>
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      methods.push(init?.method ?? "GET");
      const headers = { "content-type": "application/json", date: "Fri, 30 Oct 2026 17:00:00 GMT" };
      const list = (items: unknown[]) => new Response(JSON.stringify({ items, total_items: items.length }), { status: 200, headers });
      if (url.pathname.endsWith("/gift_types")) return list([{ id: 1, name: "Gift" }, { id: 7, name: "Pledge" }, { id: 13, name: "Installment" }]);
      if (url.pathname.includes("/constituents/")) return new Response(JSON.stringify({ id: 1, is_org: true, org_name: "City Arts Office" }), { status: 200, headers });
      const q = url.searchParams.get("q[]") ?? "";
      asked.push(q);
      if (q.includes("gift_types=in|7")) return list(awards.filter((a) => !q.includes("campaigns=in|871") || a.campaign_id === 871));
      if (q.includes("gift_types=in|13")) return list(children.filter((c) => c.gift_type_name === "Installment"));
      return list(children.filter((c) => c.gift_category_id === 6076));
    });

  it("reads awards across every campaign, never filters payments by one, and only ever GETs", async () => {
    const a = award({ campaign_id: 841, received_amount: 500 });
    const methods: string[] = [];
    const asked: string[] = [];
    route([a], [payment(a.id, 200, "2026-04-01", { campaign_id: 0 })], methods, asked);
    const snapshot = await getGrantDetails(ENV);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.grants[0]).toMatchObject({ scope: "operating", received: 200, funder: "City Arts Office" });
    expect(asked.some((q) => q.includes("campaigns="))).toBe(false);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  it("agrees with the funnel on the rebuild", async () => {
    const a = award({ received_amount: 1000 });
    const b = award({ received_amount: 2000 });
    const other = award({ campaign_id: 841, received_amount: 300 });
    route([a, b, other], [payment(a.id, 400), payment(null, 50)]);
    const [details, funnel] = await Promise.all([getGrantDetails(ENV), getGrants(ENV)]);
    const stage = (key: string) => funnel.stages.find((s) => s.key === key)?.amount;
    expect(details.totals.rebuild.awarded).toBe(stage("pledged"));
    expect(details.totals.rebuild.received).toBe(stage("received"));
    expect(details.totals.rebuild.stillToArrive).toBe(stage("outstanding"));
  });

  it("shows nothing when the awards stop before the last one", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      const headers = { "content-type": "application/json", date: "Fri, 30 Oct 2026 17:00:00 GMT" };
      const items = url.pathname.endsWith("/gift_types") ? [{ id: 7, name: "Pledge" }] : Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const total = url.pathname.endsWith("/gift_types") ? 1 : 99999;
      return new Response(JSON.stringify({ items, total_items: total }), { status: 200, headers });
    });
    const snapshot = await getGrantDetails(ENV);
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.grants).toEqual([]);
  });

  it("says what is missing rather than reading every pledge as a grant", async () => {
    const snapshot = await getGrantDetails({ ...ENV, LGL_GRANT_GIFT_CATEGORY_IDS: undefined } as Env);
    expect(snapshot.status).toBe("not_configured");
    expect(snapshot.grants).toEqual([]);
  });

  it("stays behind the passphrase", async () => {
    const response = await worker.fetch(new Request("https://worker.test/api/grant-details"), ENV);
    expect(response.status).toBe(401);
  });
});
