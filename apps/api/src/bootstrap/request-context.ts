import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { RequestIdSchema } from '@mehran/api-contracts';

export type ContextRequest = Request & { id: string; correlationId: string };
const safeId = (value: unknown) => RequestIdSchema.safeParse(value);

export function requestContext(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const req = request as ContextRequest;
  const inputId = safeId(request.headers['x-request-id']);
  req.id = inputId.success ? inputId.data : randomUUID();
  const correlation = safeId(request.headers['x-correlation-id']);
  req.correlationId = correlation.success ? correlation.data : req.id;
  response.setHeader('X-Request-Id', req.id);
  response.setHeader('X-Correlation-Id', req.correlationId);
  next();
}
