import Link from "next/link";
import type { ComponentProps, ComponentPropsWithRef } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Appearance = {
  variant?: Variant;
  size?: "regular" | "small";
  className?: string;
};

function buttonClass({
  variant = "primary",
  size = "regular",
  className = "",
}: Appearance) {
  return `button button--${variant} button--${size} ${className}`.trim();
}

export type ButtonProps = ComponentPropsWithRef<"button"> &
  Appearance & {
    loading?: boolean;
    loadingLabel?: string;
  };

export function Button({
  variant,
  size,
  className,
  loading = false,
  loadingLabel = "Saving…",
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {loading ? loadingLabel : children}
    </button>
  );
}

/** Navigation remains a link, with modifier-click and open-in-new-tab support. */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & Appearance) {
  return (
    <Link {...props} className={buttonClass({ variant, size, className })} />
  );
}
