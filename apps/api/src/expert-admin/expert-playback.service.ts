import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth-context";
import { PrivateStorageService } from "../video/private-storage.service";
import { AssignmentAccessService } from "./assignment-access.service";

@Injectable()
export class ExpertPlaybackService {
  constructor(private readonly access: AssignmentAccessService, private readonly storage: PrivateStorageService) {}
  issue(auth: AuthContext, assignmentId: string) {
    return this.access.withAuthorizedAssignment(auth, assignmentId, async (tx, access) => {
      if (access.video.bucket !== this.storage.bucket)
        throw new ServiceUnavailableException({ code: "EXPERT_ACCESS_UNAVAILABLE", message: "Private playback is unavailable." });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "EXPERT_PLAYBACK_ISSUED", subjectType: "ExpertAssignment", subjectId: assignmentId } });
      const grant = await this.storage.playbackGrant(access.video.objectKey, access.video.mimeType, access.validateTime);
      const clock = await access.validateTime();
      if (new Date(grant.expiresAt).getTime() - clock.now.getTime() < 1000)
        throw new ServiceUnavailableException({ code: "EXPERT_ACCESS_UNAVAILABLE", message: "Insufficient safe playback time remains." });
      return { id: access.videoId, ...grant };
    });
  }
}
