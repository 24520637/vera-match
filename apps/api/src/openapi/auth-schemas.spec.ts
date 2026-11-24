import { Body, Controller, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { EmailDto } from "../auth/email.dto";
import { LoginDto } from "../auth/login.dto";
import { RegistrationDto } from "../auth/registration.dto";
import { ResetPasswordDto } from "../auth/reset-password.dto";
import { VerificationDto } from "../auth/verification.dto";

@Controller("auth")
class SchemaController {
  @Post("register") register(@Body() body: RegistrationDto) { return body; }
  @Post("email") email(@Body() body: EmailDto) { return body; }
  @Post("login") login(@Body() body: LoginDto) { return body; }
  @Post("verify") verify(@Body() body: VerificationDto) { return body; }
  @Post("reset") reset(@Body() body: ResetPasswordDto) { return body; }
}

it("exports populated auth schemas including inherited fields and validator limits", async () => {
  const module = await Test.createTestingModule({ controllers: [SchemaController] }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const schemas = document.components!.schemas! as Record<string, SchemaObject>;
    expect(schemas.EmailDto.properties!.email).toMatchObject({ type: "string", format: "email", maxLength: 254 });
    expect(schemas.LoginDto.required).toEqual(expect.arrayContaining(["email", "password"]));
    expect(schemas.LoginDto.properties!.password).toMatchObject({ minLength: 1, maxLength: 128, writeOnly: true });
    expect(schemas.RegistrationDto.required).toEqual(expect.arrayContaining(["email", "password", "declaredAdult"]));
    expect(schemas.RegistrationDto.required).not.toContain("displayName");
    expect(schemas.RegistrationDto.properties!.declaredAdult).toMatchObject({ allOf: [{ type: "boolean", enum: [true] }] });
    expect(schemas.RegistrationDto.properties!.password).toMatchObject({ minLength: 12, maxLength: 128, writeOnly: true });
    expect(schemas.VerificationDto.properties!.token).toMatchObject({ pattern: "^[A-Za-z0-9_-]{43}$", writeOnly: true });
    expect(schemas.ResetPasswordDto.required).toEqual(expect.arrayContaining(["token", "newPassword"]));
    expect(schemas.ResetPasswordDto.properties!.newPassword).toMatchObject({ minLength: 12, maxLength: 128, writeOnly: true });
  } finally {
    await app.close();
  }
});
