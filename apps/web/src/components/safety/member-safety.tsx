"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiJson, ApiError } from "@/lib/api";
import { memberErrors, type Values } from "@/lib/member-contracts";
import {
  reportReasons,
  safetyMessage,
  validReference,
} from "@/lib/safety-contracts";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useAuth } from "../auth/auth-provider";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
import { PageHeader } from "../layout/page-layout";
import { MemberSettingsNav } from "../member/member-settings";
import { useMemberDrafts } from "../member/member-drafts";
import { Button, ButtonLink } from "../ui/button";
import {
  ErrorSummary,
  Form,
  Input,
  Select,
  Textarea,
  focusFirstError,
} from "../ui/form";
import { Modal } from "../ui/modal";
import { EmptyState, LoadingState, Notice } from "../ui/status";
import "./safety.css";
type Block = { targetUserId: string; createdAt: string };
type Page = { blocks: Block[]; nextCursor: string | null };
export function MemberSafety() {
  const { state } = useAuth();
  if (state.status === "checking")
    return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated" || state.user.role !== "MEMBER")
    return (
      <Notice tone="warning" title="Safety settings unavailable">
        An active verified member session is required.
      </Notice>
    );
  return <SafetyEditor key={state.user.id} />;
}
function SafetyEditor() {
  const memory = useMemberDrafts(),
    restored = useRef(memory?.read("safety"));
  const [draft, setDraft] = useState<Values>(
    () =>
      restored.current?.values ?? {
        blockTarget: "",
        targetUserId: "",
        reason: "",
        details: "",
      },
  );
  const [blocks, setBlocks] = useState<Block[]>(),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  const [blockError, setBlockError] = useState<unknown>(),
    [reportError, setReportError] = useState<unknown>(),
    [listError, setListError] = useState<unknown>();
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({}),
    [success, setSuccess] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [working, setWorking] = useState(false),
    [confirm, setConfirm] = useState<{
      kind: "block" | "unblock";
      target: string;
    }>();
  const alive = useRef(true),
    sequence = useRef(0),
    safeAction = useRef<HTMLButtonElement>(null),
    reportForm = useRef<HTMLFormElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const blockRetry = useRetryAfter(),
    reportRetry = useRetryAfter(),
    listRetry = useRetryAfter(),
    unblockRetry = useRetryAfter();
  const text = (key: string) => String(draft[key] ?? "");
  const dirty = Object.keys(draft).filter(
    (k) => String(draft[k] ?? "").length > 0,
  );
  useEffect(() => {
    memory?.write("safety", { values: draft, dirty });
  }, [memory, draft, dirty.join("|")]);
  useUnsavedChanges(
    dirty.length > 0,
    "Leave this page? Your unsent safety request will be lost.",
  );
  const blockFields = {
    ...memberErrors(blockError, ["targetUserId"]),
    ...(localErrors.blockTarget
      ? { targetUserId: localErrors.blockTarget }
      : {}),
  };
  const reportFields = {
    ...memberErrors(reportError, ["targetUserId", "reason", "details"]),
    ...Object.fromEntries(
      Object.entries(localErrors).filter(([k]) => k !== "blockTarget"),
    ),
  };
  async function load(append = false) {
    if (append && !cursor) return;
    const current = ++sequence.current;
    setLoading(true);
    setListError(undefined);
    try {
      const result = await apiJson<Page>(
        "/blocks/me" + (append ? "?cursor=" + encodeURIComponent(cursor!) : ""),
      );
      if (!result) throw new Error("Your block list could not be loaded.");
      if (alive.current && current === sequence.current) {
        setBlocks((previous) =>
          append
            ? [
                ...(previous ?? []),
                ...result.blocks.filter(
                  (row) =>
                    !previous?.some((p) => p.targetUserId === row.targetUserId),
                ),
              ]
            : result.blocks,
        );
        setCursor(result.nextCursor);
      }
    } catch (error) {
      if (alive.current && current === sequence.current) {
        setListError(error);
        listRetry.fromError(error);
        if (
          error instanceof ApiError &&
          [401, 403].includes(error.status ?? 0)
        ) {
          setBlocks(undefined);
          setCursor(null);
        }
      }
    } finally {
      if (alive.current && current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      ++sequence.current;
    };
  }, []);
  function edit(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setLocalErrors((e) => ({ ...e, [key]: "" }));
    setSuccess("");
  }
  function askBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBlockError(undefined);
    setSuccess("");
    if (!validReference(text("blockTarget"))) {
      setLocalErrors((e) => ({
        ...e,
        blockTarget: "Enter a valid account reference.",
      }));
      focusFirstError(event.currentTarget);
      return;
    }
    setConfirm({ kind: "block", target: text("blockTarget") });
  }
  async function changeBlock() {
    if (!confirm || working) return;
    const action = confirm;
    setWorking(true);
    setBlockError(undefined);
    try {
      await apiJson(
        action.kind === "block"
          ? "/blocks"
          : "/blocks/" + encodeURIComponent(action.target),
        {
          method: action.kind === "block" ? "POST" : "DELETE",
          json: action.kind === "block" ? { targetUserId: action.target } : {},
        },
      );
      if (!alive.current) return;
      setConfirm(undefined);
      if (action.kind === "block") setDraft((d) => ({ ...d, blockTarget: "" }));
      setSuccess(
        action.kind === "block"
          ? "Block saved. This reference is on your block list."
          : "Your block was removed. This does not create a connection.",
      );
      await load();
      heading.current?.focus();
    } catch (error) {
      if (alive.current) {
        setBlockError(error);
        (action.kind === "block" ? blockRetry : unblockRetry).fromError(error);
      }
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  async function sendReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (working || reportRetry.seconds) return;
    setReportError(undefined);
    setSuccess("");
    const errors: Record<string, string> = {};
    if (!validReference(text("targetUserId")))
      errors.targetUserId = "Enter a valid account reference.";
    if (!Object.hasOwn(reportReasons, text("reason")))
      errors.reason = "Choose a report reason.";
    const count = [
      ...text("details").normalize("NFC").replace(/\r\n?/g, "\n").trim(),
    ].length;
    if (count < 10 || count > 2000)
      errors.details = "Use 10 to 2000 characters.";
    setLocalErrors(errors);
    if (Object.keys(errors).length) {
      focusFirstError(event.currentTarget);
      return;
    }
    setWorking(true);
    setReportBusy(true);
    try {
      const result = await apiJson<{ message: string }>("/reports", {
        method: "POST",
        json: {
          targetUserId: text("targetUserId"),
          reason: text("reason"),
          details: text("details"),
        },
      });
      if (!result)
        throw new Error("Your report request could not be confirmed.");
      if (alive.current) {
        setDraft((d) => ({ ...d, targetUserId: "", reason: "", details: "" }));
        setSuccess(result.message);
        heading.current?.focus();
      }
    } catch (error) {
      if (alive.current) {
        setReportError(error);
        reportRetry.fromError(error);
        focusFirstError(form);
      }
    } finally {
      if (alive.current) {
        setWorking(false);
        setReportBusy(false);
      }
    }
  }
  return (
    <div className="container safety-workspace">
      <MemberSettingsNav />
      <PageHeader
        title="Your safety choices"
        description="Manage blocked account references and send a private report."
      />
      <h2 ref={heading} tabIndex={-1}>
        Your boundaries
      </h2>
      <p>
        Use an account reference you already have. This screen does not search
        or reveal profiles. Blocked interactions still need integration with the
        upcoming matching and expert workflows.
      </p>
      {success && (
        <Notice tone="success" title="Request confirmed">
          {success}
        </Notice>
      )}
      <Form noValidate onSubmit={askBlock}>
        <Input
          id="block-target"
          name="blockTarget"
          label="Account reference to block"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          value={text("blockTarget")}
          onChange={(e) => edit("blockTarget", e.target.value)}
          error={blockFields.targetUserId}
          disabled={working}
        />
        <ErrorSummary
          errors={
            blockFields.targetUserId
              ? [{ id: "block-target", message: blockFields.targetUserId }]
              : []
          }
        />
        <Button type="submit" disabled={working || blockRetry.seconds > 0}>
          Block account
        </Button>
        <RetryAfterFeedback id="block-retry" seconds={blockRetry.seconds} />
      </Form>
      {!!blockError && (
        <Notice tone="error" title="Block change not confirmed">
          {safetyMessage(blockError)} Refresh the list before retrying an
          uncertain change.
        </Notice>
      )}
      <section className="safety-section" aria-labelledby="blocked-heading">
        <h2 id="blocked-heading">Blocked accounts</h2>
        <Button
          variant="secondary"
          onClick={() => void load()}
          disabled={loading || working || listRetry.seconds > 0}
        >
          Refresh block list
        </Button>
        {loading && !blocks && (
          <LoadingState label="Loading blocked accounts…" />
        )}
        {!!listError && (
          <Notice tone="error" title="Block list unavailable">
            {safetyMessage(listError)}
          </Notice>
        )}
        {blocks?.length === 0 && (
          <EmptyState title="No blocked accounts">
            Saved blocks will appear here.
          </EmptyState>
        )}
        <ul className="safety-list" aria-busy={loading}>
          {blocks?.map((row) => (
            <li key={row.targetUserId}>
              <h3>Blocked account</h3>
              <p>
                Reference: <span translate="no">{row.targetUserId}</span>
              </p>
              <p>
                Blocked{" "}
                {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                  new Date(row.createdAt),
                )}
              </p>
              <div className="form-actions">
                <Button
                  variant="secondary"
                  aria-label={"Unblock account " + row.targetUserId}
                  disabled={working || unblockRetry.seconds > 0}
                  onClick={() => {
                    setBlockError(undefined);
                    setConfirm({ kind: "unblock", target: row.targetUserId });
                  }}
                >
                  Unblock
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    edit("targetUserId", row.targetUserId);
                    requestAnimationFrame(() =>
                      document.getElementById("report-reason")?.focus(),
                    );
                  }}
                >
                  Report this account
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {cursor && (
          <Button
            variant="secondary"
            loading={loading}
            loadingLabel="Loading blocked accounts…"
            disabled={working || listRetry.seconds > 0}
            onClick={() => void load(true)}
          >
            Load more blocked accounts
          </Button>
        )}
        <RetryAfterFeedback id="list-retry" seconds={listRetry.seconds} />
      </section>
      <section className="safety-section" aria-labelledby="report-heading">
        <h2 id="report-heading">Send a private report</h2>
        <p>
          You can report an account even after blocking it. Reports are not
          published. Do not include passwords, private video links or unrelated
          personal information.
        </p>
        <Form
          ref={reportForm}
          noValidate
          onSubmit={(event) => void sendReport(event)}
        >
          <Input
            id="report-target"
            name="targetUserId"
            label="Account reference to report"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={text("targetUserId")}
            onChange={(e) => edit("targetUserId", e.target.value)}
            error={reportFields.targetUserId}
            disabled={working}
          />
          <Select
            id="report-reason"
            name="reason"
            label="Report reason"
            required
            value={text("reason")}
            onChange={(e) => edit("reason", e.target.value)}
            error={reportFields.reason}
            disabled={working}
          >
            <option value="">Choose a reason</option>
            {Object.entries(reportReasons).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
          <Textarea
            id="report-details"
            name="details"
            label="What happened?"
            required
            maxLength={4000}
            hint="10–2000 characters. Keep details relevant to this concern."
            value={text("details")}
            onChange={(e) => edit("details", e.target.value)}
            error={reportFields.details}
            disabled={working}
          />
          <ErrorSummary
            errors={["targetUserId", "reason", "details"]
              .filter((k) => reportFields[k])
              .map((k) => ({
                id: k === "targetUserId" ? "report-target" : "report-" + k,
                message: reportFields[k],
              }))}
          />
          {!!reportError && (
            <Notice tone="error" title="Report request not confirmed">
              {safetyMessage(reportError)} Your entries are kept. Nothing is
              automatically resubmitted.
            </Notice>
          )}
          <RetryAfterFeedback id="report-retry" seconds={reportRetry.seconds} />
          <Button
            type="submit"
            loading={reportBusy}
            loadingLabel="Sending report…"
            disabled={working || reportRetry.seconds > 0}
          >
            Send private report
          </Button>
        </Form>
      </section>
      <section className="safety-section" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Account privacy</h2>
        <p>
          Account closure and erasure are not available in this build. You can
          review consent, delete your own videos, or end your sessions.
        </p>
        <div className="form-actions">
          <Link href="/account/consents">Consent choices</Link>
          <Link href="/account/videos">Your private videos</Link>
          <ButtonLink href="/account" variant="secondary">
            Review account sessions
          </ButtonLink>
        </div>
      </section>
      <Modal
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !working) setConfirm(undefined);
        }}
        title={
          confirm?.kind === "block"
            ? "Block this account?"
            : "Remove your block?"
        }
        description={
          confirm?.kind === "block"
            ? "This saves a restriction for this account reference. It does not submit a report."
            : "A restriction from the other account will still apply. Removing your block does not create a connection."
        }
        dismissible={!working}
        initialFocusRef={safeAction}
      >
        <p className="safety-reference" translate="no">
          {confirm?.target}
        </p>
        <div className="form-actions">
          <Button
            ref={safeAction}
            variant="secondary"
            disabled={working}
            onClick={() => setConfirm(undefined)}
          >
            {confirm?.kind === "block"
              ? "Keep account unblocked"
              : "Keep blocked"}
          </Button>
          <Button
            variant="danger"
            loading={working}
            loadingLabel="Saving block change…"
            disabled={
              (confirm?.kind === "block" ? blockRetry : unblockRetry).seconds >
              0
            }
            onClick={() => void changeBlock()}
          >
            {confirm?.kind === "block" ? "Confirm block" : "Remove block"}
          </Button>
        </div>
        {!!blockError && (
          <Notice tone="error" title="Block change not confirmed">
            {safetyMessage(blockError)}
          </Notice>
        )}
        <RetryAfterFeedback
          id="unblock-retry"
          seconds={
            confirm?.kind === "block"
              ? blockRetry.seconds
              : unblockRetry.seconds
          }
        />
      </Modal>
    </div>
  );
}
