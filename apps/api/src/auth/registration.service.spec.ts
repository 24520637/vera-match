import { RegistrationService } from './registration.service';
import { PasswordService } from './password.service';
import { PrismaService } from '../database/prisma.service';

describe('pending registration persistence', () => {
  const hash = jest.fn().mockResolvedValue('$argon2id$synthetic-hash');
  const findFirst = jest.fn(); const create = jest.fn();
  const service = new RegistrationService({ user: { findFirst, create } } as unknown as PrismaService, { hash } as unknown as PasswordService);
  beforeEach(() => { findFirst.mockReset().mockResolvedValue(null); create.mockReset().mockResolvedValue({ id: 'synthetic-user' }); hash.mockClear(); });
  it('stores only a password hash and forces a pending unverified member', async () => {
    await expect(service.register({ email: 'member@example.invalid', password: 'synthetic-password', declaredAdult: true })).resolves.toEqual({ created: true, userId: 'synthetic-user' });
    expect(create.mock.calls[0][0].data).toMatchObject({ passwordHash: '$argon2id$synthetic-hash', status: 'PENDING_EMAIL', emailVerifiedAt: null, declaredAdult: true, role: 'MEMBER' });
    expect(JSON.stringify(create.mock.calls)).not.toContain('synthetic-password');
  });
  it('does not overwrite a duplicate account or disclose its identity', async () => {
    findFirst.mockResolvedValue({ id: 'existing-synthetic' });
    await expect(service.register({ email: 'member@example.invalid', password: 'synthetic-password', declaredAdult: true })).resolves.toEqual({ created: false });
    expect(create).not.toHaveBeenCalled(); expect(hash).toHaveBeenCalledTimes(1);
  });
});
