import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../config/environment.module';
import { PasswordService } from './password.service';

@Module({ imports: [EnvironmentModule], providers: [PasswordService], exports: [PasswordService] })
export class AuthModule {}
