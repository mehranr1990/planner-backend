import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { z as schema, type z } from 'zod';
import * as c from '@mehran/api-contracts';
import {
  CurrentActor,
  type RequestActor,
} from '../../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { expectedRevision } from '../../../bootstrap/concurrency.js';
import { MeetingsGuard } from './meetings.guard.js';
import { MeetingDocuments } from '../application/meeting-documents.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.MeetingEmptySchema),
  page = new ZodValidationPipe(c.MeetingPageQuerySchema);
@Controller('meetings/:id')
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class MeetingDocumentsController {
  constructor(
    @Inject(MeetingDocuments) private readonly documents: MeetingDocuments,
  ) {}
  @Get('versions')
  list(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.documents.list(a, id, q);
  }
  @Post('versions')
  create(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.MeetingVersionCreateSchema))
    input: z.infer<typeof c.MeetingVersionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.create(a, id, input, key);
  }
  @Get('versions/:versionId')
  get(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.get(a, id, versionId);
  }
  @Patch('versions/:versionId/reviewer')
  reviewer(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodValidationPipe(c.MeetingReviewerSchema))
    input: z.infer<typeof c.MeetingReviewerSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.reviewer(
      a,
      id,
      versionId,
      input.memberId,
      expectedRevision(match),
      key,
    );
  }
  @Post('versions/:versionId/submit')
  submit(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.submit(
      a,
      id,
      versionId,
      expectedRevision(match),
      key,
    );
  }
  @Post('versions/:versionId/review')
  review(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodValidationPipe(c.MeetingReviewInputSchema))
    input: z.infer<typeof c.MeetingReviewInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.review(
      a,
      id,
      versionId,
      input,
      expectedRevision(match),
      key,
    );
  }
  @Post('versions/:versionId/finalize')
  finalize(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.finalize(
      a,
      id,
      versionId,
      expectedRevision(match),
      key,
    );
  }
  @Post('versions/:versionId/withdraw')
  withdraw(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.withdraw(
      a,
      id,
      versionId,
      expectedRevision(match),
      key,
    );
  }
  @Get('actions/:actionId/release')
  releaseState(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('actionId', uuid) actionId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.releaseState(a, id, actionId);
  }
  @Patch('actions/:actionId/release')
  release(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('actionId', uuid) actionId: string,
    @Body(new ZodValidationPipe(c.MeetingActionReleaseSchema))
    input: z.infer<typeof c.MeetingActionReleaseSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.release(
      a,
      id,
      actionId,
      input.active,
      expectedRevision(match),
      key,
    );
  }
  @Post('actions/:actionId/tasks')
  convert(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('actionId', uuid) actionId: string,
    @Body(new ZodValidationPipe(c.MeetingTaskCommandSchema))
    input: z.infer<typeof c.MeetingTaskCommandSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.documents.convert(a, id, actionId, input, key);
  }
  @Get('actions/:actionId/tasks')
  links(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('actionId', uuid) actionId: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.documents.links(a, id, actionId, q);
  }
}
