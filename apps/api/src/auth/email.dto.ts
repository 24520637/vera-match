import { Transform } from "class-transformer";
import { IsEmail, MaxLength } from "class-validator";
import { normalizeEmail } from "./registration.dto";
export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({ allow_display_name: false })
  @MaxLength(254)
  email!: string;
}
