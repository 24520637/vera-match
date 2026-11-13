import { BadRequestException, ValidationPipe } from "@nestjs/common";

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Check the submitted fields.",
        details: errors.map((error) => ({
          field: error.property,
          messages: Object.values(error.constraints ?? {}),
        })),
      }),
  });
}
