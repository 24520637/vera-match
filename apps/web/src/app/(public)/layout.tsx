import type { ReactNode } from "react";
/** Global chrome and the single main landmark are owned by RootLayout for every route group. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
