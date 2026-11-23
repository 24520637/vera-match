import { randomUUID } from "node:crypto";
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


describe("C065 closure barrier versus actual integrated authorization",()=>{
 let h:IntegratedWorkflowHarness;
 beforeAll(async()=>{h=await integratedWorkflowHarness();},60000);
 afterAll(async()=>{await h?.close();});
 test.each(operations.flatMap(c=>[true,false].map(closureFirst=>({...c,closureFirst}))))("$name / closure first=$closureFirst",async c=>{
 const f=await h.workflow(c.stage),match=c.name === "matching-read" ? await h.matching(f):undefined;
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

 const closure=()=>h.request(f.owner.cookie,"account-closure",{password:f.owner.password,confirmation:"CLOSE MY ACCOUNT",expectedRevision:0},"POST",{"Idempotency-Key":randomUUID()});
 const [a,b]=c.closureFirst ? await orderedTransactions(h,closure,run):await orderedTransactions(h,run,closure);
 expect((c.closureFirst ? a:b).status).toBe(202);
 const response=c.closureFirst ? b:a;
 if(!c.closureFirst) expect(response.status).toBe(200);
 else if(c.name === "matching-read") { expect(response.status).toBe(200);expect((await response.json() as {recommendations:unknown[]}).recommendations).toEqual([]); }
 else expect([401,403,404]).toContain(response.status);
 const after=await run();
 if(c.name === "matching-read") expect((await after.json() as {recommendations:unknown[]}).recommendations).toEqual([]);
 else expect([401,403,404]).toContain(after.status);
 });
 test.each([true,false])("C033 creation serializes with closure first=%s",async closureFirst=>{
 const f=await h.workflow("assigned");
 const intent=await h.request(f.owner.cookie,"videos/upload-intent",{mimeType:"video/mp4",sizeBytes:h.media.length});expect(intent.status).toBe(201);
 const video=await intent.json() as {id:string;uploadUrl:string};
 expect((await fetch(video.uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4"},body:h.media})).status).toBe(200);
 expect((await h.request(f.owner.cookie,"videos/"+video.id+"/confirm",{})).status).toBe(201);
 const assign=()=>h.request(f.moderator.cookie,"expert-admin/assignments",{videoId:video.id,expertId:f.expert.id,expectedCredentialRevision:1,dueAt:null,expiresAt:null});
 const close=()=>h.request(f.owner.cookie,"account-closure",{password:f.owner.password,confirmation:"CLOSE MY ACCOUNT",expectedRevision:0});
 const [a,b]=closureFirst ? await orderedTransactions(h,close,assign):await orderedTransactions(h,assign,close);
 expect((closureFirst?a:b).status).toBe(202);expect((closureFirst?b:a).status).toBe(closureFirst?403:201);
 expect(await h.db.client.expertAssignment.count({where:{videoId:video.id}})).toBe(closureFirst?0:1);
 });
 test.each([true,false])("upload capability issuance serializes with closure first=%s",async closureFirst=>{
 const f=await h.workflow("assigned");
 const issue=()=>h.request(f.owner.cookie,"videos/upload-intent",{mimeType:"video/mp4",sizeBytes:h.media.length});
 const close=()=>h.request(f.owner.cookie,"account-closure",{password:f.owner.password,confirmation:"CLOSE MY ACCOUNT",expectedRevision:0});
 const [a,b]=closureFirst ? await orderedTransactions(h,close,issue):await orderedTransactions(h,issue,close);
 expect((closureFirst?a:b).status).toBe(202);expect((closureFirst?b:a).status).toBe(closureFirst?403:201);
 expect((await issue()).status).toBe(401);
 });

});
