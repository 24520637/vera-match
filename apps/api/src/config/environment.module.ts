import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfiguration, validateEnvironment } from './environment';

@Injectable()
export class EnvironmentService {
  readonly values: AppConfiguration;
  constructor(config: ConfigService) { this.values = config.getOrThrow<AppConfiguration>('app'); }
}

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'], validate: validateEnvironment })],
  providers: [EnvironmentService], exports: [EnvironmentService],
})
export class EnvironmentModule {}
