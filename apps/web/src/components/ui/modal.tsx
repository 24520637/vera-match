"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "./button";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  initialFocusRef,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    (initialFocusRef?.current ?? headingRef.current)?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open, initialFocusRef]);

  function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const targets = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.closest("[hidden], [inert]") &&
        element.getClientRects().length > 0,
    );
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (!first) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === headingRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={containTab}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
    >
      <div className="modal__heading">
        <h2 ref={headingRef} tabIndex={-1} id={titleId}>
          {title}
        </h2>
        <Button
          variant="quiet"
          size="small"
          onClick={() => onOpenChange(false)}
          aria-label="Close dialog"
        >
          Close
        </Button>
      </div>
      {description && (
        <p className="modal__description" id={descriptionId}>
          {description}
        </p>
      )}
      <div className="modal__body">{children}</div>
    </dialog>
  );
}
