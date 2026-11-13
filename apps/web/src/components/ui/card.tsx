import type { ComponentPropsWithRef } from "react";

/** Use for a contained task or specimen; prefer rows/sections for repeated information. */
export function Card({
  tone = "paper",
  className = "",
  ...props
}: ComponentPropsWithRef<"div"> & { tone?: "paper" | "sage" | "plum" }) {
  return <div {...props} className={`card card--${tone} ${className}`} />;
}
