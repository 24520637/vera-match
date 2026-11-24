import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAuthDatabase } from "./disposable-auth-database";

it("adds staff trust without provisioning legacy roles or changing existing constraints/evidence",async()=>{
 const admin=await createAuthDatabase(); const schema="vera_staff_upgrade_"+randomUUID().replaceAll("-","");
 const url=new URL(admin.url); url.searchParams.set("schema",schema);
 const client=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
 const temp=mkdtempSync(join(tmpdir(),"vera-staff-upgrade-")); const prisma=resolve(__dirname,"../prisma");
 const run=(file:string)=>execFileSync(process.execPath,[resolve(__dirname,"../../../node_modules/prisma/build/index.js"),"migrate","deploy","--schema",file],{env:{...process.env,DATABASE_URL:url.toString()},windowsHide:true,stdio:"pipe",timeout:30000});
 let baselineTables:string[]=[];
 // Compare every pre-existing table, while allowing reviewed later migrations
 // to add their own tables. No existing constraint is filtered out by name.
 const constraints=()=>client.$queryRawUnsafe<{name:string,definition:string}[]>("SELECT c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON c.connamespace=n.oid JOIN pg_class r ON r.oid=c.conrelid WHERE n.nspname=$1 AND r.relname=ANY($2::text[]) ORDER BY c.conname",schema,baselineTables);
 try{
  await admin.client.$executeRawUnsafe('CREATE SCHEMA "'+schema+'"'); cpSync(join(prisma,"schema.prisma"),join(temp,"schema.prisma")); mkdirSync(join(temp,"migrations")); cpSync(join(prisma,"migrations/migration_lock.toml"),join(temp,"migrations/migration_lock.toml"));
  for(const name of readdirSync(join(prisma,"migrations")).filter(x=>/^\d+_/.test(x)&&x<"20261124010000_staff_trust"))cpSync(join(prisma,"migrations",name),join(temp,"migrations",name),{recursive:true});
  run(join(temp,"schema.prisma"));
  baselineTables=(await client.$queryRawUnsafe<{name:string}[]>("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p')",schema)).map(row=>row.name);
  const user=await client.user.create({data:{email:randomUUID()+"@example.invalid",passwordHash:"SYNTHETIC",role:"MODERATOR",status:"ACTIVE",emailVerifiedAt:new Date()}});
  const session=await client.session.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});
  const before=await constraints(); const audits=await client.auditLog.findMany(); run(join(prisma,"schema.prisma"));
  expect(await client.user.findUnique({where:{id:user.id}})).toEqual(user); expect(await client.session.findUnique({where:{id:session.id}})).toEqual(session);
  expect(await client.staffIdentity.count()).toBe(0); expect(await client.staffTrustEvent.count()).toBe(0); expect(await constraints()).toEqual(before); expect(await client.auditLog.findMany()).toEqual(audits); run(join(prisma,"schema.prisma"));
 }finally{
  await client.$disconnect(); try{if(!/^vera_staff_upgrade_[a-f0-9]{32}$/.test(schema))throw new Error("Unsafe test cleanup"); await admin.client.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await admin.close(); if(dirname(resolve(temp))!==resolve(tmpdir())||!basename(temp).startsWith("vera-staff-upgrade-"))throw new Error("Unsafe temporary fixture cleanup"); rmSync(temp,{recursive:true,force:true});}
 }
},90000);
