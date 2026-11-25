import type { ReactNode } from "react";
import { Card } from "../ui/card";
export function AuthScaffold({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="container auth-shell">
      <div className="auth-context">
        <h1>{title}</h1>
        <p className="lede">{description}</p>
        <p className="small muted">
          Your choices matter. Discover introductions and share only what feels right for you.
        </p>
      </div>
      <Card className="auth-panel">{children}</Card>
    </div>
  );
}
