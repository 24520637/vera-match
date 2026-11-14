import type { ReactNode, CSSProperties } from "react";
import "../../../../src/app/globals.css";
export const metadata = {
  title: "Authentication loading presentation fixture",
};
/** Isolated C010 presentation tests must not mount the product's session owner. */
export default function FixtureRoot({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={
          {
            "--font-body": "Arial",
            "--font-editorial": "Georgia",
          } as CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
