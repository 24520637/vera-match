"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { AuthNavigation } from "../auth/auth-navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setExpanded(false), [pathname]);

  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          setExpanded(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="container site-header__inner">
        <Link
          className="wordmark"
          href="/"
          aria-label="VERA Match home"
          translate="no"
        >
          <span className="wordmark__symbol" aria-hidden="true">
            v
          </span>
          <span>
            VERA<span className="wordmark__suffix">Match</span>
          </span>
        </Link>
        <Button
          ref={toggleRef}
          variant="quiet"
          size="small"
          className="nav-toggle"
          aria-expanded={expanded}
          aria-controls="primary-navigation"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close menu" : "Menu"}
        </Button>
        <nav
          id="primary-navigation"
          aria-label="Main navigation"
          className={`site-nav ${expanded ? "site-nav--open" : ""}`}
        >
          <AuthNavigation onNavigate={() => setExpanded(false)} />
          <Link href="/#approach" onClick={() => setExpanded(false)}>
            Our approach
          </Link>
          <Link href="/#privacy" onClick={() => setExpanded(false)}>
            Your privacy
          </Link>
          <Link
            href="/design-system"
            aria-current={pathname === "/design-system" ? "page" : undefined}
            onClick={() => setExpanded(false)}
          >
            Design preview
          </Link>
        </nav>
      </div>
    </header>
  );
}
