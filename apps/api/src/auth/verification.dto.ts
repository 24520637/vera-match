import { IsString, Matches } from 'class-validator';
export class VerificationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Open a valid activation link from your email.' })
  token!: string;
}
