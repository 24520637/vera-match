import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { AppModule } from "../src/app.module";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { SessionService } from "../src/auth/session.service";
import { MatchingService } from "../src/matching/matching.service";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { integratedWorkflowHarness } from "./integrated-workflow-fixtures";

it("C095 reproduces pre-restriction state after an old backup restore without opening traffic",async()=>{
 const previousKey=process.env.MATCHING_HANDLE_KEY; process.env.MATCHING_HANDLE_KEY=randomBytes(32).toString("hex");
 const h=await integratedWorkflowHarness();
 const targetName="vera_c095_restriction_"+randomUUID().replaceAll("-","");
 const dir=mkdtempSync(join(tmpdir(),"vera-c095-restriction-")),archive=join(dir,"synthetic.dump");
 const configured=new URL(h.db.url),targetUrl=new URL(h.db.url);targetUrl.pathname="/"+targetName;
 const bin=process.env.C095_PG_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin":"/usr/lib/postgresql/18/bin");
 const exe=(name:string)=>join(bin,name+(process.platform === "win32" ? ".exe":""));
 const env={...process.env,PGHOST:configured.hostname.replace(/^\[|\]$/g,""),PGPORT:"5433",PGUSER:decodeURIComponent(configured.username),PGPASSWORD:decodeURIComponent(configured.password),PGDATABASE:decodeURIComponent(configured.pathname.slice(1)),PGCONNECT_TIMEOUT:"5"};
 const command=(name:string,args:string[],database=env.PGDATABASE)=>execFileSync(exe(name),args,{env:{...env,PGDATABASE:database},windowsHide:true,stdio:"pipe",timeout:120000});
 let created=false,target:PrismaClient|undefined,restored:Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>|undefined;
 const catalog=async(client:PrismaClient)=>{
 const [row]=await client.$queryRaw<{foreignKeys:number;triggers:number;migrations:number}[]>`SELECT
 (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname=${h.db.schema}) AS "foreignKeys",
 (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname=${h.db.schema}) AS triggers,
 (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations`;return row;};
 try {
 expect(process.env.NODE_ENV).toBe("test");expect(configured.port).toBe("5433");expect(["localhost","127.0.0.1","[::1]"]).toContain(configured.hostname);
 expect(h.db.schema).toMatch(/^vera_auth_test_[a-f0-9]{32}$/);expect(targetName).toMatch(/^vera_c095_restriction_[a-f0-9]{32}$/);
 expect(command("pg_dump",["--version"]).toString()).toMatch(/18\./);
 const f=await h.workflow("shared"),active=await h.workflow("draft"),match=await h.matching(f);
 const original=await catalog(h.db.client);
 const assignmentBeforeBackup=await h.db.client.expertAssignment.findUniqueOrThrow({where:{id:active.id}});
 const decisions=await h.db.client.reviewDecisionEvidence.findMany({where:{reviewId:f.reviewId},orderBy:{version:"asc"}});
 command("pg_dump",["--format=custom","--no-owner","--no-acl","--schema",h.db.schema,"--file",archive]);chmodSync(archive,0o600);
 const checksum=createHash("sha256").update(readFileSync(archive)).digest("hex");
 expect(command("pg_restore",["--list",archive]).length).toBeGreaterThan(100);
 for(const owner of [f.owner,active.owner]) expect((await h.request(owner.cookie,"account-closure",{password:owner.password,confirmation:"CLOSE MY ACCOUNT",expectedRevision:0})).status).toBe(202);
 await Promise.all([h.app.get(AssignmentCancellationWorker).runOnce(),h.app.get(AssignmentCancellationWorker).runOnce()]);
 await h.app.get(VideoCleanupService).runOnce();
 expect((await h.db.client.expertAssignment.findUniqueOrThrow({where:{id:active.id}})).status).toBe("CANCELLED");
 expect(await h.db.client.assignmentEvent.count({where:{assignmentId:active.id,toStatus:"CANCELLED"}})).toBe(1);
 expect(await h.finalObjectAbsent(active.videoId)).toBe(true);
 expect((await h.db.client.video.findUniqueOrThrow({where:{id:active.videoId}})).cleanupCompletedAt).toBeNull();
 expect((await h.request(match.viewer.cookie,"matches/"+match.reference+"/decision",{choice:"ACCEPT"})).status).toBe(404);
 expect(await h.app.get(SessionService).resolve(f.owner.token)).toBeNull();
 if(targetName === decodeURIComponent(configured.pathname.slice(1))) throw Error("Configured database refused");
 created=true;await h.db.client.$executeRawUnsafe('CREATE DATABASE "'+targetName+'" TEMPLATE template0');
 expect(createHash("sha256").update(readFileSync(archive)).digest("hex")).toBe(checksum);
 command("pg_restore",["--exit-on-error","--single-transaction","--no-owner","--no-acl","--dbname",targetName,archive],targetName);
 target=new PrismaClient({datasources:{db:{url:targetUrl.toString()}},log:[]});
 execFileSync(process.execPath,[resolve(__dirname,"../../../node_modules/prisma/build/index.js"),"migrate","deploy","--schema",resolve(__dirname,"../prisma/schema.prisma")],{env:{...process.env,DATABASE_URL:targetUrl.toString()},stdio:"pipe",windowsHide:true,timeout:30000});
 expect(await catalog(target)).toEqual(original);
 expect(await target.reviewDecisionEvidence.findMany({where:{reviewId:f.reviewId}})).toEqual(decisions);
 await expect(target.reviewDecisionEvidence.deleteMany({where:{reviewId:f.reviewId}})).rejects.toBeDefined();
 restored=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(target)
 .overrideProvider(EnvironmentService).useValue({values:{...h.values,databaseUrl:targetUrl.toString()}}).compile();
 await restored.init();
 // NEGATIVE CONTROL: application services are never exposed through a listener.
 // No independent restriction journal exists to tell this old backup what happened.
 expect(await restored.get(SessionService).resolve(f.owner.token)).not.toBeNull();
 expect(await target.accountClosure.count()).toBe(0);
 expect(await target.expertAssignment.findUniqueOrThrow({where:{id:active.id}})).toEqual(assignmentBeforeBackup);
 expect((await target.video.findUniqueOrThrow({where:{id:active.videoId}})).status).toBe("READY");
 const viewer=await restored.get(SessionService).resolve(match.viewer.token);expect(viewer).not.toBeNull();
 await expect(restored.get(MatchingService).decide(viewer!,match.reference,{}, {choice:"ACCEPT"})).resolves.toBeDefined();
 // This is a reproduced failure mode, not successful lifecycle-safe recovery.
 expect(await target.consent.count({where:{userId:f.owner.id,granted:true}})).toBe(5);
 console.info(JSON.stringify({code:"C095_RESTRICTION_RESTORE_NEGATIVE_CONTROL",...original,oldSessionRevived:true,oldConsentRevived:true,oldMatchingAuthorizationRevived:true,recoveryGuarantee:"BLOCKED_INDEPENDENT_JOURNAL_MISSING",ordinaryTrafficOpened:false}));
 } finally {
 await restored?.close();await target?.$disconnect();
 if(created) {if(!/^vera_c095_restriction_[a-f0-9]{32}$/.test(targetName))throw Error("Unsafe recovery cleanup");await h.db.client.$executeRawUnsafe('DROP DATABASE IF EXISTS "'+targetName+'"');}
 await h.close();
 if(dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("vera-c095-restriction-"))throw Error("Unsafe archive cleanup");
 try{unlinkSync(archive);}catch(e){if((e as NodeJS.ErrnoException).code !== "ENOENT")throw e;}rmdirSync(dir);
 if(previousKey === undefined)delete process.env.MATCHING_HANDLE_KEY;else process.env.MATCHING_HANDLE_KEY=previousKey;
 }
},120000);
