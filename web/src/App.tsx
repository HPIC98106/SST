import { useCallback, useEffect, useRef, useState } from "react";
import { NotAuthorizedError, fetchCommunity, fetchFunds, fetchGrantDetails, fetchGrants, fetchOperations, fetchReconciliation } from "./api";
import { LOGO_URL, ORG_NAME } from "./brand";
import { formatRetrievedAt, usd } from "./format";
import { FundingBar } from "./FundingBar";
import { FundsSnapshotView } from "./FundsSnapshot";
import { GivingView } from "./Giving";
import { GrantDetailsView } from "./GrantDetails";
import { DataQualityPanel, GrantFunnelView } from "./GrantFunnel";
import { GrantsSplit, OPERATING_SECTION_ID, REBUILD_SECTION_ID } from "./GrantsSplit";
import { LglLink } from "./LglLink";
import { LifecycleView } from "./Lifecycle";
import { MembershipView } from "./Membership";
import { OperationsProblems, OperationsView } from "./Operations";
import { OverviewView, Reading, type Tab } from "./Overview";
import { PassphraseGate } from "./PassphraseGate";
import { PhaseReadinessView } from "./PhaseReadiness";
import { NoDuesMembers, ReconciliationTable, recordsChecked, recordsNeedingAttention } from "./Reconciliation";
import { YearSoFarView } from "./YearSoFar";
import type { CommunitySnapshot, FundsSnapshot, GrantDetailsSnapshot, GrantSnapshot, OperationsSnapshot, ReconciliationSnapshot } from "./types";

const STORAGE_KEY = "hpic-sst-passphrase";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "rebuild", label: "Rebuild" },
  { key: "operations", label: "Operations" },
  { key: "membership", label: "Membership" },
  { key: "giving", label: "Giving" },
  { key: "grants", label: "Grants" },
  { key: "reconciliation", label: "Reconciliation" },
];

/**
 * The tab lives in the URL hash so a reload, or a link sent to another board
 * member, opens the same view. The passphrase never goes in the URL.
 */
function tabFromHash(): Tab {
  const hash = window.location.hash.replace(/^#/, "").split("/")[0];
  // Its name until 2026-11-01, and links to it may still be around.
  if (hash === "housekeeping") return "reconciliation";
  return TABS.some((t) => t.key === hash) ? (hash as Tab) : "overview";
}

/**
 * Grants has three views, kept in the hash the same way: #grants, #grants/details
 * and #grants/how. The explainer lived on Reconciliation until 2026-11-02; it is
 * context for grants rather than something to act on.
 */
type GrantsView = "summary" | "details" | "how";

const GRANTS_VIEWS: { key: GrantsView; hash: string; label: string; hint: string }[] = [
  { key: "summary", hash: "#grants", label: "Summary", hint: "Rebuild and program operating, side by side" },
  { key: "details", hash: "#grants/details", label: "Grant details", hint: "A card for each award" },
  { key: "how", hash: "#grants/how", label: "How grants work", hint: "How a grant moves through LGL and QuickBooks" },
];

function grantsViewFromHash(): GrantsView {
  return GRANTS_VIEWS.find((v) => v.key !== "summary" && window.location.hash === v.hash)?.key ?? "summary";
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
  const [grantDetails, setGrantDetails] = useState<Panel<GrantDetailsSnapshot>>({ data: null });
  const [reconciliation, setReconciliation] = useState<Panel<ReconciliationSnapshot>>({ data: null });
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [grantsView, setGrantsView] = useState<GrantsView>(grantsViewFromHash);
  const [loading, setLoading] = useState(false);
  const [gateError, setGateError] = useState<string | undefined>();
  const latestLoad = useRef(0);

  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash());
      setGrantsView(grantsViewFromHash());
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

    // Reconciliation sets the two reads it follows side by side, so it waits for
    // them: asked at the same moment on a cold cache, it would read LGL a second time.
    const bothRead = Promise.all([settle(fetchOperations(secret), setOperations), settle(fetchCommunity(secret), setCommunity)]);
    await Promise.all([
      settle(fetchFunds(secret), setFunds),
      settle(fetchGrants(secret), setGrants),
      settle(fetchGrantDetails(secret), setGrantDetails),
      bothRead.then(() => settle(fetchReconciliation(secret), setReconciliation)),
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

  const grantNames = new Map((grantDetails.data?.grants ?? []).map((g) => [g.id, g.name]));
  const exceptions = grants.data?.exceptions ?? [];
  const blocking = recordsNeedingAttention(grants.data);
  const pending = {
    funds: isPending(funds),
    grants: isPending(grants),
    operations: isPending(operations),
    community: isPending(community),
    reconciliation: isPending(reconciliation),
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
                {t.key === "reconciliation" && blocking > 0 ? <span className="tab-count">{blocking}</span> : null}
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
            reconciliation={reconciliation.data}
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
              <Reading what="membership from LGL" slow />
            </section>
          ) : community.data ? (
            <MembershipView snapshot={community.data} />
          ) : (
            <PanelError title="Membership" detail={community.error} />
          )
        ) : tab === "giving" ? (
          pending.community ? (
            <section className="panel">
              <h1>Giving</h1>
              <Reading what="giving from LGL" slow />
            </section>
          ) : community.data ? (
            <GivingView snapshot={community.data} />
          ) : (
            <PanelError title="Giving" detail={community.error} />
          )
        ) : tab === "grants" ? (
          <div className="stack">
            <nav className="view-tabs" aria-label="Grants views">
              {GRANTS_VIEWS.map((view) => (
                <a
                  key={view.key}
                  className="view-tab"
                  href={view.hash}
                  aria-current={grantsView === view.key ? "page" : undefined}
                >
                  <span className="view-tab-label">{view.label}</span>
                  <span className="view-tab-hint">{view.hint}</span>
                </a>
              ))}
            </nav>
            {grantsView === "how" ? (
              <LifecycleView snapshot={grants.data} />
            ) : grantsView === "details" ? (
              isPending(grantDetails) ? (
                <PanelLoading />
              ) : grantDetails.data ? (
                <GrantDetailsView snapshot={grantDetails.data} />
              ) : (
                <PanelError title="Grant details" detail={grantDetails.error} />
              )
            ) : (
              <>
                {isPending(grantDetails) ? (
                  <section className="panel">
                    <h1>Grants: rebuild and program operating</h1>
                    <Reading what="grant awards from LGL" />
                  </section>
                ) : grantDetails.data ? (
                  <GrantsSplit snapshot={grantDetails.data} />
                ) : null}
                <div id={REBUILD_SECTION_ID}>
                  {pending.grants ? (
                    <PanelLoading />
                  ) : grants.data ? (
                    <GrantFunnelView snapshot={grants.data} showExceptions={false} names={grantNames} />
                  ) : (
                    <PanelError title="Rebuild grants" detail={grants.error} />
                  )}
                </div>
                <div id={OPERATING_SECTION_ID}>
                  {pending.community ? (
                    <section className="panel">
                      <h1>Program operating grants</h1>
                      <Reading what="operating grants from LGL" slow />
                    </section>
                  ) : (
                    <OperatingGrants community={community.data} names={grantNames} />
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="stack">
            <section className="panel">
              <h1>Reconciliation</h1>
              <p className="muted">Whether LGL and QuickBooks hold the same money, one kind at a time.</p>
              {pending.reconciliation ? (
                <Reading what="LGL against QuickBooks" />
              ) : (
                <ReconciliationTable snapshot={reconciliation.data} error={reconciliation.error} />
              )}
            </section>
            <section className="panel">
              <h1>Records to fix</h1>
              <p className="muted">
                Records that break a rule, and how the systems fit together. Fixing a record here fixes a number
                elsewhere on the dashboard.
              </p>
              {pending.grants ? (
                <Reading what="LGL's grant records" />
              ) : exceptions.length > 0 ? (
                <DataQualityPanel exceptions={exceptions} />
              ) : recordsChecked(grants.data) ? (
                <p className="banner banner-live">Every LGL grant record read passes every rule.</p>
              ) : (
                <p className="banner banner-error">LGL could not be read, so records could not be checked.</p>
              )}
              <p className="note">
                How a grant moves through LGL and QuickBooks, stage by stage, is on{" "}
                <a href="#grants/how">Grants → How grants work</a>.
              </p>
              <NoDuesMembers community={community.data} />
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
          </div>
        )}
      </main>

      <footer className="site-footer">
        <p>
          Read-only. Figures come from QuickBooks and Little Green Light; nothing here changes either. Dollars are
          rounded to the nearest dollar for display and totals use the exact amounts, so a column can differ from its
          total by a dollar. Questions or problems? <a href="mailto:finance@hpic1919.org">finance@hpic1919.org</a>
        </p>
      </footer>
    </div>
  );
}

/** Grant awards outside the rebuild, with what is still to arrive on each. */
function OperatingGrants({ community, names }: { community: CommunitySnapshot | null; names: Map<number, string> }) {
  if (community?.status !== "ok" || !community.operatingGrants) return null;
  const grants = community.operatingGrants;
  return (
    <section className="panel">
      <h1>Program operating grants</h1>
      <p className="muted">
        Awards outside the rebuild, for programs and operations, with what is still to come on each.{" "}
        <LglLink url={grants.awardedUrl}>{usd.format(grants.awarded)}</LglLink> awarded,{" "}
        <LglLink url={grants.receivedUrl}>{usd.format(grants.received)}</LglLink> received.{" "}
        <span className="tag tag-warn">Provisional</span>
      </p>
      {grants.awards.length === 0 ? (
        <p className="note">Nothing is still to come on any operating award.</p>
      ) : (
        <div className="table-scroll">
          <table className="breakdown">
            <thead>
              <tr>
                <th scope="col">Award</th>
                <th scope="col" className="num">Awarded</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Still to come</th>
              </tr>
            </thead>
            <tbody>
              {grants.awards.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <LglLink url={a.url}>{names.get(a.id) ?? `LGL gift ${a.id}`}</LglLink>
                    {a.date ? <span className="muted small"> · {a.date}</span> : null}
                  </th>
                  <td className="num">
                    <LglLink url={a.url}>{usd.format(a.amount)}</LglLink>
                  </td>
                  <td className="num">
                    <LglLink url={a.url}>{usd.format(a.received)}</LglLink>
                  </td>
                  <td className="num">
                    <LglLink url={a.url}>{usd.format(a.remaining)}</LglLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Computed from LGL payment records linked to each award; a payment not linked to its award makes "still to
        come" too high. Read from LGL {formatRetrievedAt(community.retrievedAt)}.
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
