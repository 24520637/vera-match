import { BadRequestException, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { EmailService } from "../auth/email.service";
import { EnvironmentService } from "../config/environment.service";
import { PrismaService } from "../database/prisma.service";
import { AccountClosureService } from "./account-closure.service";
import { digest, tokenInput } from "./closure.validation";

@Injectable()
export class ClosureStatusService implements OnModuleDestroy {
  private readonly logger = new Logger(ClosureStatusService.name);
  private readonly pending: { email?: string; userId?: string }[] = [];
  private worker?: Promise<void>;
  private stopping = false;
  constructor(private readonly db: PrismaService, private readonly email: EmailService,
    private readonly environment: EnvironmentService, private readonly closure: AccountClosureService) {}
  request(input: unknown) {
    this.closure.available();
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const email = Object.keys(value).length === 1 && typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) this.enqueue({ email });
    return { message: "If this address is eligible, a restricted status link will be emailed. No account access is restored." };
  }
  afterClosure(userId: string) {
    // Acceptance already committed. An unavailable delivery queue must never turn
    // the accepted closure into a misleading failed transaction or reopen access.
    try { this.enqueue({ userId }); } catch { this.logger.warn("CLOSURE_STATUS_DELIVERY_PENDING"); }
  }
  private enqueue(item: { email?: string; userId?: string }) {
    if (this.stopping || this.pending.length >= 32) throw new ServiceUnavailableException({
      code: "STATUS_DELIVERY_BUSY", message: "Please request a status email later." });
    this.pending.push(item);
    if (!this.worker) this.worker = new Promise<void>(r => setImmediate(r)).then(() => this.drain()).finally(() => { this.worker = undefined; });
  }
  private async drain() {
    while (this.pending.length) {
      try { await this.issue(this.pending.shift()!); }
      catch { this.logger.warn("CLOSURE_STATUS_DELIVERY_UNCONFIRMED"); }
    }
  }
  private async issue(item: { email?: string; userId?: string }) {
    const user = await this.db.user.findUnique({ where: item.userId ? { id: item.userId } : { email: item.email! }, select: { id: true } });
    if (!user) return;
    const token = randomBytes(32).toString("base64url");
    const issued = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
      const account = await tx.user.findUnique({ where: { id: user.id } });
      const closure = await tx.accountClosure.findUnique({ where: { userId: user.id } });
      const now = new Date();
      if (!account || account.status !== "CLOSED" || !account.emailVerifiedAt || !closure ||
          now.getTime() >= closure.createdAt.getTime() + 30 * 86400000) return;
      const recent = await tx.closureStatusToken.findMany({ where: { closureId: closure.id,
        createdAt: { gt: new Date(now.getTime() - 900000) } }, orderBy: { createdAt: "desc" } });
      if (recent.length >= 3 || recent[0] && now.getTime() - recent[0].createdAt.getTime() < 60000 ||
          await tx.closureStatusToken.count({ where: { closureId: closure.id, consumedAt: null, expiresAt: { gt: now } } }) >= 3) return;
      await tx.closureStatusToken.create({ data: { closureId: closure.id, tokenHash: digest(token), createdAt: now,
        expiresAt: new Date(Math.min(now.getTime() + 900000, closure.createdAt.getTime() + 30 * 86400000)) } });
      return account.email;
    });
    if (!issued) return;
    const link = new URL("/closure-status", this.environment.values.appBaseUrl);
    link.hash = new URLSearchParams({ token }).toString();
    // No post-SMTP invalidation/finalization. Acceptance may be ambiguous; a
    // durably created mailed token remains bounded and usable, never reactivated.
    await this.email.sendClosureStatus(issued, link.toString());
  }
  async consume(input: unknown) {
    this.closure.available();
    const invalid = () => new BadRequestException({ code: "INVALID_STATUS_LINK", message: "This status link is invalid, expired or already used. Request another email." });
    const token = tokenInput(input);
    if (!token) throw invalid();
    try {
      const row = await this.db.closureStatusToken.findUnique({ where: { tokenHash: digest(token) }, include: { closure: true } });
      if (!row) throw invalid();
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.closure.userId} FOR UPDATE`;
        const now = new Date();
        const current = await tx.closureStatusToken.findUnique({ where: { id: row.id } });
        const closure = await tx.accountClosure.findUniqueOrThrow({ where: { id: row.closureId } });
        const user = await tx.user.findUnique({ where: { id: closure.userId } });
        if (!current || current.consumedAt || current.expiresAt <= now || user?.status !== "CLOSED") throw invalid();
        await tx.closureStatusToken.updateMany({ where: { closureId: row.closureId, consumedAt: null }, data: { consumedAt: now } });
        return { state: closure.state, revision: closure.revision, cleanupPending: closure.state === "RESTRICTED", retentionPending: true };
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({ code: "STATUS_STORE_UNAVAILABLE", message: "Status could not be confirmed. Request another email if needed." });
    }
  }
  async onModuleDestroy() { this.stopping = true; await this.worker; }
}
