import { integratedWorkflowHarness, IntegratedWorkflowHarness, orderedTransactions } from "./integrated-workflow-fixtures";
import type { WorkflowStage } from "./integrated-workflow-fixtures";
type Operation = "playback" | "draft-init" | "draft-read" | "draft-edit" | "submit" | "qa-read" |
  "qa-return" | "qa-approve" | "confirm" | "share" | "owner-report" | "matching-read";
const operations: { name: Operation; stage: WorkflowStage; audit?: string; assignmentSubject?: boolean; emptyRead?: boolean }[] = [
  { name: "playback", stage: "assigned", audit: "EXPERT_PLAYBACK_ISSUED", assignmentSubject: true },
  { name: "draft-init", stage: "assigned", audit: "EXPERT_DRAFT_CREATED", assignmentSubject: true },
  { name: "draft-read", stage: "draft", audit: "EXPERT_DRAFT_READ", assignmentSubject: true },
  { name: "draft-edit", stage: "draft", audit: "EXPERT_DRAFT_SAVED" },
  { name: "submit", stage: "draft", audit: "EXPERT_REVIEW_SUBMITTED" },
  { name: "qa-read", stage: "submitted", audit: "EXPERT_REVIEW_QA_READ" },
  { name: "qa-return", stage: "submitted", audit: "EXPERT_REVIEW_RETURNED" },
  { name: "qa-approve", stage: "submitted", audit: "EXPERT_REVIEW_APPROVED" },
  { name: "confirm", stage: "approved", audit: "REVIEW_CLAIM_CONFIRMED" },
  { name: "share", stage: "confirmed", audit: "REVIEW_CLAIM_SHARED" },
  { name: "owner-report", stage: "shared", emptyRead: true },
  { name: "matching-read", stage: "shared", emptyRead: true },
];


describe("C062 real bilateral block integration across review and matching", () => {
 let h: IntegratedWorkflowHarness;
 beforeAll(async () => { h = await integratedWorkflowHarness(); }, 60000);
 afterAll(async () => { await h?.close(); });
 test.each(operations)("owner blocks expert before $name", async c => {
 const f=await h.workflow(c.stage);
 const match=c.name === "matching-read" ? await h.matching(f) : undefined;
    const run = () => {
      switch (c.name) {
        case "playback": return h.play(f.expert.cookie, f.id);
        case "draft-init": return h.request(f.expert.cookie, f.initPath, {});
        case "draft-read": return h.request(f.expert.cookie, f.initPath, undefined, "GET");
        case "draft-edit": return h.request(f.expert.cookie, "expert/reviews/" + f.reviewId + "/draft", {
          expectedVersion: 2, summary: "Synthetic concurrent private summary.",
        }, "PATCH");
        case "submit": return h.request(f.expert.cookie, "expert/reviews/" + f.reviewId + "/submit", { expectedVersion: 2 });
        case "qa-read": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId, undefined, "GET");
        case "qa-return": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId + "/return", {
          expectedVersion: 3, reason: "Synthetic private return feedback.",
        });
        case "qa-approve": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId + "/approve", {
          expectedVersion: 3, claims: [{ type: "INTEREST_READING", observationId: f.observationId,
            context: "Synthetic hobbies prompt.", transcript: "Synthetic: I enjoy reading." }],
        });
        case "confirm": return h.request(f.owner.cookie, "reviews/claims/" + f.claimId, { action: "CONFIRM", expectedRevision: 0 }, "PATCH");
        case "share": return h.request(f.owner.cookie, "reviews/claims/" + f.claimId, { action: "SHARE", expectedRevision: 1 }, "PATCH");
        case "owner-report": return h.request(f.owner.cookie, "reviews/me", undefined, "GET");
        case "matching-read": return match!.read();
      }
    };

 const where={action:c.audit, subjectId:c.assignmentSubject ? f.id : c.name === "confirm" || c.name === "share" ? f.claimId : f.reviewId};
 const before=c.audit ? await h.db.client.auditLog.count({where}) : 0;
 expect((await h.request(f.owner.cookie,"blocks",{targetUserId:f.expert.id})).status).toBe(204);
 expect((await h.request(f.owner.cookie,"blocks",{targetUserId:f.expert.id})).status).toBe(204);
 const response=await run();
 if(c.emptyRead) {
 expect(response.status).toBe(200); const body=await response.json() as {reports?:unknown[];recommendations?:{reasons:string[]}[]};
 if(c.name === "owner-report") expect(body.reports).toEqual([]);
 else expect(body.recommendations!.flatMap(r=>r.reasons)).not.toContain("The member said they enjoy reading.");
 } else expect([403,404]).toContain(response.status);
 if(c.audit) expect(await h.db.client.auditLog.count({where})).toBe(before);
 const audit=await h.db.client.auditLog.findMany({where:{actorId:f.owner.id,action:"SAFETY_BLOCK_CREATED"}});
 expect(audit).toHaveLength(1);
 expect(JSON.stringify(audit)).not.toMatch(/Synthetic|password|token|summary|transcript/);
 expect((await h.db.client.expertAssignment.findUniqueOrThrow({where:{id:f.id}})).status).not.toBe("CANCELLED");
 });
 test.each(["block-first","submit-first"])("block and submit serialize: %s",async order=>{
 const f=await h.workflow("draft");
 const block=()=>h.request(f.owner.cookie,"blocks",{targetUserId:f.expert.id});
 const submit=()=>h.request(f.expert.cookie,"expert/reviews/"+f.reviewId+"/submit",{expectedVersion:2});
 const [a,b]=order === "block-first" ? await orderedTransactions(h,block,submit) : await orderedTransactions(h,submit,block);
 expect((order === "block-first" ? a:b).status).toBe(204);
 expect((order === "block-first" ? b:a).status).toBe(order === "block-first" ? 403:200);
 expect((await submit()).status).toBe(403);
 });
});
