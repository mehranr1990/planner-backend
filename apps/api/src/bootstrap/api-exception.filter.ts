import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ErrorCode } from '@mehran/api-contracts';
import type { ContextRequest } from './request-context.js';
import { persistenceStatus } from '../platform/database/persistence-error.js';
import { RateLimitException, rateLimitHeaders } from './rate-limit.js';

const errors: Record<number, [ErrorCode, string]> = {
  400: ['BAD_REQUEST', 'Invalid request'],
  401: ['UNAUTHORIZED', 'Authentication required'],
  403: ['FORBIDDEN', 'Access denied'],
  404: ['NOT_FOUND', 'Resource not found'],
  409: ['CONFLICT', 'Resource conflict'],
  413: ['PAYLOAD_TOO_LARGE', 'Request payload too large'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type'],
  422: ['VALIDATION_ERROR', 'Invalid request'],
  429: ['RATE_LIMITED', 'Too many requests'],
  503: ['SERVICE_UNAVAILABLE', 'Service temporarily unavailable'],
};

// Only reviewed public reasons may cross this boundary. Never forward exception
// messages, persistence metadata or arbitrary domain codes.
const projectConflictReasons = new Set([
  'PROJECT_KEY_CONFLICT',
  'TASK_HAS_ACTIVE_CHILDREN',
  'WORKFLOW_DRAFT_TERMINAL',
  'WORKFLOW_PUBLICATION_CONFLICT',
  // P6-06: Social Group leave/delete needs a fresh balance confirmation.
  'OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED',
  // Retention v2 recovery window outcomes.
  'RESTORE_EXPIRED',
  'RECOVERY_EXPIRED',
  'RECOVERY_UNAVAILABLE',
]);
// Feature-level Shared gates; they reveal no resource, member or policy content.
const forbiddenReasons = new Set([
  'SHARED_ACTIVATION_GATED',
  'SHARED_RETENTION_UNAVAILABLE',
]);
const publicReasons: Partial<Record<number, Set<string>>> = {
  403: forbiddenReasons,
  409: projectConflictReasons,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ContextRequest>();
    const response = http.getResponse<Response>();
    this.reply(exception, request, response);
  }

  reply(exception: unknown, request: ContextRequest, response: Response): void {
    if (response.destroyed) return;
    if (response.headersSent) {
      request.log?.error({ statusCode: 500 }, 'Stream request failed');
      if (!response.destroyed) response.destroy();
      return;
    }
    // Express JSON parser errors carry a status but are not Nest HttpExceptions.
    const parserError =
      exception instanceof Error &&
      'type' in exception &&
      ['entity.parse.failed', 'entity.too.large'].includes(
        String(exception.type),
      );
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserError &&
            'status' in exception &&
            typeof exception.status === 'number'
          ? exception.status
          : (persistenceStatus(exception) ?? 500);
    const [code, message] = errors[status] ?? [
      'INTERNAL_ERROR',
      'An unexpected error occurred',
    ];
    if (exception instanceof RateLimitException) {
      for (const [name, value] of Object.entries(
        rateLimitHeaders(exception.state),
      ))
        response.setHeader(name, value);
      response.setHeader('Retry-After', String(exception.state.reset));
    } else if (status === 429 && !response.getHeader('Retry-After')) {
      // Named Nest throttlers suffix their retry header. Keep their real block delay.
      const delay = Number(
        response.getHeader('Retry-After-files') ??
          response.getHeader('Retry-After-lifecycle'),
      );
      response.setHeader(
        'Retry-After',
        Number.isSafeInteger(delay) && delay >= 0
          ? String(Math.max(1, delay))
          : '60',
      );
    }
    const body: ApiError = { error: { code, message, requestId: request.id } };
    const reasons = publicReasons[status];
    if (exception instanceof HttpException && reasons) {
      const detail = exception.getResponse();
      if (
        typeof detail === 'object' &&
        'code' in detail &&
        typeof detail.code === 'string' &&
        reasons.has(detail.code)
      )
        body.error.details = [{ path: '', code: detail.code }];
    }
    if (exception instanceof HttpException && status === 400) {
      const detail = exception.getResponse();
      if (
        typeof detail === 'object' &&
        'code' in detail &&
        detail.code === 'VALIDATION_ERROR' &&
        'details' in detail &&
        Array.isArray(detail.details)
      ) {
        body.error.code = 'VALIDATION_ERROR';
        body.error.details = detail.details as NonNullable<
          ApiError['error']['details']
        >;
      }
    }
    if (status >= 500)
      request.log?.error({ statusCode: status }, 'Request failed');
    response.status(status).json(body);
  }
}
