import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthRequestGuard } from './auth-request.guard';
import { RegistrationDto } from './registration.dto';
import { RegistrationService } from './registration.service';

export const REGISTRATION_RESPONSE = { message: 'Registration request received. If this address is eligible, activate your account before signing in.' };

@Controller('auth')
export class AuthController {
  constructor(private readonly registration: RegistrationService) {}
  @Post('register')
  @HttpCode(202)
  @UseGuards(AuthRequestGuard)
  async register(@Body() input: RegistrationDto) {
    await this.registration.register(input);
    return REGISTRATION_RESPONSE;
  }
}
