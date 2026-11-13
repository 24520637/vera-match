import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfiguration } from "./environment";

@Injectable()
export class EnvironmentService {
  readonly values: AppConfiguration;
  constructor(config: ConfigService) {
    this.values = config.getOrThrow<AppConfiguration>("app");
  }
}
