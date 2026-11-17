import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { catchError, from } from "rxjs";
import { AuthenticatedRequest } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { consentStorage } from "../consent/consent.service";

@Injectable()
export class VideoAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error) =>
        from(
          (async () => {
            const actorId = context
              .switchToHttp()
              .getRequest<AuthenticatedRequest>().auth?.user.id;
            if (
              actorId &&
              error instanceof HttpException &&
              [403, 404, 409].includes(error.getStatus())
            ) {
              // Never record attacker-selected IDs, URL queries, media, claims or request bodies.
              await consentStorage(() =>
                this.prisma.auditLog.create({
                  data: {
                    actorId,
                    action: "VIDEO_ACCESS_DENIED",
                    subjectType: "Video",
                  },
                }),
              );
            }
            throw error;
          })(),
        ),
      ),
    );
  }
}
