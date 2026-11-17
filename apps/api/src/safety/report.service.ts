import { Injectable } from "@nestjs/common";
import { AuthContext } from "../auth/auth-context";
import { SafetyAccessService } from "./safety-access.service";
import { invalid, reportInput } from "./safety.validation";
@Injectable()
export class ReportService {
  constructor(private readonly access: SafetyAccessService) {}
  submit(auth: AuthContext, value: unknown) {
    const input = reportInput(value);
    if (input.targetUserId === auth.user.id)
      invalid("targetUserId", "Choose another account reference.");
    return this.access.run(auth, "MEMBER", [input.targetUserId], async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: { status: true, emailVerifiedAt: true },
      });
      if (target?.status === "ACTIVE" && target.emailVerifiedAt) {
        const report = await tx.report.create({
          data: {
            reporterId: auth.user.id,
            targetUserId: input.targetUserId,
            reasonCode: input.reason,
            reason: input.details,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: auth.user.id,
            action: "SAFETY_REPORT_SUBMITTED",
            subjectType: "Report",
            subjectId: report.id,
          },
        });
      }
      // Identical acknowledgement for an eligible, absent or unavailable target.
      // It acknowledges the request, not a moderation decision or report status.
      return { message: "Your report request was received." };
    });
  }
}
