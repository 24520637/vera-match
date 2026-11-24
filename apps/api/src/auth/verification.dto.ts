import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
export class VerificationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: "Open a valid activation link from your email.",
  })
  @ApiProperty({ type: String, pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43, writeOnly: true })
  token!: string;
}
