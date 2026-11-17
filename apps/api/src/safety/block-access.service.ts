import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
export const pairBlockWhere = (
  a: string,
  b: string,
): Prisma.BlockWhereInput => ({
  OR: [
    { blockerId: a, blockedId: b },
    { blockerId: b, blockedId: a },
  ],
});
/** Call inside the consumer's transaction after sorted participant User locks.
 * Does not invent a matching/review endpoint or a cached authorization grant. */
@Injectable()
export class BlockAccessService {
  async assertClear(tx: Prisma.TransactionClient, a: string, b: string) {
    if (
      await tx.block.findFirst({
        where: pairBlockWhere(a, b),
        select: { id: true },
      })
    )
      throw new ForbiddenException({
        code: "INTERACTION_UNAVAILABLE",
        message: "This interaction is unavailable.",
      });
  }
  async excludedPeers(
    tx: Prisma.TransactionClient,
    ownerId: string,
  ): Promise<Set<string>> {
    const rows = await tx.block.findMany({
      where: { OR: [{ blockerId: ownerId }, { blockedId: ownerId }] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(
      rows.map((row) =>
        row.blockerId === ownerId ? row.blockedId : row.blockerId,
      ),
    );
  }
}
