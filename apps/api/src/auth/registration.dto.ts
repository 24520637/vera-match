import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class RegistrationDto {
  @Transform(normalizeEmail)
  @IsEmail({ allow_display_name: false })
  @MaxLength(254)
  @ApiProperty({ type: String, format: "email", maxLength: 254 })
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @ApiProperty({ type: String, minLength: 12, maxLength: 128, writeOnly: true })
  password!: string;

  @IsBoolean()
  @Equals(true, { message: "You must declare that you are 18 or older." })
  @ApiProperty({
    type: Boolean,
    allOf: [{ type: "boolean", enum: [true] }],
    description: "Must be true to confirm the applicant is at least 18 years old.",
  })
  declaredAdult!: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 80 })
  displayName?: string;
}
