/**
 * Membership: who is a member today, who is new, who has given, and giving by
 * campaign.
 *
 * Counts only. Names stay in LGL: the dashboard has one shared passphrase, and
 * who has not renewed is a list for the membership committee, not a figure
 * for every board member's phone.
 */

import { CumulativeChart } from "./CumulativeChart";
import { formatDate, formatRetrievedAt, usd0 } from "./format";
import { MemberKpis } from "./Overview";
import type { CommunitySnapshot } from "./types";

export function MembershipView({ snapshot }: { snapshot: CommunitySnapshot }) {
  if (snapshot.status !== "ok") {
    return (
      <section className="panel">
        <h1>Membership</h1>
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
          {snapshot.note ?? "LGL could not be read."}
        </p>
      </section>
    );
  }

  const { members, donors, monthly, year } = snapshot;

  return (
    <section className="panel">
      <h1>Membership</h1>
      <p className="muted">
        As LGL holds it through {formatDate(snapshot.through!)}.
        {snapshot.connection === "fixture" ? " Fixture data." : ""}
      </p>

      <div className="kpis kpis-3">
        <MemberKpis members={members} donors={donors} year={year} />
      </div>

      {members ? (
        <p className="note">
          By level: {members.byLevel.map((l) => `${l.count.toLocaleString("en-US")} ${l.level}`).join(", ")}.
          {members.dues
            ? ` ${members.dues.payers.toLocaleString("en-US")} people paid ${usd0.format(members.dues.amount)} in dues this year. Members outnumber them because one payment can cover a household, and some paid before January or through the December drive.`
            : ""}{" "}
          Names are in LGL, not here.
        </p>
      ) : null}

      {monthly ? (
        <div className="charts">
          {members?.dues ? (
            <CumulativeChart
              title="Membership dues, cumulative"
              months={monthly.months}
              series={[
                { key: "this", label: String(year), values: monthly.dues.thisYear, className: "series-actual" },
                { key: "last", label: String(year! - 1), values: monthly.dues.lastYear, className: "series-last" },
              ]}
            />
          ) : null}
          <CumulativeChart
            title="All giving except grants, cumulative"
            months={monthly.months}
            series={[
              { key: "this", label: String(year), values: monthly.giving.thisYear, className: "series-actual" },
              { key: "last", label: String(year! - 1), values: monthly.giving.lastYear, className: "series-last" },
            ]}
          />
        </div>
      ) : null}

      <h2 className="section-title">Giving by campaign</h2>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col" className="num">{year} so far</th>
              <th scope="col" className="num">Same days of {year! - 1}</th>
              <th scope="col" className="num">All of {year! - 1}</th>
              <th scope="col" className="num">Gifts in {year}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.byCampaign.map((c) => (
              <tr key={c.campaign}>
                <th scope="row">{c.campaign}</th>
                <td className="num">{usd0.format(c.thisYear)}</td>
                <td className="num">{usd0.format(c.lastYearSamePeriod)}</td>
                <td className="num">{usd0.format(c.lastYearTotal)}</td>
                <td className="num">{c.gifts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-footer">
        <p>
          <strong>Source:</strong> {snapshot.source}, {snapshot.giftCount.toLocaleString("en-US")} cash gifts read. LGL
          holds only what has been entered in it.
        </p>
        <p>
          <strong>Data retrieved from LGL:</strong> {formatRetrievedAt(snapshot.retrievedAt)}
          {snapshot.cached ? " (cached, refreshed at least every 15 minutes)" : ""}
        </p>
      </div>
    </section>
  );
}
