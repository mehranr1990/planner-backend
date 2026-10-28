import {
  Body,
  BadRequestException,
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

import { Throttle } from '@nestjs/throttler';
import {
  EmptyQuerySchema,
  VoiceFileUploadSchema,
  FileIdSchema,
  FileDownloadQuerySchema,
} from '@mehran/api-contracts';
import type { VoiceFileUpload, FileDownloadQuery } from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../auth/session.guard.js';

import { CurrentActor } from '../auth/request-actor.js';
import type { RequestActor } from '../auth/request-actor.js';

import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from './files.service.js';

import { FILE_SCOPE_RESOLVER, FileThrottleGuard } from './files.controller.js';
import type { FileScopeResolver } from './files.controller.js';
@Controller('files/voice')
@UseGuards(VerifiedSessionGuard, FileThrottleGuard)
export class VoiceFilesController {
  constructor(
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(FILE_SCOPE_RESOLVER) private readonly scope: FileScopeResolver,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post('uploads')
  @Throttle({ files: { limit: 20, ttl: 60000 } })
  initiate(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(VoiceFileUploadSchema)) input: VoiceFileUpload,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!key) throw new BadRequestException();
    return this.scope(actor).then((scope) =>
      this.files.initiate(scope, input, key, true),
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
      return this.files.retryComplete(scope, id, true);
    }
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return await this.files.complete(
        scope,
        id,
        req,
        req.headers['content-length'],
        true,
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
      true,
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
    @Body(new ZodValidationPipe(EmptyQuerySchema.optional())) _body: unknown,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    await this.files.delete(await this.scope(actor), id, true);
  }
}
