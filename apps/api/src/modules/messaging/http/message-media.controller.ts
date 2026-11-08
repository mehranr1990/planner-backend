import {
  Controller,
  Get,
  Post,
  Patch,
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
  BadRequestException,
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
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { MessagingGuard } from './messaging.controller.js';
import { MessageMediaService } from '../application/message-media.service.js';
import { MessageProgressService } from '../application/message-progress.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.ConversationEmptySchema),
  page = new ZodValidationPipe(c.ConversationPageQuerySchema);
@Controller('conversations/:id')
@UseGuards(VerifiedSessionGuard, MessagingGuard)
export class MessageMediaController {
  constructor(
    @Inject(MessageMediaService) private readonly media: MessageMediaService,
    @Inject(MessageProgressService)
    private readonly progress: MessageProgressService,
  ) {}
  @Post('attachments')
  initiate(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MessageAttachmentUploadSchema))
    b: z.infer<typeof c.MessageAttachmentUploadSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.media.initiate(a, id, b, key);
  }
  @Get('attachments/:attachmentId')
  status(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.media.status(a, id, attachmentId);
  }
  @Post('attachments/:attachmentId/complete')
  async complete(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.is('application/json')) {
      new ZodValidationPipe(c.ConversationEmptySchema).transform(
        req.body ?? {},
      );
      const item = await this.media.status(a, id, attachmentId);
      if (item.status !== 'READY') throw new ConflictException();
      return item;
    }
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return await this.media.complete(
        a,
        id,
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
  @Post('attachments/:attachmentId/cancel')
  cancel(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Body(empty) _b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') version: string | undefined,
  ) {
    return this.media.cancel(a, id, attachmentId, expectedRevision(version));
  }
  @Post('media-messages')
  create(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MediaMessageCreateSchema))
    b: z.infer<typeof c.MediaMessageCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.media.create(a, id, b, key);
  }
  @Post('media-forwards')
  forward(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MediaForwardSchema))
    b: z.infer<typeof c.MediaForwardSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.media.forward(a, id, b, key);
  }
  @Get('media-messages/:messageId')
  async detail(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = await this.media.detail(a, id, messageId);
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('media-messages/:messageId')
  edit(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Body(new ZodValidationPipe(c.MediaMessageEditSchema))
    b: z.infer<typeof c.MediaMessageEditSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') version: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.media.edit(
      a,
      id,
      messageId,
      b.caption,
      key,
      expectedRevision(version),
    );
  }
  @Get('media-timeline')
  timeline(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.media.timeline(a, id, q);
  }
  @Get('media-changes')
  changes(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.media.changes(a, id, q);
  }
  @Get('media-search')
  search(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.MessageSearchQuerySchema))
    q: z.infer<typeof c.MessageSearchQuerySchema>,
  ) {
    return this.media.timeline(a, id, q, { search: q.q });
  }
  @Get('media-threads/:messageId')
  thread(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.media.timeline(a, id, q, { thread: messageId });
  }
  @Get('media-messages/:messageId/revisions')
  revisions(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(page) q: z.infer<typeof c.ConversationPageQuerySchema>,
  ) {
    return this.media.revisions(a, id, messageId, q);
  }
  @Get('media-messages/:messageId/attachments/:attachmentId/download')
  async download(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const result = await this.media.download(a, id, messageId, attachmentId);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(result.file.actualSize),
      'Content-Disposition':
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(result.file.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    result.stream.once('error', () => res.destroy());
    res.once('close', () => result.stream.destroy());
    result.stream.pipe(res);
  }
  @Get('progress')
  getProgress(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.progress.get(a, id);
  }
  @Post('acknowledgements')
  acknowledge(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MessageAcknowledgeSchema))
    b: z.infer<typeof c.MessageAcknowledgeSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.progress.acknowledge(a, id, b, key);
  }
  @Patch('receipt-settings')
  sharing(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MessageReceiptSettingsInputSchema))
    b: z.infer<typeof c.MessageReceiptSettingsInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') version: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.progress.sharing(
      a,
      id,
      b.shareReceipts,
      key,
      expectedRevision(version),
    );
  }
  @Get('messages/:messageId/receipts')
  summary(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('messageId', uuid) messageId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.progress.summary(a, id, messageId);
  }
  @Get('notification-settings')
  noticeSettings(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.progress.noticeSettings(a, id);
  }
  @Patch('notification-settings')
  setNoticeSettings(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MessageNoticeSettingsInputSchema))
    b: z.infer<typeof c.MessageNoticeSettingsInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') version: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    if (expectedRevision(version) === undefined)
      throw new BadRequestException();
    return this.progress.setNoticeSettings(
      a,
      id,
      b,
      key,
      expectedRevision(version),
    );
  }
}
