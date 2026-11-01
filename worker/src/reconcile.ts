/**
 * Do Little Green Light and QuickBooks agree?
 *
 * The data-quality list says which records break a rule. This says whether the
 * two systems hold the same money, one kind at a time, over the completed months
 * Operations reports. Nothing here is a new read: it sets two snapshots side by side.
 *
 * A difference is shown in cents and never explained away, and there is no
 * threshold below which one counts as agreeing, which is the Operations rule too.
 * QuickBooks books by accrual and LGL by date received, so a difference can be
 * timing; only someone looking at the records can say.
 *
 * "Nothing differs" must mean both were read. If either read is incomplete there
 * is no comparison at all, rather than an empty list that looks like agreement.
 *
 * QuickBooks' lines are found by the names in QBO_PL_GROUPS. A renamed line reports
 * "not compared" rather than comparing against nothing.
 */

import { giftIds, giftSearch, type CommunityConfig } from "./community";
import type { CommunitySnapshot, OperationsSnapshot, ReconciliationRow, ReconciliationSnapshot } from "./types";

const DUES_LINE = "Membership dues";
const GRANTS_LINE = "Grants";

const cents = (dollars: number) => Math.round(dollars * 100);

function compare(
  key: ReconciliationRow["key"],
  label: string,
  lgl: number | null,
  qbo: number | null,
  lglUrl: string | null,
  qboUrl: string | null,
  note?: string,
): ReconciliationRow {
  const compared = lgl !== null && qbo !== null;
  const difference = compared ? (cents(lgl) - cents(qbo)) / 100 : null;
  return {
    key,
    label,
    status: !compared ? "not_compared" : difference === 0 ? "match" : "differs",
    lgl,
    qbo,
    difference,
    lglUrl,
    qboUrl,
    ...(note ? { note } : {}),
  };
}

function unavailable(note: string, community: CommunitySnapshot, operations: OperationsSnapshot): ReconciliationSnapshot {
  return {
    status: "unavailable",
    note,
    period: null,
    rows: [],
    lglRetrievedAt: community.retrievedAt,
    qboRetrievedAt: operations.retrievedAt,
  };
}

export function assembleReconciliation(
  community: CommunitySnapshot,
  operations: OperationsSnapshot,
  config: CommunityConfig,
): ReconciliationSnapshot {
  if (community.status !== "ok" || !community.monthly || community.year === null) {
    return unavailable("LGL could not be read completely, so nothing was compared.", community, operations);
  }
  if (operations.status !== "ok" || !operations.period) {
    return unavailable("QuickBooks could not be read completely, so nothing was compared.", community, operations);
  }

  const { fiscalYearStart: from, through } = operations.period;
  const year = Number(from.slice(0, 4));
  // LGL's series are by calendar year, and only this year and last are held.
  const dues =
    year === community.year
      ? community.monthly.dues.thisYear
      : year === community.year - 1
        ? community.monthly.dues.lastYear
        : null;
  if (!from.endsWith("-01-01") || !through.startsWith(`${year}-`) || !dues) {
    return unavailable(`The two systems hold different years (${from} to ${through}), so nothing was compared.`, community, operations);
  }

  const months = dues.slice(0, Number(through.slice(5, 7)));
  const lglDues = months.every((m) => m !== null) ? months.reduce<number>((s, m) => s + m!, 0) : null;
  const line = (label: string) => operations.groups.find((g) => g.side === "income" && g.label === label) ?? null;
  const duesLine = line(DUES_LINE);
  const grantsLine = line(GRANTS_LINE);

  const paymentsIn = (scope: "rebuild" | "operating") =>
    community.grantPayments?.filter((p) => p.scope === scope && p.date >= from && p.date <= through) ?? null;
  const total = (list: { amount: number }[] | null) => (list ? list.reduce((s, p) => s + cents(p.amount), 0) / 100 : null);
  const unlinkedNote = (list: { linked: boolean }[] | null) => {
    const unlinked = list?.filter((p) => !p.linked).length ?? 0;
    return unlinked > 0
      ? `${unlinked} of these ${unlinked === 1 ? "is" : "are"} linked to no award, so sorted by ${unlinked === 1 ? "its" : "their"} own campaign.`
      : undefined;
  };
  const operating = paymentsIn("operating");
  const rebuild = paymentsIn("rebuild");
  const noLine = (label: string) => `QuickBooks' report has no income line called "${label}".`;

  return {
    status: "ok",
    period: { from, through },
    rows: [
      compare(
        "dues",
        "Membership dues",
        lglDues,
        duesLine?.actual ?? null,
        config.membershipCampaigns.length > 0
          ? giftSearch(config, `campaign/${config.membershipCampaigns.join(",")}`, from, through)
          : null,
        duesLine?.url ?? null,
        duesLine ? undefined : noLine(DUES_LINE),
      ),
      compare(
        "operating_grants",
        "Operating grants",
        total(operating),
        grantsLine?.actual ?? null,
        giftIds(config, (operating ?? []).map((p) => p.id)),
        grantsLine?.url ?? null,
        grantsLine ? unlinkedNote(operating) : noLine(GRANTS_LINE),
      ),
      compare(
        "rebuild_grants",
        "Rebuild grants",
        total(rebuild),
        operations.excluded?.income ?? null,
        giftIds(config, (rebuild ?? []).map((p) => p.id)),
        operations.excluded?.url ?? null,
        unlinkedNote(rebuild),
      ),
    ],
    lglRetrievedAt: community.retrievedAt,
    qboRetrievedAt: operations.retrievedAt,
  };
}
