import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from './auth-context';

const ROLES = 'vera:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** Compose after SessionAuthGuard; resource ownership/consent remain domain checks. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'A valid session is required.' });
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length || !roles.includes(auth.user.role)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this operation.' });
    return true;
  }
}
