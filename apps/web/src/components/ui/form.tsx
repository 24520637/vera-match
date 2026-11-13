"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
  error?: string;
};

function useField(
  id: string | undefined,
  hint?: string,
  error?: string,
  describedBy?: string,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return {
    id: fieldId,
    "aria-describedby":
      [describedBy, hint && `${fieldId}-hint`, error && `${fieldId}-error`]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: Omit<FieldProps, "name"> & {
  id: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="field__required"> (required)</span>}
      </label>
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field__error" id={`${id}-error`} aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  id,
  className = "",
  required,
  "aria-describedby": describedBy,
  ...props
}: ComponentPropsWithRef<"input"> & FieldProps) {
  const field = useField(id, hint, error, describedBy);
  return (
    <Field
      {...field}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <input
        {...props}
        {...field}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={`control ${className}`}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  className = "",
  required,
  children,
  "aria-describedby": describedBy,
  ...props
}: ComponentPropsWithRef<"select"> & FieldProps) {
  const field = useField(id, hint, error, describedBy);
  return (
    <Field
      {...field}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <select
        {...props}
        {...field}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={`control ${className}`}
      >
        {children}
      </select>
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  id,
  className = "",
  required,
  "aria-describedby": describedBy,
  ...props
}: ComponentPropsWithRef<"textarea"> & FieldProps) {
  const field = useField(id, hint, error, describedBy);
  return (
    <Field
      {...field}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <textarea
        rows={4}
        {...props}
        {...field}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={`control ${className}`}
      />
    </Field>
  );
}

export function Checkbox({
  label,
  hint,
  error,
  id,
  className = "",
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type"> & FieldProps) {
  const field = useField(id, hint, error, describedBy);
  return (
    <div className={`choice ${className}`}>
      <label htmlFor={field.id}>
        <input
          {...props}
          {...field}
          type="checkbox"
          aria-invalid={error ? true : props["aria-invalid"]}
        />
        <span>
          {label}
          {props.required && " (required)"}
        </span>
      </label>
      {hint && (
        <p id={`${field.id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${field.id}-error`} className="field__error" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export function Form({
  className = "",
  ...props
}: ComponentPropsWithRef<"form">) {
  return <form {...props} className={`form ${className}`} />;
}

export function Fieldset({
  legend,
  children,
  ...props
}: ComponentPropsWithRef<"fieldset"> & { legend: string }) {
  return (
    <fieldset {...props} className={`fieldset ${props.className ?? ""}`}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions">{children}</div>;
}

export function ErrorSummary({
  errors,
}: {
  errors: { id: string; message: string }[];
}) {
  if (!errors.length) return null;
  return (
    <div className="form-errors" aria-live="polite">
      <p>Check the highlighted fields.</p>
      <ul>
        {errors.map((error) => (
          <li key={error.id}>
            <a href={`#${error.id}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Call after setting validation errors so React can render their aria-invalid state. */
export function focusFirstError(form: HTMLFormElement) {
  requestAnimationFrame(() =>
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}
