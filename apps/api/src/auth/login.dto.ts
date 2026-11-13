import { IsString, MaxLength, MinLength } from 'class-validator';
import { EmailDto } from './email.dto';
export class LoginDto extends EmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
