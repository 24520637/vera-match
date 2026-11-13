import type { ReactNode } from "react";

// Structural foundation only. Session and role checks belong to auth integration.
export default function ProtectedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="container">{children}</div>
    </main>
  );
}
