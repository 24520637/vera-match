import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { EnvironmentService } from '../config/environment.service';

@Injectable()
export class EmailService implements OnApplicationShutdown {
  private readonly transport: Transporter;
  constructor(private readonly environment: EnvironmentService) {
    const smtp = environment.values.smtp;
    this.transport = createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTls, auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  }
  async sendVerification(email: string, link: string) {
    try {
      const result = await this.transport.sendMail({ from: this.environment.values.smtp.from, to: email, subject: 'Activate your VERA Match account', text: `Confirm your email address to activate your VERA Match account.\n\n${link}\n\nThis link expires in ${Math.floor(this.environment.values.verification.ttlSeconds / 60)} minutes and can be used once. If you did not register, ignore this message.` });
      if (!result.accepted?.length) throw new Error('Not accepted');
    } catch { throw new ServiceUnavailableException({ code: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'Activation email could not be sent. Try resending it later.' }); }
  }
  onApplicationShutdown() { this.transport.close(); }
}
