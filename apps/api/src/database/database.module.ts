import { Global, Module } from "@nestjs/common";
import { EnvironmentModule } from "../config/environment.module";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  imports: [EnvironmentModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
