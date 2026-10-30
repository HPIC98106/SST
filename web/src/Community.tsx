/**
 * Community: members, people giving, and giving by campaign, this year
 * against last.
 *
 * Counts only. Names stay in LGL: the dashboard has one shared passphrase, and
 * who has not renewed is a list for the membership committee, not a figure
 * for every board member's phone.
 */

import { CumulativeChart } from "./CumulativeChart";
import { formatDate, formatRetrievedAt, signed, usd0 } from "./format";
import { Kpi } from "./Overview";
import type { CommunitySnapshot } from "./types";

export function CommunityView({ snapshot }: { snapshot: CommunitySnapshot }) {
  if (snapshot.status !== "ok") {
    return (
      <section className="panel">
        <h1>Community</h1>
        <p className={`banner ${snapshot.status === "not_configured" ? "banner-warn" : "banner-error"}`}>
          {snapshot.note ?? "LGL could not be read."}
        </p>
      </section>
    );
  }

  const { members, supporters, monthly, year } = snapshot;
  const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");

  return (
    <section className="panel">
      <h1>Community</h1>
      <p className="muted">
        {year} so far, through {formatDate(snapshot.through!)}, against the same days of {year! - 1}.
        {snapshot.connection === "fixture" ? " Fixture data." : ""}
      </p>

      {members ? (
        <>
          <h2 className="section-title">Members</h2>
          <div className="kpis">
            <Kpi label="Members" value={members.thisYear} detail={`${signed(members.thisYear - members.lastYear)} on ${members.lastYear} last year`} />
            <Kpi
              label="Renewed"
              value={pct(members.renewed, members.lastYear)}
              detail={`${members.renewed} of last year's ${members.lastYear} members`}
            />
            <Kpi label="New members" value={members.newThisYear} detail="Not members last year" />
            <Kpi
              label="Not yet renewed"
              value={members.dueToRenew}
              detail={`They paid ${usd0.format(members.dueToRenewAmount)} in dues last year`}
            />
          </div>
          <p className="note">
            Dues so far: {usd0.format(members.duesThisYear)}, against {usd0.format(members.duesLastYearSamePeriod)} by
            this date last year. Names are in LGL, not here.
          </p>
        </>
      ) : null}

      {supporters ? (
        <>
          <h2 className="section-title">People giving</h2>
          <div className="kpis kpis-2">
            <Kpi label="Gave this year" value={supporters.thisYear} detail={`${signed(supporters.thisYear - supporters.lastYear)} on ${supporters.lastYear} last year`} />
            <Kpi label="Gave last year, not yet this year" value={supporters.gaveLastYearNotYetThisYear} detail="The people a year-end appeal is for" />
          </div>
          <p className="note">People and organisations with any cash gift; grant payments are left out.</p>
        </>
      ) : null}

      {monthly ? (
        <div className="charts">
          {members ? (
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
