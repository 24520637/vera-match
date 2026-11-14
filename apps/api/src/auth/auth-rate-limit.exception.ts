import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";

export class AuthRateLimitException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again later.",
        retryAfterSeconds,
      },
      429,
    );
  }
}

@Catch(AuthRateLimitException)
export class AuthRateLimitFilter implements ExceptionFilter {
  catch(error: AuthRateLimitException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .setHeader("Retry-After", String(error.retryAfterSeconds))
      .status(429)
      .json(error.getResponse());
  }
}
