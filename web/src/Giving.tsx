/**
 * Giving: who gave, how the year is building, and through which campaigns.
 *
 * One definition across the tab: a gift is money given. Dues are on Membership,
 * grant payments on Grants, and sales such as the Pot Auction in Operations, so
 * none of them is here, and the donor count and the table describe the same gifts.
 */

import { CumulativeChart } from "./CumulativeChart";
import { How, SourceLine } from "./Disclosure";
import { formatDate, usd } from "./format";
import { LglLink } from "./LglLink";
import { Kpi } from "./Overview";
import type { CommunitySnapshot } from "./types";

export function GivingView({ snapshot }: { snapshot: CommunitySnapshot }) {
  if (snapshot.status !== "ok") {
    return (
      <section className="panel">
        <h1>Giving</h1>
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
          {snapshot.note ?? "LGL could not be read."}
        </p>
      </section>
    );
  }

  const { donors, monthly, year } = snapshot;

  return (
    <section className="panel">
      <h1>Giving</h1>
      <p className="muted">
        As LGL holds it through {formatDate(snapshot.through!)}.
        {snapshot.connection === "fixture" ? " Fixture data." : ""}
      </p>

      <div className="giving-top">
        <Kpi
          label={`Donors in ${year}`}
          value={donors ? donors.thisYear.toLocaleString("en-US") : "Not shown"}
          tone={donors ? undefined : "unavailable"}
          detail={
            donors ? (
              <>
                <LglLink url={donors.giftsUrl}>
                  See their {donors.gifts.toLocaleString("en-US")} {donors.gifts === 1 ? "gift" : "gifts"} in LGL
                </LglLink>
              </>
            ) : undefined
          }
        />
        {monthly ? (
          <CumulativeChart
            title="Giving, cumulative"
            months={monthly.months}
            series={[
              { key: "this", label: String(year), values: monthly.giving.thisYear, className: "series-actual" },
              { key: "last", label: String(year! - 1), values: monthly.giving.lastYear, className: "series-last" },
            ]}
          />
        ) : null}
      </div>

      <h2 className="section-title">Giving by campaign</h2>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col" className="num">{year} so far</th>
              <th scope="col" className="num">All of {year! - 1}</th>
              <th scope="col" className="num">Gifts in {year}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.byCampaign.map((c) => (
              <tr key={c.campaign}>
                <th scope="row">{c.campaign}</th>
                <td className="num">
                  <LglLink url={c.thisYearUrl}>{usd.format(c.thisYear)}</LglLink>
                </td>
                <td className="num">
                  <LglLink url={c.lastYearUrl}>{usd.format(c.lastYearTotal)}</LglLink>
                </td>
                <td className="num">
                  <LglLink url={c.thisYearUrl}>{c.gifts.toLocaleString("en-US")}</LglLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">Gifts only: dues, grant payments and sales are on their own tabs.</p>

      <How>
        <p>
          <strong>A gift is money given.</strong> Dues are on the Membership tab and grant payments on the Grants and
          Rebuild tabs, so neither is counted here, and the donor count and the table describe the same gifts.
        </p>
        {snapshot.purchasesThisYear > 0 ? (
          <p>
            <strong>Sales are not gifts.</strong> Sales such as the Pot Auction ({usd.format(snapshot.purchasesThisYear)}{" "}
            this year) are purchases, so they are under Events and programs on the Operations tab, and a buyer is not
            counted as a donor.
          </p>
        ) : null}
        <p>
          <strong>The Annual Fund Drive lands mostly in December</strong>, so giving and the donor count read low until
          then.
        </p>
        <p>
          Source: {snapshot.source}, {snapshot.giftCount.toLocaleString("en-US")} cash gifts read. LGL holds only what
          has been entered in it. Linked numbers open in LGL, which needs its own login.
          {snapshot.cached ? " LGL is read about once an hour, so a change there can take that long to show." : ""}
        </p>
      </How>
      <SourceLine lgl={snapshot.retrievedAt} />
    </section>
  );
}
