import { useCallback, useEffect, useRef, useState } from "react";
import { NotAuthorizedError, fetchCommunity, fetchFunds, fetchGrantDetails, fetchGrants, fetchOperations, fetchReconciliation } from "./api";
import { LOGO_URL, ORG_NAME } from "./brand";
import { How, SourceLine } from "./Disclosure";
import { FundingHeadline } from "./FundingBar";
import { FundsSnapshotView } from "./FundsSnapshot";
import { GivingView } from "./Giving";
import { ProgramGrantsView, RebuildGrants } from "./Grants";
import { LifecycleView } from "./Lifecycle";
import { MembershipView } from "./Membership";
import { OperationsView } from "./Operations";
import { OverviewView, Reading, type Tab } from "./Overview";
import { PassphraseGate } from "./PassphraseGate";
import { ReconciliationView, recordsNeedingAttention } from "./Reconciliation";
import { YearSoFarView } from "./YearSoFar";
import type { CommunitySnapshot, FundsSnapshot, GrantDetailsSnapshot, GrantSnapshot, OperationsSnapshot, ReconciliationSnapshot } from "./types";

const STORAGE_KEY = "hpic-sst-passphrase";

/**
 * "Program grants" since 2026-11-10: the tab holds program and operating grants
 * only, and rebuild grants moved to the Rebuild tab. Its key and hash stay
 * `grants`, so links sent before the rename still open it.
 */
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "rebuild", label: "Rebuild" },
  { key: "operations", label: "Operations" },
  { key: "membership", label: "Membership" },
  { key: "giving", label: "Giving" },
  { key: "grants", label: "Program grants" },
  { key: "reconciliation", label: "Reconciliation" },
];

/**
 * The tab lives in the URL hash so a reload, or a link sent to another board
 * member, opens the same view. The passphrase never goes in the URL. A second
 * part after a slash names a section: `#reconciliation/no-dues`. The old Grants
 * sub-views (`#grants/details`, `#grants/how`) open the one Grants page.
 */
function tabFromHash(): Tab {
  const hash = window.location.hash.replace(/^#/, "").split("/")[0];
  // Its name until 2026-11-01, and links to it may still be around.
  if (hash === "housekeeping") return "reconciliation";
  return TABS.some((t) => t.key === hash) ? (hash as Tab) : "overview";
}

/** Whether the hash names a section within its tab, which then does its own scrolling. */
const hashHasSection = () => window.location.hash.includes("/");

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
  const [loading, setLoading] = useState(false);
  const [gateError, setGateError] = useState<string | undefined>();
  const latestLoad = useRef(0);

  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash());
      if (!hashHasSection()) window.scrollTo(0, 0);
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

  const blocking = recordsNeedingAttention(grants.data);
  const pending = {
    funds: isPending(funds),
    grants: isPending(grants),
    operations: isPending(operations),
    community: isPending(community),
    reconciliation: isPending(reconciliation),
    grantDetails: isPending(grantDetails),
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
            grantDetails={grantDetails.data}
            pending={pending}
            open={open}
          />
        ) : tab === "rebuild" ? (
          <div className="stack">
            {pending.funds || pending.grants ? <PanelLoading /> : <FundingHeadline funds={funds.data} grants={grants.data} />}
            {pending.grantDetails ? (
              <PanelLoading />
            ) : grantDetails.data ? (
              <RebuildGrants snapshot={grantDetails.data} />
            ) : (
              <PanelError title="Rebuild grants" detail={grantDetails.error} />
            )}
            {pending.funds ? null : funds.data ? (
              <FundsSnapshotView snapshot={funds.data} />
            ) : (
              <PanelError title="Rebuild cash by account" detail={funds.error} />
            )}
            <SourceLine qbo={funds.data?.retrievedAt ?? null} lgl={grants.data?.retrievedAt ?? grantDetails.data?.retrievedAt ?? null} />
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
            <MembershipView snapshot={community.data} reconciliation={reconciliation.data} checking={pending.reconciliation} />
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
            {pending.grantDetails ? (
              <section className="panel">
                <h1>Program grants</h1>
                <Reading what="grant awards from LGL" />
              </section>
            ) : grantDetails.data ? (
              <ProgramGrantsView snapshot={grantDetails.data} />
            ) : (
              <PanelError title="Program grants" detail={grantDetails.error} />
            )}
            <section className="panel panel-quiet">
              <How label="How grants work">
                <LifecycleView snapshot={grants.data} />
              </How>
            </section>
            <SourceLine lgl={grantDetails.data?.retrievedAt ?? null} />
          </div>
        ) : (
          <ReconciliationView
            reconciliation={reconciliation.data}
            reconciliationError={reconciliation.error}
            grants={grants.data}
            grantDetails={grantDetails.data}
            community={community.data}
            operations={operations.data}
            pending={pending}
          />
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
