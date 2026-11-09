import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { MeetingKernel } from '../application/meeting-kernel.js';
@Injectable()
export class MeetingsGuard implements CanActivate {
  constructor(@Inject(MeetingKernel) private readonly op: MeetingKernel) {}
  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp(),
      request = http.getRequest<Request & { actor: RequestActor }>(),
      response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    await this.op.collaboration.request(request.ip ?? 'unknown', request.actor);
    return true;
  }
}
