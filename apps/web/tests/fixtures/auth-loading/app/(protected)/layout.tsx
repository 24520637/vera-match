import type { ReactNode } from "react";
import { AuthLoadingBoundary } from "../../../../../src/components/auth/auth-loading-boundary";
/** Pure C010 presentation fixture; actual server session checks run in the real-auth suite. */
export default function PresentationFixture({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main id="main-content">
      <AuthLoadingBoundary>{children}</AuthLoadingBoundary>
    </main>
  );
}
