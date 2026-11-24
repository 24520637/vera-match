import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";
import { VerificationDto } from "./verification.dto";

export class ResetPasswordDto extends VerificationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @ApiProperty({ type: String, minLength: 12, maxLength: 128, writeOnly: true })
  newPassword!: string;
}
