import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { StaffMfaKeyring } from "./staff-mfa-keyring";
@Injectable()
export class StaffMfaKeyRotationService {
 constructor(private readonly prisma:PrismaService,private readonly keys:StaffMfaKeyring){}
 /** Operator-only maintenance: changes no identity, factor secret or MFA proof. */
 async rewrapAll(){
  const box=this.keys.box;let after:string|undefined,updated=0,alreadyCurrent=0,failed=0;
  for(;;){
   const batch=await this.prisma.staffIdentity.findMany({where:after?{userId:{gt:after}}:{},orderBy:{userId:"asc"},take:50,select:{userId:true}});if(!batch.length)break;
   for(const {userId} of batch){
    try{
     const result=await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "userId" FROM "StaffIdentity" WHERE "userId"=${userId} FOR UPDATE`;
      const identity=await tx.staffIdentity.findUniqueOrThrow({where:{userId}});
      await tx.$queryRaw`SELECT id FROM "StaffMfaDevice" WHERE "subjectId"=${identity.subjectId}::uuid ORDER BY id FOR UPDATE`;
      const devices=await tx.staffMfaDevice.findMany({where:{subjectId:identity.subjectId},orderBy:{id:"asc"}});let changed=0,current=0;
      for(const device of devices){
       const binding=JSON.stringify([identity.subjectId,device.id,device.mfaEpoch.toString()]);
       const secret=box.open(device.secretEnvelope,binding);secret.fill(0);
       if(device.secretEnvelope.split(".")[1]===box.currentKeyId()){current++;continue;}
       const next=box.rewrap(device.secretEnvelope,binding);
       const result=await tx.staffMfaDevice.updateMany({where:{id:device.id,secretEnvelope:device.secretEnvelope},data:{secretEnvelope:next}});
       if(result.count!==1)throw new Error("STAFF_KEY_ROTATION_CONFLICT");
       await tx.staffMfaEvent.create({data:{subjectId:identity.subjectId,identityRevision:identity.revision,mfaEpoch:device.mfaEpoch,deviceId:device.id,kind:"KEY_REWRAPPED"}});changed++;
      }
      if(changed)await tx.auditLog.create({data:{actorId:null,action:"STAFF_MFA_KEY_REWRAPPED",subjectType:"StaffIdentity",subjectId:identity.subjectId}});
      return {changed,current};
     },{timeout:15000});updated+=result.changed;alreadyCurrent+=result.current;
    }catch{failed++;} // Counts only; no account/device IDs or provider payloads.
   }
   after=batch[batch.length-1].userId;
  }
  return {updated,alreadyCurrent,failed};
 }
}
