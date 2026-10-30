import { useCallback, useEffect, useState } from "react";
import { NotAuthorizedError, fetchCommunity, fetchFunds, fetchGrants, fetchOperations } from "./api";
import { LOGO_URL, ORG_NAME } from "./brand";
import { CommunityView } from "./Community";
import { formatRetrievedAt, usd0 } from "./format";
import { FundingBar } from "./FundingBar";
import { FundsSnapshotView } from "./FundsSnapshot";
import { DataQualityPanel, GrantFunnelView } from "./GrantFunnel";
import { LifecycleView } from "./Lifecycle";
import { OperationsProblems, OperationsView } from "./Operations";
import { OverviewView, type Tab } from "./Overview";
import { PassphraseGate } from "./PassphraseGate";
import { PhaseReadinessView } from "./PhaseReadiness";
import { YearSoFarView } from "./YearSoFar";
import type { CommunitySnapshot, FundsSnapshot, GrantSnapshot, OperationsSnapshot } from "./types";

const STORAGE_KEY = "hpic-sst-passphrase";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "rebuild", label: "Rebuild" },
  { key: "operations", label: "Operations" },
  { key: "community", label: "Community" },
  { key: "grants", label: "Grants" },
  { key: "housekeeping", label: "Housekeeping" },
];

/**
 * The tab lives in the URL hash so a reload, or a link sent to another board
 * member, opens the same view. The passphrase never goes in the URL.
 */
function tabFromHash(): Tab {
  const hash = window.location.hash.replace(/^#/, "");
  return TABS.some((t) => t.key === hash) ? (hash as Tab) : "overview";
}

/**
 * One panel's data. Kept per source rather than page-wide so that a failing
 * source degrades in place: QuickBooks being down must not hide LGL figures.
 */
interface Panel<T> {
  data: T | null;
  error?: string;
}

export function App() {
  const [passphrase, setPassphrase] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));
  const [funds, setFunds] = useState<Panel<FundsSnapshot>>({ data: null });
  const [grants, setGrants] = useState<Panel<GrantSnapshot>>({ data: null });
  const [operations, setOperations] = useState<Panel<OperationsSnapshot>>({ data: null });
  const [community, setCommunity] = useState<Panel<CommunitySnapshot>>({ data: null });
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [gateError, setGateError] = useState<string | undefined>();

  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = useCallback((next: Tab) => {
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setTab(next);
    window.scrollTo(0, 0);
  }, []);

  const load = useCallback(async (secret: string) => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetchFunds(secret),
      fetchGrants(secret),
      fetchOperations(secret),
      fetchCommunity(secret),
    ]);

    // A wrong passphrase is a page-level problem: every request carries the
    // same secret, so all of them will have failed the same way.
    const unauthorized = results.find((r) => r.status === "rejected" && r.reason instanceof NotAuthorizedError);
    if (unauthorized && unauthorized.status === "rejected") {
      sessionStorage.removeItem(STORAGE_KEY);
      setPassphrase(null);
      setGateError((unauthorized.reason as Error).message);
      setLoading(false);
      return;
    }

    const [f, g, o, c] = results;
    setFunds(toPanel(f as PromiseSettledResult<FundsSnapshot>));
    setGrants(toPanel(g as PromiseSettledResult<GrantSnapshot>));
    setOperations(toPanel(o as PromiseSettledResult<OperationsSnapshot>));
    setCommunity(toPanel(c as PromiseSettledResult<CommunitySnapshot>));
    setLoading(false);
    setLoaded(true);
  }, []);

  // Data loads on page load. Nobody runs a script or exports a file.
  useEffect(() => {
    if (passphrase) void load(passphrase);
  }, [passphrase, load]);

  if (!passphrase) {
    return (
      <PassphraseGate
        error={gateError}
        onSubmit={(value) => {
          sessionStorage.setItem(STORAGE_KEY, value);
          setGateError(undefined);
          setPassphrase(value);
        }}
      />
    );
  }

  const exceptions = grants.data?.exceptions ?? [];
  const blocking = exceptions.filter((e) => e.severity === "blocking").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img className="brand-logo" src={LOGO_URL} alt="" width={40} height={48} />
            <div>
              <p className="org">{ORG_NAME}</p>
              <p className="org-sub">Board dashboard</p>
            </div>
          </div>
          <div className="topbar-meta">
            {funds.data?.retrievedAt ? <span>Balances as of {formatRetrievedAt(funds.data.retrievedAt)}</span> : null}
            <button type="button" className="link-button" onClick={() => void load(passphrase)} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Dashboard sections">
          <div className="tabs-inner">
            {TABS.map((t) => (
              <a
                key={t.key}
                href={`#${t.key}`}
                className={tab === t.key ? "tab is-active" : "tab"}
                aria-current={tab === t.key ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  open(t.key);
                }}
              >
                {t.label}
                {t.key === "housekeeping" && blocking > 0 ? <span className="tab-count">{blocking}</span> : null}
              </a>
            ))}
          </div>
        </nav>
      </header>

      <main className="content">
        {!loaded ? (
          <Skeleton />
        ) : tab === "overview" ? (
          <OverviewView
            funds={funds.data}
            grants={grants.data}
            operations={operations.data}
            community={community.data}
            open={open}
          />
        ) : tab === "rebuild" ? (
          <div className="stack">
            <section className="card card-pad">
              <div className="card-head">
                <h2>How far {grants.data?.phaseTarget.name ?? "the next phase"} is funded</h2>
              </div>
              <FundingBar funds={funds.data} grants={grants.data} />
            </section>
            <PhaseReadinessView funds={funds.data} grants={grants.data} />
            {funds.data ? <FundsSnapshotView snapshot={funds.data} /> : <PanelError title="Cash on hand" detail={funds.error} />}
          </div>
        ) : tab === "operations" ? (
          operations.data ? (
            <div className="stack">
              <YearSoFarView operations={operations.data} funds={funds.data} />
              <OperationsView snapshot={operations.data} />
            </div>
          ) : (
            <PanelError title="Income and spending" detail={operations.error} />
          )
        ) : tab === "community" ? (
          community.data ? (
            <CommunityView snapshot={community.data} />
          ) : (
            <PanelError title="Community" detail={community.error} />
          )
        ) : tab === "grants" ? (
          <div className="stack">
            {grants.data ? (
              <GrantFunnelView snapshot={grants.data} showExceptions={false} />
            ) : (
              <PanelError title="Grant funnel" detail={grants.error} />
            )}
            <OperatingGrants community={community.data} />
          </div>
        ) : (
          <div className="stack">
            <section className="panel">
              <h1>Housekeeping</h1>
              <p className="muted">
                Records that break a rule, and how the systems fit together. Fixing a record here fixes a number
                elsewhere on the dashboard.
              </p>
              {grants.data ? (
                exceptions.length > 0 ? (
                  <DataQualityPanel exceptions={exceptions} />
                ) : (
                  <p className="banner banner-live">Every LGL grant record read passes every rule.</p>
                )
              ) : (
                <p className="banner banner-error">LGL could not be read, so records could not be checked.</p>
              )}
              {operations.data && (operations.data.ungrouped.length > 0 || operations.data.invalidConfig.length > 0) ? (
                <div className="subpanel">
                  <h2>QuickBooks accounts not yet grouped</h2>
                  <OperationsProblems snapshot={operations.data} />
                  <ul className="ops-list">
                    {operations.data.ungrouped.map((u) => (
                      <li key={`${u.id}:${u.name}`}>
                        {u.name} {u.id ? <code>{u.id}</code> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
            <LifecycleView snapshot={grants.data} />
          </div>
        )}
      </main>

      <footer className="site-footer">
        <p>
          Read-only. Figures come from QuickBooks and Little Green Light; nothing here changes either. Questions or
          problems? <a href="mailto:finance@hpic1919.org">finance@hpic1919.org</a>
        </p>
      </footer>
    </div>
  );
}

/** Grant awards outside the rebuild, with what is still to arrive on each. */
function OperatingGrants({ community }: { community: CommunitySnapshot | null }) {
  const grants = community?.status === "ok" ? community.operatingGrants : null;
  if (!grants) return null;
  return (
    <section className="panel">
      <h1>Operating grants</h1>
      <p className="muted">
        Awards outside the rebuild, for programs and operations. {usd0.format(grants.awarded)} awarded,{" "}
        {usd0.format(grants.received)} received. <span className="tag tag-warn">Provisional</span>
      </p>
      {grants.awards.length === 0 ? (
        <p className="note">Nothing is still to arrive on any operating award.</p>
      ) : (
        <div className="table-scroll">
          <table className="breakdown">
            <thead>
              <tr>
                <th scope="col">Award</th>
                <th scope="col" className="num">Awarded</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Still to arrive</th>
              </tr>
            </thead>
            <tbody>
              {grants.awards.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer">LGL gift {a.id}</a> : `LGL gift ${a.id}`}
                    {a.date ? <span className="muted small"> · {a.date}</span> : null}
                  </th>
                  <td className="num">{usd0.format(a.amount)}</td>
                  <td className="num">{usd0.format(a.received)}</td>
                  <td className="num">{usd0.format(a.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Computed from LGL payment records linked to each award; a payment not linked to its award makes "still to
        arrive" too high.
      </p>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-hero" />
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton-kpi" />
        ))}
      </div>
      <div className="grid-2">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    </div>
  );
}

function toPanel<T>(result: PromiseSettledResult<T>): Panel<T> {
  if (result.status === "fulfilled") return { data: result.value };
  const reason = result.reason;
  return { data: null, error: reason instanceof Error ? reason.message : String(reason) };
}

/** Inline unavailable state for a panel whose request never returned. */
function PanelError({ title, detail }: { title: string; detail?: string }) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <p className="banner banner-error">This panel could not be loaded.{detail ? ` ${detail}` : ""}</p>
    </section>
  );
}
