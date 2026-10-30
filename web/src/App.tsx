import { useCallback, useEffect, useState } from "react";
import { NotAuthorizedError, fetchFunds, fetchGrants, fetchOperations } from "./api";
import { FundsSnapshotView } from "./FundsSnapshot";
import { PhaseReadinessView } from "./PhaseReadiness";
import { GrantFunnelView } from "./GrantFunnel";
import { LifecycleView } from "./Lifecycle";
import { OperationsView } from "./Operations";
import { PassphraseGate } from "./PassphraseGate";
import { YearSoFarView } from "./YearSoFar";
import type { FundsSnapshot, GrantSnapshot, OperationsSnapshot } from "./types";

type View = "overview" | "operations" | "lifecycle";

const STORAGE_KEY = "hpic-sst-passphrase";

/**
 * One panel's data. Kept per-panel rather than as a single page-level state so
 * that a failing source degrades to an inline message on its own panel, and
 * the other panel still renders — QuickBooks being down should not hide the
 * grant funnel.
 */
interface Panel<T> {
  data: T | null;
  error?: string;
}

export function App() {
  const [passphrase, setPassphrase] = useState<string | null>(() =>
    sessionStorage.getItem(STORAGE_KEY),
  );
  const [funds, setFunds] = useState<Panel<FundsSnapshot>>({ data: null });
  const [grants, setGrants] = useState<Panel<GrantSnapshot>>({ data: null });
  const [operations, setOperations] = useState<Panel<OperationsSnapshot>>({ data: null });
  // Which view is showing. Deliberately local state rather than a router: a
  // few views do not justify a routing dependency, and the passphrase lives in
  // memory, so a URL that could be opened directly would not work anyway.
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [gateError, setGateError] = useState<string | undefined>();

  const load = useCallback(async (secret: string) => {
    setLoading(true);

    // A wrong passphrase is a page-level problem, not a panel-level one: every
    // request carries the same secret, so all will have failed the same way.
    const forgetPassphrase = (message: string) => {
      sessionStorage.removeItem(STORAGE_KEY);
      setPassphrase(null);
      setGateError(message);
    };

    const [fundsResult, grantsResult, operationsResult] = await Promise.allSettled([
      fetchFunds(secret),
      fetchGrants(secret),
      fetchOperations(secret),
    ]);

    const unauthorized = [fundsResult, grantsResult, operationsResult].find(
      (result) => result.status === "rejected" && result.reason instanceof NotAuthorizedError,
    );
    if (unauthorized && unauthorized.status === "rejected") {
      forgetPassphrase((unauthorized.reason as Error).message);
      setLoading(false);
      return;
    }

    setFunds(toPanel(fundsResult));
    setGrants(toPanel(grantsResult));
    setOperations(toPanel(operationsResult));
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

  if (!loaded) {
    return (
      <main className="dashboard">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header>
        <h1 className="page-title">Highland Park Improvement Club</h1>
        <p className="muted">Board financial snapshot</p>
        <nav className="views">
          <button
            type="button"
            className={view === "overview" ? "view-tab is-active" : "view-tab"}
            onClick={() => setView("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={view === "operations" ? "view-tab is-active" : "view-tab"}
            onClick={() => setView("operations")}
          >
            Operations
          </button>
          {/*
            The lifecycle sits beside the numbers rather than in a document,
            because a figure without its position in the process is not
            actionable — and a process description kept elsewhere drifts from
            the code silently.
          */}
          <button
            type="button"
            className={view === "lifecycle" ? "view-tab is-active" : "view-tab"}
            onClick={() => setView("lifecycle")}
          >
            Where the numbers come from
          </button>
        </nav>
      </header>

      {view === "lifecycle" ? (
        <LifecycleView snapshot={grants.data} />
      ) : view === "operations" ? (
        operations.data ? (
          <OperationsView snapshot={operations.data} />
        ) : (
          <PanelError title="Income and spending" detail={operations.error} />
        )
      ) : (
        <>
          {/* Money available now leads: it is the first thing the board asks. */}
          {funds.data ? (
            <FundsSnapshotView snapshot={funds.data} />
          ) : (
            <PanelError title="Cash on hand" detail={funds.error} />
          )}

          <YearSoFarView
            operations={operations.data}
            funds={funds.data}
            error={operations.error}
            onOpen={() => {
              setView("operations");
              window.scrollTo(0, 0);
            }}
          />

          <PhaseReadinessView funds={funds.data} grants={grants.data} />

          {grants.data ? (
            <GrantFunnelView snapshot={grants.data} />
          ) : (
            <PanelError title="Grant funnel" detail={grants.error} />
          )}
        </>
      )}

      <footer>
        <button type="button" className="link" onClick={() => void load(passphrase)}>
          Reload
        </button>
        {loading ? <span className="muted"> Reloading…</span> : null}
        <p className="muted">
          Questions or problems? Contact{" "}
          <a href="mailto:finance@hpic1919.org">finance@hpic1919.org</a>.
        </p>
      </footer>
    </main>
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
      <p className="banner banner-error">
        This panel could not be loaded.{detail ? ` ${detail}` : ""}
      </p>
    </section>
  );
}
