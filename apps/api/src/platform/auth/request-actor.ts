import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ContextRequest } from '../../bootstrap/request-context.js';

/** Derived only from a revalidated session by VerifiedSessionGuard. Never from JSON. */
export type RequestActor = Readonly<{
  userId: string;
  requestId: string;
  correlationId: string;
}>;
export type ActorRequest = ContextRequest & { actor: RequestActor };
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestActor =>
    context.switchToHttp().getRequest<ActorRequest>().actor,
);
