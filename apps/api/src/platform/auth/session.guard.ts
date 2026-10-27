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
import type { ActorRequest } from './request-actor.js';
import { AuditService } from '../audit/audit.service.js';
export type { VerifiedIdentity } from './identity.js';
export type AuthenticatedRequest = Request &
  ActorRequest & { identity: VerifiedIdentity };

@Injectable()
export class VerifiedSessionGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const session = await this.auth.session(request.headers, (value) =>
      response.appendHeader('set-cookie', value),
    );
    if (!session || !session.user.emailVerified) {
      await this.audit.record({
        action: 'ACCESS_DENIED',
        outcome: 'DENIED',
        actorUserId: session?.user.id ?? null,
        requestId: request.id,
        correlationId: request.correlationId,
      });
      if (!session) throw new UnauthorizedException();
      throw new ForbiddenException();
    }
    request.identity = session.user;
    request.actor = Object.freeze({
      userId: session.user.id,
      requestId: request.id,
      correlationId: request.correlationId,
    });
    return true;
  }
}
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedIdentity =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().identity,
);
