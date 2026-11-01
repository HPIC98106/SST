import type { ReactNode } from "react";

/**
 * A figure that opens the records behind it in LGL, or just the figure when there
 * is no link. LGL asks for its own login, so names stay behind that login: this
 * page's one shared passphrase never reveals them.
 */
export function LglLink({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a className="lgl-link" href={url} target="_blank" rel="noreferrer" title="Open in LGL (needs an LGL login)">
      {children}
    </a>
  );
}

/** The same for QuickBooks: a figure that opens its register or report, behind QuickBooks' login. */
export function QboLink({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a className="lgl-link" href={url} target="_blank" rel="noreferrer" title="Open in QuickBooks (needs a QuickBooks login)">
      {children}
    </a>
  );
}
