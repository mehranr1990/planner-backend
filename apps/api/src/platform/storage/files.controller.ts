import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  EmptyQuerySchema,
  FileUploadSchema,
  FileIdSchema,
  FileDownloadQuerySchema,
} from '@mehran/api-contracts';
import type { FileUpload, FileDownloadQuery } from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { CurrentActor } from '../auth/request-actor.js';
import type { RequestActor } from '../auth/request-actor.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from './files.service.js';

export const FILE_SCOPE_RESOLVER = Symbol('FILE_SCOPE_RESOLVER');
export type FileScopeResolver = (
  actor: RequestActor,
) => Promise<AuthorizedSpace>;

@Injectable()
export class FileThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: AuthenticatedRequest,
  ): Promise<string> {
    // Verified actor, never X-Forwarded-For or another caller-selected header.
    return req.actor.userId;
  }
}

@Controller('files')
@UseGuards(VerifiedSessionGuard, FileThrottleGuard)
export class FilesController {
  constructor(
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(FILE_SCOPE_RESOLVER) private readonly scope: FileScopeResolver,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post('uploads')
  @Throttle({ files: { limit: 20, ttl: 60000 } })
  initiate(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(FileUploadSchema)) input: FileUpload,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.scope(actor).then((scope) =>
      this.files.initiate(scope, input, key),
    );
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(FileIdSchema)) id: string,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scope = await this.scope(actor);
    if (req.is('application/json')) {
      new ZodValidationPipe(EmptyQuerySchema).transform(req.body ?? {});
      return this.files.retryComplete(scope, id);
    }
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return await this.files.complete(
        scope,
        id,
        req,
        req.headers['content-length'],
      );
    } catch (error) {
      // Permit the safe JSON error to finish before closing an invalid upload's connection.
      res.setHeader('Connection', 'close');
      req.resume();
      throw error;
    }
  }

  @Get(':id/download')
  @Throttle({ files: { limit: 60, ttl: 60000 } })
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(FileIdSchema)) id: string,
    @Query(new ZodValidationPipe(FileDownloadQuerySchema))
    query: FileDownloadQuery,
    @Res() res: Response,
  ) {
    const scope = await this.scope(actor);
    const { file, stream, auditId } = await this.files.download(
      scope,
      id,
      query,
    );
    const filename = encodeURIComponent(file.filename).replace(
      /[!'()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.actualSize!);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${filename}`,
    );
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    try {
      await pipeline(stream, res);
      await this.audit.outcome(auditId, 'SUCCEEDED', actor.userId);
    } catch {
      await this.audit.outcome(auditId, 'FAILED', actor.userId);
      if (!res.destroyed) res.destroy();
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @Throttle({ files: { limit: 20, ttl: 60000 } })
  async delete(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(FileIdSchema)) id: string,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    await this.files.delete(await this.scope(actor), id);
  }
}
