import { IsString, MaxLength, MinLength } from "class-validator";
import { VerificationDto } from "./verification.dto";

export class ResetPasswordDto extends VerificationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
