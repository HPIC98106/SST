import { formatRetrievedAt, usd } from "./format";
import { QboLink } from "./LglLink";
import type { AccountSnapshot, FundsSnapshot, PurposeSubtotal } from "./types";

function SubtotalCard({ subtotal }: { subtotal: PurposeSubtotal }) {
  return (
    <section className="card card-subtotal">
      <h2>{subtotal.label} total</h2>
      {subtotal.total === null ? (
        <p className="amount unavailable">Not shown</p>
      ) : (
        <p className="amount">{usd.format(subtotal.total)}</p>
      )}
      {subtotal.note ? <p className="note">{subtotal.note}</p> : null}
    </section>
  );
}

function AccountCard({ account }: { account: AccountSnapshot }) {
  return (
    <section className={`card status-${account.status}`}>
      <h2>
        <QboLink url={account.url}>{account.label}</QboLink>
      </h2>
      {account.status === "ok" ? (
        <p className="amount">
          <QboLink url={account.url}>{usd.format(account.balance ?? 0)}</QboLink>
        </p>
      ) : (
        <p className="amount unavailable">
          {account.status === "not_configured" ? "Not configured" : "Unavailable"}
        </p>
      )}
      {account.note ? <p className="note">{account.note}</p> : null}
    </section>
  );
}

/**
 * The rebuild accounts, for the Rebuild tab. Programming balances and total cash
 * are on the Overview (decided 2026-10-31): this tab is about the rebuild, and
 * programming cash is deliberately not part of what it can afford.
 */
export function FundsSnapshotView({ snapshot }: { snapshot: FundsSnapshot }) {
  const rebuild = snapshot.subtotals?.find((s) => s.purpose === "rebuild");
  // With no purposes configured there is no rebuild group to show, so every
  // account is listed rather than the panel coming up empty.
  const accounts = snapshot.subtotals ? snapshot.accounts.filter((a) => a.purpose === "rebuild") : snapshot.accounts;

  return (
    <section className="panel">
      <h1>Rebuild cash by account</h1>

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

      {/*
        Every account on its own card. The point is that an imbalance between
        accounts is visible on the page rather than averaged into a single figure.
      */}
      <div className="cards">
        {accounts.map((account) => (
          <AccountCard key={account.key} account={account} />
        ))}
        {rebuild ? <SubtotalCard subtotal={rebuild} /> : null}
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
