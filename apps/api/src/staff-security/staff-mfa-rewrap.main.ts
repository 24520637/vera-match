import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EnvironmentModule } from "../config/environment.module";
import { EnvironmentService } from "../config/environment.service";
import { DatabaseModule } from "../database/database.module";
import { StaffMfaKeyring } from "./staff-mfa-keyring";
import { StaffMfaKeyRotationService } from "./staff-mfa-key-rotation.service";
import { staffDatabaseFingerprint } from "./staff-provision.main";
@Module({imports:[EnvironmentModule,DatabaseModule],providers:[StaffMfaKeyring,StaffMfaKeyRotationService]})
class KeyRotationModule {}
async function main(args:string[]){
 if(args.length!==3||args[0]!=="--database-fingerprint"||!/^[a-f0-9]{64}$/.test(args[1])||args[2]!=="--apply")throw new Error("STAFF_OPERATOR_ARGUMENTS_INVALID");
 const app=await NestFactory.createApplicationContext(KeyRotationModule,{logger:false,abortOnError:false});
 try{if(staffDatabaseFingerprint(app.get(EnvironmentService).values.databaseUrl)!==args[1])throw new Error("STAFF_DATABASE_TARGET_MISMATCH");const result=await app.get(StaffMfaKeyRotationService).rewrapAll();console.info(JSON.stringify({code:"STAFF_MFA_KEY_ROTATION_RESULT",...result}));if(result.failed)process.exitCode=1;}finally{await app.close();}
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({code:"STAFF_MFA_KEY_ROTATION_FAILED"}));process.exitCode=1;});
