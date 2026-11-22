import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MatchChoice, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { ConsentAccessService } from "../consent/consent-access.service";
import { PrismaService } from "../database/prisma.service";
import { readMatchingClaimsInTransaction } from "../expert-admin/review-matching-claims";
import { BlockAccessService } from "../safety/block-access.service";
import { SafetyAccessService } from "../safety/safety-access.service";
import { MatchingHandles, type ConsentStamp } from "./matching-handles";
import { compareRank, matchingMember, memberSelect, reciprocalEligibility, reciprocalRanks } from "./matching-policy";

type Tx = Prisma.TransactionClient;
const purpose = "PROFILE_MATCHING" as const;
const discoverySize = 16;
const discoveryScanLimit = 48;
const historySize = 20;
const handleLifetime = 15 * 60_000;
// Reads following a participant lock wait must see the writer's committed restrictions.
const matchingIsolation = Prisma.TransactionIsolationLevel.ReadCommitted;

const unavailable = () => new NotFoundException({
  code: "MATCH_UNAVAILABLE", message: "This recommendation is unavailable. Refresh your matches.",
});
const badInput = () => new BadRequestException({ code: "INVALID_REQUEST", message: "Check the matching request." });

function pageCursor(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badInput();
  const params = input as Record<string, unknown>;
  if (Object.keys(params).some(key => key !== "after") ||
    ("after" in params && (typeof params.after !== "string" || !params.after))) throw badInput();
  return params.after as string | undefined;
}

function decisionInput(input: unknown): MatchChoice {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== 1 || !Object.hasOwn(input, "choice")) throw badInput();
  const { choice } = input as { choice: unknown };
  if (choice !== MatchChoice.ACCEPT && choice !== MatchChoice.DECLINE) throw badInput();
  return choice;
}

function canonicalOrder(a: string, b: string) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0;
}

function sortIds(a: string, b: string) {
  return canonicalOrder(a, b) ? [a, b] as const : [b, a] as const;
}

function referenceStamp(stamp: ConsentStamp, blocks: number) {
  return { subjectId: stamp.subjectId, version: stamp.version.toString(), blocks };
}

const pairSelect = {
  id: true, userLowId: true, userHighId: true, invalidatedAt: true,
  lowConsentSubjectId: true, lowConsentVersion: true, highConsentSubjectId: true, highConsentVersion: true,
  decisions: { select: { actorUserId: true, choice: true } },
} satisfies Prisma.MatchPairSelect;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SafetyAccessService,
    private readonly consent: ConsentAccessService,
    private readonly blocks: BlockAccessService,
    private readonly handles: MatchingHandles,
  ) {}

  async recommendations(auth: AuthContext, query: unknown) {
    const after = this.readCursor(auth, "recommendations", pageCursor(query))?.id;
    const actor = auth.user.id;
    return this.store(async () => {
      // The extra ID signals another window. Only the first 48 enter eligibility checks.
      const shortlist = await this.prisma.user.findMany({
        where: {
          id: { not: actor, ...(after && { gt: after }) },
          role: "MEMBER", status: "ACTIVE", emailVerifiedAt: { not: null }, declaredAdult: true,
          profile: { is: { visibilityEnabled: true, birthDate: { not: null } } },
          consents: { some: { purpose, granted: true, policyEvidenceId: { not: null } } },
          blocksMade: { none: { blockedId: actor } }, blocksReceived: { none: { blockerId: actor } },
        },
        orderBy: { id: "asc" }, select: { id: true }, take: discoveryScanLimit + 1,
      });
      const peers = shortlist.slice(0, discoveryScanLimit).map(row => row.id);
      return this.access.run(auth, "MEMBER", peers, async (tx, now) => {
        const members = await this.members(tx, [actor, ...peers], now);
        const viewer = members.get(actor);
        const viewerConsent = viewer && await this.currentConsent(tx, actor);
        if (!viewer || !viewerConsent) return { available: false, recommendations: [], nextCursor: null };

        const blocked = await this.blockedPeers(tx, actor, peers);
        const existing = await this.pairs(tx, actor, peers);
        const blockCounts = await this.blockCounts(tx, [actor, ...peers]);
        const ranked = [];
        let nextAfter = shortlist.length > discoveryScanLimit ? peers[peers.length - 1] : undefined;
        let lastEligibleId = "";
        for (const peerId of peers) {
          const peer = members.get(peerId);
          if (!peer || blocked.has(peerId) || !reciprocalEligibility(viewer, peer)) continue;
          const peerConsent = await this.currentConsent(tx, peerId);
          if (!peerConsent) continue;

          const pair = existing.get(peerId);
          if (pair && (pair.decisions.some(decision => decision.actorUserId === actor) ||
            !await this.currentPair(tx, pair))) continue;

          if (ranked.length === discoverySize) {
            // Resume before the first eligible candidate that did not fit on this page.
            nextAfter = lastEligibleId;
            break;
          }
          lastEligibleId = peerId;
          const key = this.handles.keyFor(auth, "recommendation", peerId);
          const ranks = reciprocalRanks(viewer, peer);
          const claims = await readMatchingClaimsInTransaction(tx, this.consent, actor, peerId);
          ranked.push({
            rank: ranks.outgoing, key,
            recommendation: {
              key,
              pairId: this.handles.issue(auth, "decision", {
                id: peerId, expires: now.getTime() + handleLifetime, authorization: [
                  referenceStamp(viewerConsent, blockCounts.get(actor) ?? 0),
                  referenceStamp(peerConsent, blockCounts.get(peerId) ?? 0),
                ],
              }),
              reasons: [
                "Meets both members’ matching settings.",
                ...claims.map(claim => claim.statement),
              ],
            },
          });
        }

        return {
          available: true,
          recommendations: ranked.sort(compareRank).map(row => row.recommendation),
          nextCursor: nextAfter ? this.handles.issue(auth, "recommendations", {
            id: nextAfter, expires: now.getTime() + handleLifetime,
          }) : null,
        };
      }, matchingIsolation);
    });
  }

  async decide(auth: AuthContext, pairId: string, query: object, input: unknown) {
    if (Object.keys(query).length) throw badInput();
    const choice = decisionInput(input);
    const reference = this.handles.read(auth, "decision", pairId);
    const actor = auth.user.id;
    if (!reference?.authorization || reference.id === actor) throw unavailable();
    const [viewerStamp, peerStamp] = reference.authorization;
    const peer = reference.id;
    return this.store(() => this.access.run(auth, "MEMBER", [peer], async (tx, now) => {
      if (reference.expires <= now.getTime()) throw unavailable();
      const members = await this.members(tx, [actor, peer], now);
      const viewer = members.get(actor);
      const candidate = members.get(peer);
      if (!viewer || !candidate || !reciprocalEligibility(viewer, candidate)) throw unavailable();
      try {
        await this.blocks.assertClear(tx, actor, peer);
      } catch (error) {
        if (error instanceof ForbiddenException) throw unavailable();
        throw error;
      }
      const viewerConsent = await this.currentConsent(tx, actor);
      const peerConsent = await this.currentConsent(tx, peer);
      if (!viewerConsent || !peerConsent) throw unavailable();
      const blockCounts = await this.blockCounts(tx, [actor, peer]);
      if ((blockCounts.get(actor) ?? 0) !== viewerStamp.blocks || (blockCounts.get(peer) ?? 0) !== peerStamp.blocks)
        throw unavailable();
      if (!await this.currentGenerations(tx, actor, viewerStamp.subjectId, BigInt(viewerStamp.version),
        peer, peerStamp.subjectId, BigInt(peerStamp.version))) throw unavailable();

      const [userLowId, userHighId] = sortIds(actor, peer);
      let pair = (await this.pairs(tx, actor, [peer])).get(peer);
      if (pair && !await this.currentPair(tx, pair)) throw unavailable();
      if (!pair) {
        const [low, high] = actor === userLowId ? [viewerConsent, peerConsent] : [peerConsent, viewerConsent];
        pair = await tx.matchPair.create({
          data: {
            userLowId, userHighId,
            lowConsentSubjectId: low.subjectId, lowConsentVersion: low.version,
            highConsentSubjectId: high.subjectId, highConsentVersion: high.version,
          },
          select: pairSelect,
        });
      }

      const previous = pair.decisions.find(decision => decision.actorUserId === actor);
      if (previous && previous.choice !== choice) throw new ConflictException({
        code: "MATCH_DECISION_CONFLICT", message: "A different choice has already been recorded. Refresh your matches.",
      });
      if (!previous) {
        const decision = await tx.matchDecision.create({ data: { pairId: pair.id, actorUserId: actor, choice } });
        await tx.auditLog.create({ data: {
          actorId: viewerConsent.subjectId, action: "MATCH_DECISION_RECORDED", subjectType: "MatchDecision", subjectId: decision.id,
        } });
      }

      return { choice, mutual: choice === "ACCEPT" && this.peerAccepted(pair.decisions, peer) };
    }, matchingIsolation));
  }

  async history(auth: AuthContext, query: unknown) {
    const after = this.readCursor(auth, "history", pageCursor(query));
    if (after && !after.createdAt) throw badInput();
    const actor = auth.user.id;
    const orderBy = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.MatchDecisionOrderByWithRelationInput[];
    return this.store(async () => {
      const shortlist = await this.prisma.matchDecision.findMany({
        where: {
          actorUserId: actor,
          pair: { OR: [{ userLowId: actor, userHighId: { not: actor } }, { userHighId: actor, userLowId: { not: actor } }] },
          ...(after?.createdAt && { OR: [
            { createdAt: { lt: new Date(after.createdAt) } },
            { createdAt: new Date(after.createdAt), id: { lt: after.id } },
          ] }),
        },
        orderBy, take: historySize + 1,
        select: { id: true, createdAt: true, pair: { select: { userLowId: true, userHighId: true } } },
      });
      const ids = shortlist.slice(0, historySize).map(row => row.id);
      const peers = shortlist.slice(0, historySize).flatMap(({ pair }) =>
        pair.userLowId === actor ? [pair.userHighId] : pair.userHighId === actor ? [pair.userLowId] : []);
      return this.access.run(auth, "MEMBER", peers, async (tx, now) => {
        const decisions = await tx.matchDecision.findMany({
          where: { actorUserId: actor, id: { in: ids } },
          orderBy,
          select: { id: true, choice: true, createdAt: true, pair: { select: pairSelect } },
        });
        const members = await this.members(tx, [actor, ...peers], now);
        const viewer = members.get(actor);
        const viewerConsent = viewer && await this.currentConsent(tx, actor);
        const blocked = await this.blockedPeers(tx, actor, peers);
        const history = [];
        for (const { id, choice, createdAt, pair } of decisions) {
          const peerId = pair.userLowId === actor ? pair.userHighId : pair.userHighId === actor ? pair.userLowId : null;
          if (!peerId || peerId === actor) continue;
          const peer = members.get(peerId);
          const available = !!viewerConsent && !!viewer && !!peer && !blocked.has(peerId) &&
            reciprocalEligibility(viewer, peer) && !!await this.currentConsent(tx, peerId) &&
            await this.currentPair(tx, pair);
          history.push({
            id: this.handles.keyFor(auth, "history", id), choice, createdAt: createdAt.toISOString(), available,
            mutual: available && choice === "ACCEPT" && this.peerAccepted(pair.decisions, peerId),
          });
        }
        return {
          decisions: history,
          nextCursor: shortlist.length > historySize ? this.handles.issue(auth, "history", {
            id: ids[ids.length - 1], expires: now.getTime() + handleLifetime,
            createdAt: shortlist[historySize - 1].createdAt.toISOString(),
          }) : null,
        };
      }, matchingIsolation);
    });
  }

  private peerAccepted(decisions: { actorUserId: string; choice: MatchChoice }[], peer: string) {
    return decisions.some(decision => decision.actorUserId === peer && decision.choice === "ACCEPT");
  }

  private readCursor(auth: AuthContext, purpose: "recommendations" | "history", after?: string) {
    this.handles.requireKey();
    if (!after) return undefined;
    const decoded = this.handles.read(auth, purpose, after);
    if (!decoded || decoded.expires <= Date.now()) throw badInput();
    return decoded;
  }

  private async members(tx: Tx, ids: string[], now: Date) {
    const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: memberSelect });
    return new Map(rows.map(row => [row.id, matchingMember(row, now)]));
  }

  private async blockedPeers(tx: Tx, actor: string, peers: string[]) {
    const rows = await tx.block.findMany({
      where: { OR: [
        { blockerId: actor, blockedId: { in: peers } },
        { blockedId: actor, blockerId: { in: peers } },
      ] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(rows.map(row => row.blockerId === actor ? row.blockedId : row.blockerId));
  }

  private async blockCounts(tx: Tx, ids: string[]) {
    // Safety appends an immutable creation audit under the same participant locks.
    // Counting outgoing blocks for each participant detects a block even after its row is removed.
    const rows = await tx.auditLog.groupBy({
      by: ["actorId"], where: { actorId: { in: ids }, action: "SAFETY_BLOCK_CREATED", subjectType: "Block" },
      _count: { _all: true },
    });
    return new Map(rows.map(row => [row.actorId, row._count._all]));
  }

  private async pairs(tx: Tx, actor: string, peers: string[]) {
    const rows = await tx.matchPair.findMany({
      where: { OR: [
        { userLowId: actor, userHighId: { in: peers } },
        { userLowId: { in: peers }, userHighId: actor },
      ] },
      select: pairSelect,
    });
    const byPeer = new Map<string, (typeof rows)[number]>();
    for (const pair of rows) {
      const peer = pair.userLowId === actor ? pair.userHighId : pair.userLowId;
      // A legacy reverse row fences off both forms, even if a canonical row exists.
      if (!byPeer.has(peer) || !canonicalOrder(pair.userLowId, pair.userHighId)) byPeer.set(peer, pair);
    }
    return byPeer;
  }

  private async currentConsent(tx: Tx, actor: string) {
    try {
      return await this.consent.requireInTransaction(tx, actor, [purpose]);
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
  }

  private async currentPair(tx: Tx, pair: Prisma.MatchPairGetPayload<{ select: typeof pairSelect }>) {
    if (pair.invalidatedAt || !canonicalOrder(pair.userLowId, pair.userHighId) || !pair.lowConsentSubjectId ||
      !pair.highConsentSubjectId || pair.lowConsentVersion === null || pair.highConsentVersion === null) return false;
    return this.currentGenerations(tx, pair.userLowId, pair.lowConsentSubjectId, pair.lowConsentVersion,
      pair.userHighId, pair.highConsentSubjectId, pair.highConsentVersion);
  }

  private async currentGenerations(tx: Tx, a: string, aSubject: string, aVersion: bigint,
    b: string, bSubject: string, bVersion: bigint) {
    try {
      await this.consent.requireGenerationInTransaction(tx, a, aSubject, aVersion, purpose);
      await this.consent.requireGenerationInTransaction(tx, b, bSubject, bVersion, purpose);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async store<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() !== 503) throw error;
      throw new ServiceUnavailableException({ code: "MATCHING_UNAVAILABLE", message: "Matching is temporarily unavailable. Refresh before retrying." });
    }
  }
}
