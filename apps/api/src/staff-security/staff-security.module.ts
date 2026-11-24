import { Module } from "@nestjs/common";
import { RecoveryModule } from "../recovery/recovery.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EnvironmentModule } from "../config/environment.module";
import { StaffAuthority } from "./staff-authority";
import { StaffIdentityService } from "./staff-identity.service";
import { StaffMfaKeyring } from "./staff-mfa-keyring";
import { StaffMfaService } from "./staff-mfa.service";
import { StaffMfaController } from "./staff-mfa.controller";
@Module({imports:[RecoveryModule,AuthModule,DatabaseModule,EnvironmentModule],controllers:[StaffMfaController],providers:[StaffAuthority,StaffIdentityService,StaffMfaKeyring,StaffMfaService],exports:[StaffIdentityService,StaffMfaService]})
export class StaffSecurityModule {}
