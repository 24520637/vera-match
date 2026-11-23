import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { MfaSecretBox } from "./mfa-crypto";
@Injectable()
export class StaffMfaKeyring {
 private readonly configured?: MfaSecretBox;
 constructor(){
  const file=process.env.STAFF_MFA_KEYRING_PATH; if(!file)return;
  try{
   if(!isAbsolute(file)||statSync(file).size>16384)throw new Error();
   const data=JSON.parse(readFileSync(file,"utf8"));
   if(!data||Object.keys(data).sort().join(",")!=="activeKeyId,keys,schemaVersion"||data.schemaVersion!==1||typeof data.activeKeyId!=="string"||!Array.isArray(data.keys))throw new Error();
   const keys=new Map<string,Buffer>();
   for(const entry of data.keys){
    if(!entry||Object.keys(entry).sort().join(",")!=="id,keyBase64url"||typeof entry.id!=="string"||typeof entry.keyBase64url!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(entry.keyBase64url)||keys.has(entry.id))throw new Error();
    const key=Buffer.from(entry.keyBase64url,"base64url"); if(key.length!==32||key.toString("base64url")!==entry.keyBase64url)throw new Error(); keys.set(entry.id,key);
   }
   this.configured=new MfaSecretBox(keys,data.activeKeyId); for(const key of keys.values())key.fill(0);
  }catch{throw new Error("STAFF_MFA_KEYRING_INVALID");}
 }
 get box():MfaSecretBox{
  if(!this.configured)throw new ServiceUnavailableException({code:"STAFF_MFA_UNAVAILABLE",message:"Secure staff MFA is not configured."}); return this.configured;
 }
}
