import {
  createParamDecorator,
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

import type { VerifiedIdentity } from './identity.js';
export type { VerifiedIdentity } from './identity.js';
export type AuthenticatedRequest = Request & { identity: VerifiedIdentity };

@Injectable()
export class VerifiedSessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const session = await this.auth.session(request.headers, (value) =>
      response.appendHeader('set-cookie', value),
    );
    if (!session) throw new UnauthorizedException();
    if (!session.user.emailVerified) throw new ForbiddenException();
    request.identity = session.user;
    return true;
  }
}
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedIdentity =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().identity,
);
