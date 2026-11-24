import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MatchConnectionShare, MatchMessage, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { utcAge } from "../profile/profile.validation";
import { MatchingService } from "./matching.service";
import { connectionMessageInput, connectionMessagesQuery, connectionSharingInput } from "./match-connection.validation";

type Tx = Prisma.TransactionClient;
const photoData = (photo: Uint8Array | null | undefined) => photo ? "data:image/webp;base64," + Buffer.from(photo).toString("base64") : null;
const sharing = (row: MatchConnectionShare | null) => ({
  revision: row?.revision ?? 0,
  profileShared: row?.profileShared ?? false,
  contactShared: row?.contactShared ?? false,
  chatEnabled: row?.chatEnabled ?? false,
  photo: photoData(row?.photo),
});
const messageView = (row: MatchMessage, actor: string) => ({
  id: row.id, clientMessageId: row.senderId === actor ? row.clientMessageId : null,
  sender: row.senderId === actor ? "me" : "peer", text: row.text!, createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class MatchConnectionService {
  constructor(private readonly matching: MatchingService, private readonly journal?: RecoveryJournalService) {}

  get(auth: AuthContext, handle: string, query: object) {
    return this.matching.withConnection(auth, handle, query, async (tx, connection, now) => {
      const own = await tx.matchConnectionShare.findUnique({ where: { pairId_userId: { pairId: connection.pairId, userId: auth.user.id } } });
      const peer = await tx.matchConnectionShare.findUnique({ where: { pairId_userId: { pairId: connection.pairId, userId: connection.peerId } } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: connection.peerId }, select: { displayName: true, email: true, profile: true } });
      return {
        sharing: sharing(own),
        peer: {
          profile: peer?.profileShared && user.profile ? {
            displayName: user.displayName,
            age: utcAge(user.profile.birthDate!, now),
            occupation: user.profile.occupation, city: user.profile.city, bio: user.profile.bio,
            relationshipGoal: user.profile.relationshipGoal,
            interests: (user.profile.interests ?? []) as string[], values: (user.profile.values ?? []) as string[],
            photo: photoData(peer.photo),
          } : null,
          contactEmail: peer?.contactShared ? user.email : null,
          chatEnabled: peer?.chatEnabled ?? false,
        },
        chatAvailable: !!own?.chatEnabled && !!peer?.chatEnabled,
      };
    });
  }

  async share(auth: AuthContext, handle: string, query: object, body: unknown) {
    const input = await connectionSharingInput(body);
    return this.matching.withConnection(auth, handle, query, async (tx, connection) => {
      const key = { pairId_userId: { pairId: connection.pairId, userId: auth.user.id } };
      const current = await tx.matchConnectionShare.findUnique({ where: key });
      if ((current?.revision ?? 0) !== input.expectedRevision) throw new ConflictException({
        code: "CONNECTION_REVISION_CONFLICT", message: "Sharing changed. Refresh before saving again.",
      });
      if (current && ((current.profileShared && !input.profileShared) || (current.contactShared && !input.contactShared) ||
          (current.chatEnabled && !input.chatEnabled) || (current.photo && input.photo !== undefined))) {
        await this.journal?.record(tx, [auth.user.id], "CLAIM_RESTRICTION");
      }
      const data = {
        profileShared: input.profileShared, contactShared: input.contactShared, chatEnabled: input.chatEnabled,
        ...(input.photo !== undefined && { photo: input.photo }),
      };
      const row = current
        ? await tx.matchConnectionShare.update({ where: key, data: { ...data, revision: { increment: 1 } } })
        : await tx.matchConnectionShare.create({ data: { pairId: connection.pairId, userId: auth.user.id, ...data } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "MATCH_CONNECTION_SHARING_CHANGED",
        subjectType: "MatchPair", subjectId: connection.pairId } });
      return { sharing: sharing(row) };
    });
  }

  private async requireChat(tx: Tx, pairId: string) {
    if (await tx.matchConnectionShare.count({ where: { pairId, chatEnabled: true } }) !== 2) {
      throw new ForbiddenException({ code: "CHAT_NOT_ENABLED", message: "Both members must enable chat for this connection." });
    }
  }

  messages(auth: AuthContext, handle: string, query: unknown) {
    const before = connectionMessagesQuery(query);
    return this.matching.withConnection(auth, handle, {}, async (tx, connection) => {
      await this.requireChat(tx, connection.pairId);
      const cursor = before ? await tx.matchMessage.findFirst({ where: { id: before, pairId: connection.pairId, text: { not: null } } }) : null;
      if (before && !cursor) throw new NotFoundException({ code: "MATCH_UNAVAILABLE", message: "Refresh this connection." });
      const rows = await tx.matchMessage.findMany({ where: {
        pairId: connection.pairId, text: { not: null },
        ...(cursor && { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }),
      }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
      const page = rows.slice(0, 50);
      return { messages: page.reverse().map(row => messageView(row, auth.user.id)),
        nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }

  send(auth: AuthContext, handle: string, query: object, body: unknown) {
    const input = connectionMessageInput(body);
    return this.matching.withConnection(auth, handle, query, async (tx, connection) => {
      await this.requireChat(tx, connection.pairId);
      const key = { pairId_senderId_clientMessageId: { pairId: connection.pairId, senderId: auth.user.id, clientMessageId: input.clientMessageId } };
      const previous = await tx.matchMessage.findUnique({ where: key });
      if (previous) {
        if (previous.text !== input.text) throw new ConflictException({ code: "MESSAGE_ID_REUSED", message: "The message reference was already used for different content." });
        return { message: messageView(previous, auth.user.id) };
      }
      const row = await tx.matchMessage.create({ data: { pairId: connection.pairId, senderId: auth.user.id, ...input } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "MATCH_MESSAGE_SENT", subjectType: "MatchMessage", subjectId: row.id } });
      return { message: messageView(row, auth.user.id) };
    });
  }
}
