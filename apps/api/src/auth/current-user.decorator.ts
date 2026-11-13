import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from './auth-context';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
  if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'A valid session is required.' });
  return user;
});
