import { useCallback, useEffect, useRef, useState } from "react";
import { NotAuthorizedError, fetchCommunity, fetchFunds, fetchGrants, fetchOperations } from "./api";
import { LOGO_URL, ORG_NAME } from "./brand";
import { formatRetrievedAt, usd0 } from "./format";
import { FundingBar } from "./FundingBar";
import { FundsSnapshotView } from "./FundsSnapshot";
import { DataQualityPanel, GrantFunnelView } from "./GrantFunnel";
import { LifecycleView } from "./Lifecycle";
import { MembershipView } from "./Membership";
import { OperationsProblems, OperationsView } from "./Operations";
import { OverviewView, Reading, type Tab } from "./Overview";
import { PassphraseGate } from "./PassphraseGate";
import { PhaseReadinessView } from "./PhaseReadiness";
import { YearSoFarView } from "./YearSoFar";
import type { CommunitySnapshot, FundsSnapshot, GrantSnapshot, OperationsSnapshot } from "./types";

const STORAGE_KEY = "hpic-sst-passphrase";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "rebuild", label: "Rebuild" },
  { key: "operations", label: "Operations" },
  { key: "membership", label: "Membership" },
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

/**
 * No answer yet. Different from a failure: while a read is under way a figure
 * says it is being read, never that it could not be.
 */
function isPending(panel: Panel<unknown>): boolean {
  return panel.data === null && panel.error === undefined;
}

export function App() {
  const [passphrase, setPassphrase] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));
  const [funds, setFunds] = useState<Panel<FundsSnapshot>>({ data: null });
  const [grants, setGrants] = useState<Panel<GrantSnapshot>>({ data: null });
  const [operations, setOperations] = useState<Panel<OperationsSnapshot>>({ data: null });
  const [community, setCommunity] = useState<Panel<CommunitySnapshot>>({ data: null });
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [loading, setLoading] = useState(false);
  const [gateError, setGateError] = useState<string | undefined>();
  const latestLoad = useRef(0);

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
    const thisLoad = ++latestLoad.current;
    setLoading(true);

    // Each panel lands as soon as its own read does. Membership can take half
    // a minute when it is not cached, and cash must not wait for it.
    const settle = async <T,>(read: Promise<T>, show: (panel: Panel<T>) => void) => {
      try {
        const data = await read;
        if (thisLoad === latestLoad.current) show({ data });
      } catch (reason) {
        if (thisLoad !== latestLoad.current) return;
        // A wrong passphrase is a page-level problem: every request carries
        // the same secret, so the rest of this load is abandoned with it.
        if (reason instanceof NotAuthorizedError) {
          latestLoad.current += 1;
          sessionStorage.removeItem(STORAGE_KEY);
          setPassphrase(null);
          setGateError(reason.message);
          setLoading(false);
          return;
        }
        show({ data: null, error: reason instanceof Error ? reason.message : String(reason) });
      }
    };

    await Promise.all([
      settle(fetchFunds(secret), setFunds),
      settle(fetchGrants(secret), setGrants),
      settle(fetchOperations(secret), setOperations),
      settle(fetchCommunity(secret), setCommunity),
    ]);
    if (thisLoad === latestLoad.current) setLoading(false);
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
  const pending = {
    funds: isPending(funds),
    grants: isPending(grants),
    operations: isPending(operations),
    community: isPending(community),
  };

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
        {tab === "overview" ? (
          <OverviewView
            funds={funds.data}
            grants={grants.data}
            operations={operations.data}
            community={community.data}
            pending={pending}
            open={open}
          />
        ) : tab === "rebuild" ? (
          <div className="stack">
            {pending.funds || pending.grants ? (
              <PanelLoading />
            ) : (
              <>
                <section className="card card-pad">
                  <div className="card-head">
                    <h2>How far {grants.data?.phaseTarget.name ?? "the next phase"} is funded</h2>
                  </div>
                  <FundingBar funds={funds.data} grants={grants.data} />
                </section>
                <PhaseReadinessView funds={funds.data} grants={grants.data} />
              </>
            )}
            {pending.funds ? null : funds.data ? (
              <FundsSnapshotView snapshot={funds.data} />
            ) : (
              <PanelError title="Cash by account" detail={funds.error} />
            )}
          </div>
        ) : tab === "operations" ? (
          pending.operations || pending.funds ? (
            <PanelLoading />
          ) : operations.data ? (
            <div className="stack">
              <YearSoFarView operations={operations.data} funds={funds.data} />
              <OperationsView snapshot={operations.data} />
            </div>
          ) : (
            <PanelError title="Income and spending" detail={operations.error} />
          )
        ) : tab === "membership" ? (
          pending.community ? (
            <section className="panel">
              <h1>Membership</h1>
              <Reading what="membership and giving from LGL" slow />
            </section>
          ) : community.data ? (
            <MembershipView snapshot={community.data} />
          ) : (
            <PanelError title="Membership" detail={community.error} />
          )
        ) : tab === "grants" ? (
          <div className="stack">
            {pending.grants ? (
              <PanelLoading />
            ) : grants.data ? (
              <GrantFunnelView snapshot={grants.data} showExceptions={false} />
            ) : (
              <PanelError title="Grant funnel" detail={grants.error} />
            )}
            {pending.community ? (
              <section className="panel">
                <h1>Operating grants</h1>
                <Reading what="operating grants from LGL" slow />
              </section>
            ) : (
              <OperatingGrants community={community.data} />
            )}
          </div>
        ) : (
          <div className="stack">
            <section className="panel">
              <h1>Housekeeping</h1>
              <p className="muted">
                Records that break a rule, and how the systems fit together. Fixing a record here fixes a number
                elsewhere on the dashboard.
              </p>
              {pending.grants ? (
                <Reading what="LGL's grant records" />
              ) : grants.data ? (
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
  if (community?.status !== "ok" || !community.operatingGrants) return null;
  const grants = community.operatingGrants;
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
        arrive" too high. Read from LGL {formatRetrievedAt(community.retrievedAt)}.
      </p>
    </section>
  );
}

/** Holds a panel's place while its read is under way. */
function PanelLoading() {
  return <div className="skeleton skeleton-card" aria-busy="true" aria-label="Loading" />;
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
