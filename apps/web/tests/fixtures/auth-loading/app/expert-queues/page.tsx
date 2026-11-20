"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { AssignmentQueue } from "../../../../../src/components/expert/assignment-queue";
import { AssignmentScreen } from "../../../../../src/components/expert/assignment-screen";
import { AssignmentConfirmation } from "../../../../../src/components/expert/assignment-confirmation";
import { Button } from "../../../../../src/components/ui/button";
import { apiJson } from "../../../../../src/lib/api";
import type { AssignmentQueueLoader, AssignmentQueuePage } from "../../../../../src/lib/expert-queue-view";

/** Isolated synthetic presentation host. This endpoint/model exists ONLY in tests;
 * neither the host nor its loader is imported by production routes.
 */
function Fixture() {
  const query = useSearchParams(), mode = query.get("mode"), role = query.get("role") === "moderator" ? "MODERATOR" : "EXPERT";
  const [open, setOpen] = useState(false);
  const loader = useMemo<AssignmentQueueLoader | undefined>(() => mode === "unconnected" ? undefined : async ({ cursor, signal }) => {
    const page = await apiJson<AssignmentQueuePage>("/__test__/expert-queue" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), { signal });
    if (!page) throw new Error("Missing synthetic page");
    return page;
  }, [mode]);
  return <AuthProvider><main>{mode === "live" ? <AssignmentScreen role={role} /> : <AssignmentQueue role={role} loader={loader} />}
    <Button onClick={() => setOpen(true)}>Preview confirmation</Button>
    <AssignmentConfirmation open={open} onClose={() => setOpen(false)} preview={{ videoId: "synthetic-video-reference",
      expertId: "synthetic-expert-reference", expectedCredentialRevision: 1, dueAt: null, expiresAt: null }} />
  </main></AuthProvider>;
}
export default function ExpertQueueFixture() {
  return <Suspense fallback={<p>Loading synthetic fixture…</p>}><Fixture /></Suspense>;
}
