import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";
import { EmailDto } from "./email.dto";
export class LoginDto extends EmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @ApiProperty({ type: String, minLength: 1, maxLength: 128, writeOnly: true })
  password!: string;
}
