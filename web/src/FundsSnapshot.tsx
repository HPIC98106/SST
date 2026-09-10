import { formatRetrievedAt, usd } from "./format";
import type { AccountSnapshot, FundsSnapshot } from "./types";

function AccountCard({ account }: { account: AccountSnapshot }) {
  return (
    <section className={`card status-${account.status}`}>
      <h2>{account.label}</h2>
      {account.status === "ok" ? (
        <p className="amount">{usd.format(account.balance ?? 0)}</p>
      ) : (
        <p className="amount unavailable">
          {account.status === "not_configured" ? "Not configured" : "Unavailable"}
        </p>
      )}
      {account.note ? <p className="note">{account.note}</p> : null}
    </section>
  );
}

export function FundsSnapshotView({ snapshot }: { snapshot: FundsSnapshot }) {
  return (
    <section className="panel">
      <h1>Cash on hand</h1>

      {/*
        A sandbox company returns real balances for a business that does not
        exist. Without this the figures render exactly like production ones —
        every other caveat on this dashboard is visible on the page, and this
        was the only one that was not.
      */}
      {snapshot.environment === "sandbox" && snapshot.connection !== "fixture" ? (
        <p className="banner banner-error">
          <strong>Test company, not HPIC's books.</strong> These are real balances read
          live from QuickBooks, but from Intuit's <strong>sandbox</strong> company, so
          every figure below is invented. Switching to HPIC's real accounts needs
          QuickBooks production keys, which need Intuit's approval.
        </p>
      ) : null}

      {snapshot.connection === "fixture" ? (
        <p className="banner banner-warn">
          Showing <strong>fixture data</strong>, not real QuickBooks figures. Set{" "}
          <code>QBO_MODE=live</code> on the Worker to connect.
        </p>
      ) : null}

      {snapshot.connection === "not_connected" ? (
        <p className="banner banner-error">
          QuickBooks has never been connected to this dashboard, so there are no figures
          to show. Open <code>/oauth/start</code> on the Worker with the passphrase to
          authorize it.
        </p>
      ) : null}

      {snapshot.connection === "needs_reauth" ? (
        <p className="banner banner-error">
          QuickBooks needs to be reconnected. Open <code>/oauth/start</code> on the Worker
          with the passphrase to re-authorize. No figures below are current until that is
          done.
        </p>
      ) : null}

      <div className="cards">
        {snapshot.accounts.map((account) => (
          <AccountCard key={account.key} account={account} />
        ))}

        <section className="card card-total">
          <h2>Total cash on hand</h2>
          {snapshot.totalCash === null ? (
            <p className="amount unavailable">Not shown</p>
          ) : (
            <p className="amount">{usd.format(snapshot.totalCash)}</p>
          )}
          {snapshot.totalCashNote ? <p className="note">{snapshot.totalCashNote}</p> : null}
        </section>
      </div>

      <div className="panel-footer">
        <p>
          <strong>Source:</strong> {snapshot.source}.{" "}
          {snapshot.environment === "sandbox"
            ? "These are test figures. Reading HPIC's real accounts needs QuickBooks production keys, which require Intuit's approval. Nothing else has to change when they are issued."
            : "Book balance reflects transactions entered in QuickBooks, not the live bank-feed balance, which the QuickBooks API does not expose."}
        </p>
        <p>
          <strong>Data retrieved from QuickBooks:</strong> {formatRetrievedAt(snapshot.retrievedAt)}
          {snapshot.cached ? " (served from a cached read, refreshed at least every 15 minutes)" : ""}
        </p>
      </div>
    </section>
  );
}
