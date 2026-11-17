import type { Request, Response } from 'express';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { rateLimitHeaders } from '../../../bootstrap/rate-limit.js';
import type { RateLimitState } from '../../../bootstrap/rate-limit.js';
import type { SharedTraffic } from '../domain/http-rate-policy.js';

type Admission = {
  request(
    ip: string,
    actor?: RequestActor,
    preview?: boolean,
    traffic?: SharedTraffic,
  ): Promise<RateLimitState>;
};
const admission = Symbol('shared.http.admission');

/** One HTTP admission even when controller and method guards overlap. */
export async function sharedHttpRequest(
  service: Admission,
  request: Request & {
    actor?: RequestActor;
    [admission]?: Promise<RateLimitState>;
  },
  response: Response,
  preview = false,
) {
  const state = await (request[admission] ??= service.request(
    request.socket.remoteAddress ?? 'unknown',
    request.actor,
    preview,
    { method: request.method, route: String(request.route?.path ?? '') },
  ));
  for (const [name, value] of Object.entries(rateLimitHeaders(state)))
    response.setHeader(name, value);
}
