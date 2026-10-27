import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ErrorCode } from '@mehran/api-contracts';
import type { ContextRequest } from './request-context.js';
import { persistenceStatus } from '../platform/database/persistence-error.js';

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

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ContextRequest>();
    const response = http.getResponse<Response>();
    this.reply(exception, request, response);
  }

  reply(exception: unknown, request: ContextRequest, response: Response): void {
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
    const body: ApiError = { error: { code, message, requestId: request.id } };
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
