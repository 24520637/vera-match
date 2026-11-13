import { ExecutionContext, ServiceUnavailableException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { EnvironmentService } from '../config/environment.module';
import { parseEnvironment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedRequest } from './auth-context';
import { RolesGuard } from './roles.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionService } from './session.service';
import { hashSessionToken, readSessionToken } from './session-token';

const token = randomBytes(32).toString('base64url');
const validSession = () => ({ id: 'session-synthetic', expiresAt: new Date(Date.now() + 60000), revokedAt: null, user: { id: 'user-synthetic', email: 'member@example.invalid', displayName: null, role: UserRole.MEMBER, status: AccountStatus.ACTIVE as AccountStatus, emailVerifiedAt: new Date() } });
function contextFor(request: object) { return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext; }
const environment = { values: parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5433/vera_test', MINIO_ROOT_USER: 'synthetic', MINIO_ROOT_PASSWORD: 'synthetic-test-only' }) } as EnvironmentService;

describe('session token parsing', () => {
  it('accepts the configured cookie name among unrelated cookies', () => expect(readSessionToken(`other=a; vera_session=${token}; preference=x`, 'vera_session')).toBe(token));
  it.each([undefined, '', 'vera_session=', 'vera_session=invalid', `vera_session=${token}; vera_session=${token}`, `vera_session="${token}"`, `vera_session=${token}=`, 'x'.repeat(8193)])('rejects malformed or ambiguous cookies', header => expect(readSessionToken(header, 'vera_session')).toBeNull());
});

describe('database-backed session authentication', () => {
  const findUnique = jest.fn();
  const sessions = new SessionService({ session: { findUnique } } as unknown as PrismaService);
  const guard = new SessionAuthGuard(sessions, environment);
  beforeEach(() => findUnique.mockReset().mockResolvedValue(validSession()));
  it('checks the token hash and returns only a safe server projection', async () => {
    const request = { headers: { cookie: `vera_session=${token}` }, body: { userId: 'attacker', role: 'ADMIN' } } as unknown as AuthenticatedRequest;
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashSessionToken(token) });
    expect(request.auth).toEqual({ sessionId: 'session-synthetic', user: { id: 'user-synthetic', email: 'member@example.invalid', displayName: null, role: 'MEMBER' } });
    expect(JSON.stringify(request.auth)).not.toContain(token);
    expect(findUnique.mock.calls[0][0].select.user.select.passwordHash).toBeUndefined();
  });
  it.each([undefined, 'vera_session=invalid'])('denies missing/invalid cookies before querying', async cookie => {
    await expect(guard.canActivate(contextFor({ headers: { cookie } }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'expired', 'boundary', 'revoked', 'pending', 'suspended', 'deleted', 'unverified'])('denies %s sessions with 401 and clears stale context', async state => {
    const session = validSession();
    if (state === 'unknown') findUnique.mockResolvedValue(null);
    else {
      if (state === 'expired') session.expiresAt = new Date(Date.now() - 1000);
      if (state === 'boundary') session.expiresAt = new Date(Date.now());
      if (state === 'revoked') Object.assign(session, { revokedAt: new Date() });
      if (state === 'pending') session.user.status = AccountStatus.PENDING_EMAIL;
      if (state === 'suspended') session.user.status = AccountStatus.SUSPENDED;
      if (state === 'deleted') session.user.status = AccountStatus.DELETED;
      if (state === 'unverified') Object.assign(session.user, { emailVerifiedAt: null });
      findUnique.mockResolvedValue(session);
    }
    const request = { headers: { cookie: `vera_session=${token}` }, auth: { user: { role: 'ADMIN' } } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.auth).toBeUndefined();
  });
  it('returns 503 rather than logging out the user on a DB outage', async () => {
    findUnique.mockRejectedValue(new Error('secret-database-connection'));
    await expect(guard.canActivate(contextFor({ headers: { cookie: `vera_session=${token}` } }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('uses server role for downstream 403 and fails closed without role metadata', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([UserRole.ADMIN]) };
    const roles = new RolesGuard(reflector as unknown as Reflector);
    const request = { headers: { cookie: `vera_session=${token}` } };
    await guard.canActivate(contextFor(request));
    expect(() => roles.canActivate(contextFor(request))).toThrow(ForbiddenException);
    reflector.getAllAndOverride.mockReturnValue([UserRole.MEMBER]);
    expect(roles.canActivate(contextFor(request))).toBe(true);
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() => roles.canActivate(contextFor(request))).toThrow(ForbiddenException);
    expect(() => roles.canActivate(contextFor({ headers: {} }))).toThrow(UnauthorizedException);
  });
});
