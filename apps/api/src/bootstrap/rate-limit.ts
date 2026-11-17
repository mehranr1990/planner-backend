import { HttpException } from '@nestjs/common';

export type RateLimitState = {
  limit: number;
  remaining: number;
  reset: number;
};

export function rateLimitHeaders(state: RateLimitState) {
  return {
    'RateLimit-Limit': String(state.limit),
    'RateLimit-Remaining': String(state.remaining),
    'RateLimit-Reset': String(state.reset),
    'RateLimit-Policy': `${state.limit};w=60`,
  };
}

export class RateLimitException extends HttpException {
  constructor(readonly state: RateLimitState) {
    super('Too many requests', 429);
  }
}
