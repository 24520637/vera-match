import { randomBytes, randomUUID } from "node:crypto";
import { AccountStatus, Prisma, PrismaClient } from "@prisma/client";
import { hashSessionToken } from "../src/auth/session-token";

/** Every inserted fixture is inside a transaction that MUST roll back, even on success. */
export async function withAuthFixtures<T>(
  client: PrismaClient,
  run: (fixtures: {
    tx: Prisma.TransactionClient;
    userId: string;
    sessionId: string;
    token: string;
    tokenHash: string;
  }) => Promise<T>,
): Promise<T> {
  const userId = `t01-${randomUUID()}`;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const rollback = new Error("T01_FIXTURE_ROLLBACK");
  let result: T | undefined;
  try {
    await client.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            id: userId,
            email: `${userId}@example.invalid`,
            passwordHash: "synthetic-fixture-not-for-login",
            declaredAdult: true,
          },
        });
        if (
          user.status !== AccountStatus.PENDING_EMAIL ||
          user.emailVerifiedAt !== null
        )
          throw new Error("Pending-email schema default is not enforced");
        const session = await tx.session.create({
          data: { userId, tokenHash, expiresAt: new Date(Date.now() + 60000) },
        });
        result = await run({
          tx,
          userId,
          sessionId: session.id,
          token,
          tokenHash,
        });
        throw rollback;
      },
      { maxWait: 5000, timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    const leftovers = await client.user.count({ where: { id: userId } });
    if (leftovers !== 0) throw new Error("Synthetic fixture cleanup failed");
  }
  return result as T;
}
