/**
 * Grant details: each award on its own, so nobody has to open LGL to see where one
 * stands. Every grant in LGL, rebuild and programs alike, where the funnel covers
 * the rebuild only.
 *
 * What an award looks like in LGL, verified 2026-10-31:
 *
 * **An award has no name.** Only its funder, and one funder can hold several. A
 * Gift custom field called "Grant Name" supplies one; until it is filled in, the
 * funder and award year stand in, and the page counts how many do.
 *
 * **Only a dated child is money received.** An Installment is created undated as a
 * schedule, carrying an amount but no date. LGL does not mark one when a payment
 * arrives: 4Culture has a $7,936 Gift beside two undated $7,936 installments. So
 * an undated child is reported as scheduled and never counted, and it can include
 * one already paid, which the page says.
 *
 * **Notes never leave the Worker.** They hold funder staff names and email
 * addresses, and everyone shares one passphrase. Only an organization's name is
 * sent, and an individual funder is not named at all.
 *
 * **Spent is always `not_tracked` for now.** QuickBooks is the only place it can
 * come from, and on 2026-10-31 none of its rebuild expense lines named a customer
 * or project. `null` is what keeps a grant from reading as $0 spent.
 *
 * The rule from the funnel holds: a payment read that fails or stops early leaves
 * Received unavailable on every grant, because a missing read would otherwise
 * become a larger "still to arrive".
 */

import {
  getAll,
  getRecord,
  giftAmount,
  giftIdsUrl,
  giftTypeIds,
  giftUrl,
  isFixtureMode,
  parseIds,
  readGrantName,
  readPaymentTerms,
  readPayments,
  SOURCE_LABEL,
  type LglConstituent,
  type LglGift,
  type ReadResult,
} from "./lgl";
import type { Env, GrantDetail, GrantDetailsSnapshot, GrantScope, GrantStatus, GrantTotals } from "./types";

/** A soft credit is a second record of a gift already counted, and in-kind is not money. */
const CASH_TYPES = new Set(["Gift", "Installment", "Matching"]);

const cents = (g: LglGift) => Math.round(giftAmount(g) * 100);
const dollars = (c: number) => c / 100;
const emptyTotals = (received: number | null): GrantTotals => ({
  count: 0,
  awarded: 0,
  received,
  stillToArrive: received,
  awardedUrl: null,
  receivedUrl: null,
});

function funderLabel(record: LglConstituent | null | undefined): string | null {
  if (!record) return null;
  if (!record.is_org) return "Individual funder";
  return record.org_name?.trim() || record.sort_name?.trim() || null;
}

/** Everything the page needs to know about one award. Exported for tests. */
export function assembleGrantDetails(
  env: Env,
  awards: LglGift[],
  payments: ReadResult<LglGift> | null,
  installments: ReadResult<LglGift>,
  funders: Map<number, LglConstituent | null>,
  base: Pick<GrantDetailsSnapshot, "retrievedAt" | "connection" | "source">,
): GrantDetailsSnapshot {
  const rebuildCampaigns = parseIds(env.LGL_GRANT_CAMPAIGN_IDS);
  const readable = (r: ReadResult<LglGift> | null): r is Extract<ReadResult<LglGift>, { ok: true }> =>
    r !== null && r.ok && r.complete;
  const complete = readable(payments) && readable(installments);

  const awardIds = new Set(awards.map((a) => a.id));
  const paymentItems = readable(payments) ? payments.items : [];
  const installmentItems = readable(installments) ? installments.items : [];
  const seen = new Set<number>();
  const children = [...paymentItems, ...installmentItems].filter((g) => {
    if (seen.has(g.id) || !CASH_TYPES.has(g.gift_type_name ?? "")) return false;
    seen.add(g.id);
    return true;
  });

  const grants: GrantDetail[] = awards.map((award) => {
    const funder = funderLabel(funders.get(award.constituent_id ?? -1));
    const givenName = readGrantName(award);
    const year = award.received_date?.slice(0, 4);
    const fallback = funder ? (year ? `${funder}, ${year}` : funder) : `Grant ${award.id}`;

    const mine = children.filter((g) => g.parent_gift_id === award.id);
    const paid = mine.filter((g) => g.received_date);
    const awardedCents = cents(award);
    const receivedCents = paid.reduce((sum, g) => sum + cents(g), 0);

    const status: GrantStatus = !complete
      ? "unknown"
      : receivedCents === 0
        ? "awaiting"
        : receivedCents < awardedCents
          ? "partial"
          : receivedCents === awardedCents
            ? "full"
            : "over";

    const terms = readPaymentTerms(award);
    const scope: GrantScope = rebuildCampaigns.includes(award.campaign_id ?? -1) ? "rebuild" : "operating";

    return {
      id: award.id,
      name: givenName ?? fallback,
      named: givenName !== null,
      funder,
      scope,
      awardDate: award.received_date ?? null,
      awarded: dollars(awardedCents),
      spent: null,
      received: complete ? dollars(receivedCents) : null,
      stillToArrive: complete ? dollars(Math.max(awardedCents - receivedCents, 0)) : null,
      receivedUrl: complete ? giftIdsUrl(env, paid.map((g) => g.id)) : null,
      overBy: complete && receivedCents > awardedCents ? dollars(receivedCents - awardedCents) : null,
      status,
      terms: terms.status,
      termsUnreadable: terms.unrecognizedValue,
      payments: paid
        .map((g) => ({ id: g.id, date: g.received_date!, amount: dollars(cents(g)), url: giftUrl(env, g.id) }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      scheduled: mine.filter((g) => !g.received_date).map((g) => dollars(cents(g))),
      url: giftUrl(env, award.id),
    };
  });

  // Most still to arrive first; among the rest, the newest award first.
  grants.sort(
    (a, b) => (b.stillToArrive ?? 0) - (a.stillToArrive ?? 0) || (b.awardDate ?? "").localeCompare(a.awardDate ?? ""),
  );

  const totals = { rebuild: emptyTotals(complete ? 0 : null), operating: emptyTotals(complete ? 0 : null) };
  for (const grant of grants) {
    const t = totals[grant.scope];
    t.count += 1;
    t.awarded += grant.awarded;
    if (grant.received !== null) t.received! += grant.received;
    if (grant.stillToArrive !== null) t.stillToArrive! += grant.stillToArrive;
  }
  for (const scope of ["rebuild", "operating"] as const) {
    const mine = grants.filter((g) => g.scope === scope);
    totals[scope].awardedUrl = giftIdsUrl(env, mine.map((g) => g.id));
    totals[scope].receivedUrl = complete ? giftIdsUrl(env, mine.flatMap((g) => g.payments.map((p) => p.id))) : null;
  }

  const unlinked = readable(payments)
    ? payments.items.filter(
        (g) => CASH_TYPES.has(g.gift_type_name ?? "") && g.received_date && !awardIds.has(g.parent_gift_id ?? -1),
      )
    : null;

  return {
    status: "ok",
    note: complete
      ? undefined
      : "LGL's payment records could not be read completely, so what each grant has received is not shown.",
    grants,
    totals,
    unlinkedPayments: unlinked
      ? {
          count: unlinked.length,
          amount: dollars(unlinked.reduce((sum, g) => sum + cents(g), 0)),
          url: giftIdsUrl(env, unlinked.map((g) => g.id)),
        }
      : null,
    ...base,
  };
}

function empty(
  status: GrantDetailsSnapshot["status"],
  connection: GrantDetailsSnapshot["connection"],
  note: string,
): GrantDetailsSnapshot {
  return {
    status,
    note,
    grants: [],
    totals: { rebuild: emptyTotals(null), operating: emptyTotals(null) },
    unlinkedPayments: null,
    retrievedAt: null,
    source: SOURCE_LABEL,
    connection,
  };
}

export async function getGrantDetails(env: Env): Promise<GrantDetailsSnapshot> {
  const fixture = isFixtureMode(env);
  if (!fixture && !env.LGL_API_KEY) {
    return empty("not_configured", "not_configured", "No LGL API key is set on the Worker.");
  }
  const categories = parseIds(env.LGL_GRANT_GIFT_CATEGORY_IDS);
  if (categories.length === 0) {
    return empty("not_configured", "ok", "No grant award category is set on the Worker, so grants cannot be told from other pledges.");
  }

  const types = await giftTypeIds(env, ["pledge"]);
  if (!types.ok) return empty("unavailable", "unavailable", types.detail);

  // Across every campaign, unlike the funnel, and payments never filtered by one.
  const installmentType = types.ids.installment;
  const [awards, payments, installments] = await Promise.all([
    getAll<LglGift>(env, "gifts/search", [["q[]", `gift_types=in|${types.ids.pledge};categories=in|${categories.join(",")}`]]),
    readPayments(env),
    installmentType === undefined
      ? Promise.resolve<ReadResult<LglGift>>({ ok: true, items: [], complete: true, date: null })
      : getAll<LglGift>(env, "gifts/search", [["q[]", `gift_types=in|${installmentType}`]]),
  ]);
  if (!awards.ok) return empty("unavailable", "unavailable", awards.detail);
  if (!awards.complete) {
    return empty("unavailable", "ok", "LGL holds more grant awards than one read allows, so the list would be short. Nothing is shown.");
  }

  // Best effort: a funder that cannot be read costs a label, never a figure.
  const ids = [...new Set(awards.items.map((a) => a.constituent_id).filter((id): id is number => typeof id === "number"))];
  const records = await Promise.all(ids.map((id) => getRecord<LglConstituent>(env, `constituents/${id}`)));
  const funders = new Map(ids.map((id, i) => [id, records[i]]));

  return assembleGrantDetails(env, awards.items, payments, installments, funders, {
    retrievedAt: awards.date,
    connection: fixture ? "fixture" : "ok",
    source: fixture ? `${SOURCE_LABEL} (fixture data)` : SOURCE_LABEL,
  });
}
