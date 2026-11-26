import { Injectable, Inject } from '@nestjs/common';
import type {
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { Observable as ActionObservable } from 'rxjs';
import { configurationAction } from './action-context.js';
import type { ActorRequest } from '../auth/request-actor.js';
import { ConfigurationRuntime } from './runtime.js';
import { trafficBinding } from './traffic.js';
@Injectable()
export class ConfigurationInterceptor implements NestInterceptor {
  constructor(
    @Inject(ConfigurationRuntime) readonly runtime: ConfigurationRuntime,
  ) {}
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<ActorRequest>();
    if (req.path.startsWith('/api/v1/admin/')) return next.handle();
    const binding = trafficBinding(req.path, req.method);
    if (!binding) return next.handle();
    if (await this.runtime.unconfigured())
      return new ActionObservable((subscriber) =>
        configurationAction.run(binding, () =>
          next.handle().subscribe(subscriber),
        ),
      );
    // Existing authentication/shared admission guards run before database policy.
    if (!req.actor) {
      await this.runtime.assert(binding);
      return next.handle();
    }
    const personal = await this.runtime.core.db.client.space.findFirst({
      where: { ownerUserId: req.actor.userId, kind: 'PERSONAL' },
      select: { id: true },
    });
    const segments = req.path.toLowerCase().split('/');
    const scoped = ['teams', 'companies', 'projects', 'spaces'].includes(
      segments[3] ?? '',
    )
      ? (req.params.scopeId ?? req.params.spaceId ?? segments[4])
      : undefined;
    const workspaceId =
      typeof scoped === 'string' && /^[a-f0-9-]{36}$/i.test(scoped)
        ? scoped
        : personal?.id;
    await this.runtime.assert(binding, {
      userId: req.actor.userId,
      ...(workspaceId ? { workspaceId } : {}),
      clientVersion: 1,
    });
    return new ActionObservable((subscriber) =>
      configurationAction.run(binding, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
