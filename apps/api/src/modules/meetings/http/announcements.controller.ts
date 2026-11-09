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
import { AnnouncementsService } from '../application/announcements.service.js';
const uuid = new ZodValidationPipe(schema.uuid()),
  empty = new ZodValidationPipe(c.MeetingEmptySchema),
  page = new ZodValidationPipe(c.MeetingPageQuerySchema);
@Controller('announcements')
@UseGuards(VerifiedSessionGuard, MeetingsGuard)
export class AnnouncementsController {
  constructor(
    @Inject(AnnouncementsService)
    private readonly announcements: AnnouncementsService,
  ) {}
  @Get('scopes/:kind/:scopeId')
  list(
    @CurrentActor() a: RequestActor,
    @Param(
      'kind',
      new ZodValidationPipe(schema.enum(['PROJECT', 'TEAM', 'COMPANY'])),
    )
    kind: 'PROJECT' | 'TEAM' | 'COMPANY',
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.announcements.list(a, scopeId, kind, q);
  }
  @Post('')
  create(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.AnnouncementCreateSchema))
    input: z.infer<typeof c.AnnouncementCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.create(a, input, key);
  }
  @Get(':id')
  get(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.read(a, id);
  }
  @Get(':id/versions')
  versions(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: z.infer<typeof c.MeetingPageQuerySchema>,
  ) {
    return this.announcements.versions(a, id, q);
  }
  @Post(':id/versions')
  createVersion(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(c.AnnouncementVersionInputSchema))
    input: z.infer<typeof c.AnnouncementVersionInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.createVersion(a, id, input, key);
  }
  @Get(':id/versions/:versionId')
  version(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.getVersion(a, id, versionId);
  }
  @Post(':id/versions/:versionId/publish')
  publish(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodValidationPipe(c.AnnouncementPublishSchema))
    input: z.infer<typeof c.AnnouncementPublishSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.publish(
      a,
      id,
      versionId,
      input,
      expectedRevision(match),
      key,
    );
  }
  @Post(':id/versions/:versionId/withdraw')
  withdraw(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.withdraw(
      a,
      id,
      versionId,
      expectedRevision(match),
      key,
    );
  }
  @Patch(':id/versions/:versionId/pin')
  pin(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodValidationPipe(c.AnnouncementPinSchema))
    input: z.infer<typeof c.AnnouncementPinSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.pin(
      a,
      id,
      versionId,
      input.pinned,
      expectedRevision(match),
      key,
    );
  }
  @Post(':id/versions/:versionId/acknowledge')
  acknowledge(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(empty) _input: unknown,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.acknowledge(a, id, versionId);
  }
  @Get(':id/versions/:versionId/acknowledgements')
  summary(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.announcements.summary(a, id, versionId);
  }
}
