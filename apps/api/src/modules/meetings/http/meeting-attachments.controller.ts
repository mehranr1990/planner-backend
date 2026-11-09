import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Req,
  Res,
  Inject,
  UseGuards,
  UnsupportedMediaTypeException,
  ConflictException,
} from '@nestjs/common';
import { z as schema, type z } from 'zod';
import type { Request, Response } from 'express';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MeetingsGuard } from './meetings.guard.js';
import { MeetingFiles } from '../application/meeting-files.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.MeetingEmptySchema),
  page = new ZodValidationPipe(c.MeetingPageQuerySchema);
@Controller('meetings/:id/attachments')
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class MeetingAttachmentsController {
  constructor(@Inject(MeetingFiles) private readonly files: MeetingFiles) {}
  @Post()
  initiate(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingFileUploadSchema))
    input: z.infer<typeof c.MeetingFileUploadSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.files.initiate(a, { kind: 'MEETING', id }, input, key);
  }
  @Get()
  list(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.files.list(a, { kind: 'MEETING', id }, q);
  }
  @Get(':attachmentId')
  status(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.files.status(a, { kind: 'MEETING', id }, attachmentId);
  }
  @Post(':attachmentId/complete')
  async complete(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.is('application/json')) {
      new ZodValidationPipe(c.MeetingEmptySchema).transform(req.body ?? {});
      const row = await this.files.status(
        a,
        { kind: 'MEETING', id },
        attachmentId,
      );
      if (row.status !== 'READY') throw new ConflictException();
      return row;
    }
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return await this.files.complete(
        a,
        { kind: 'MEETING', id },
        attachmentId,
        req,
        req.headers['content-length'],
      );
    } catch (error) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw error;
    }
  }
  @Post(':attachmentId/cancel')
  cancel(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Body(empty) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
  ) {
    return this.files.cancel(
      a,
      { kind: 'MEETING', id },
      attachmentId,
      expectedRevision(match),
    );
  }

  @Post(':attachmentId/share')
  share(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Body(empty) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.files.share(a, id, attachmentId, expectedRevision(match), key);
  }

  @Get(':attachmentId/download')
  async download(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const result = await this.files.download(
      a,
      { kind: 'MEETING', id },
      attachmentId,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(result.file.actualSize),
      'Content-Disposition':
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(result.file.filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    result.stream.once('error', () => res.destroy());
    res.once('close', () => result.stream.destroy());
    result.stream.pipe(res);
  }
}
