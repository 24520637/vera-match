import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/site-header";

export default function PublicLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="container site-footer__inner">
          <p>
            <span translate="no">VERA Match</span>
            <br />
            Thoughtful introductions. Your choices, respected.
          </p>
          <p>
            In development. Accounts, video reviews and matching are not
            available yet.
            <br />
            <Link href="/design-system">Explore the design preview</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
