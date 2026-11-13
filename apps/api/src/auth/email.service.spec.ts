import { EmailService } from './email.service';
import { EnvironmentService } from '../config/environment.service';
import { parseEnvironment } from '../config/environment';
const sendMail = jest.fn(); const close = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail, close }) }));

describe('SMTP failure behavior', () => {
  it('sanitizes errors and does not pretend a failed delivery succeeded', async () => {
    const values = parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:synthetic@localhost:5433/test', MINIO_ROOT_USER: 'synthetic', MINIO_ROOT_PASSWORD: 'synthetic-only' });
    const service = new EmailService({ values } as EnvironmentService);
    sendMail.mockRejectedValue(new Error('secret-smtp-credentials'));
    await expect(service.sendVerification('synthetic@example.invalid', 'http://localhost/verify-email#synthetic')).rejects.toMatchObject({ status: 503, response: { code: 'EMAIL_DELIVERY_UNAVAILABLE' } });
    service.onApplicationShutdown(); expect(close).toHaveBeenCalled();
  });
});
