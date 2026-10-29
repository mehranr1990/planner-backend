import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@mehran/api-contracts';
import { NotificationsService } from '../application/notifications.service.js';
import type {
  NotificationResource,
  NotificationWrite,
} from '../application/notifications.port.js';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
const empty = new ZodValidationPipe(c.EmptyQuerySchema),
  none = new ZodValidationPipe(c.EmptyQuerySchema.optional()),
  idPipe = new ZodValidationPipe(c.TaskIdSchema);
@Controller()
@UseGuards(VerifiedSessionGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly service: NotificationsService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  private async read(
    actor: RequestActor,
    resource: NotificationResource,
    id: string | undefined,
    query: Record<string, unknown>,
    res: Response,
  ) {
    const value = await this.service.query(
      await this.spaces.authorizePersonal(actor),
      resource,
      id,
      query,
    );
    if ('revision' in value) res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  private async write(
    actor: RequestActor,
    resource: NotificationResource,
    action: NotificationWrite['action'],
    id: string | undefined,
    tag: string | undefined,
    key: string | undefined,
    body: unknown,
    res: Response,
  ) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new BadRequestException();
    const revision = expectedRevision(tag);
    if (action !== 'create' && action !== 'test' && revision === undefined)
      throw new BadRequestException();
    const value = await this.service.mutate(
      await this.spaces.authorizePersonal(actor),
      {
        resource,
        action,
        ...(id ? { id } : {}),
        ...(revision !== undefined ? { revision } : {}),
        key,
        body,
      },
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('reminders') listReminders(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.ReminderQuerySchema))
    q: Record<string, unknown>,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'reminders', undefined, q, r);
  }
  @Post('reminders') createReminder(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.ReminderCreateSchema)) b: c.ReminderCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'create', undefined, undefined, k, b, r);
  }
  @Get('reminders/:id') getReminder(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'reminders', id, {}, r);
  }
  @Patch('reminders/:id') patchReminder(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.ReminderPatchSchema)) b: c.ReminderPatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'patch', id, t, k, b, r);
  }
  @Post('reminders/:id/pause') @HttpCode(200) pause(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(none) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'pause', id, t, k, b ?? {}, r);
  }
  @Post('reminders/:id/resume') @HttpCode(200) resume(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(none) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'resume', id, t, k, b ?? {}, r);
  }
  @Delete('reminders/:id') @HttpCode(200) cancel(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(none) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'cancel', id, t, k, b ?? {}, r);
  }
  @Get('reminders/:id/deliveries') deliveries(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.NotificationDeliveryQuerySchema))
    q: Record<string, unknown>,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'deliveries', id, q, r);
  }
  @Get('notifications/preferences') preferences(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'preferences', undefined, {}, r);
  }
  @Patch('notifications/preferences') patchPreferences(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.NotificationPreferencePatchSchema))
    b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'preferences', 'patch', undefined, t, k, b, r);
  }
  @Post('notifications/test') test(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.NotificationTestSchema)) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'reminders', 'test', undefined, undefined, k, b, r);
  }
  @Get('notifications') notifications(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.NotificationQuerySchema))
    q: Record<string, unknown>,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'notifications', undefined, q, r);
  }
  @Get('notifications/:id') notification(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'notifications', id, {}, r);
  }
  @Patch('notifications/:id/read') readNotification(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.NotificationReadSchema)) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'notifications', 'read', id, t, k, b, r);
  }
  @Post('notifications/:id/dismiss') @HttpCode(200) dismiss(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(none) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'notifications', 'dismiss', id, t, k, b ?? {}, r);
  }
  @Post('notifications/:id/snooze') @HttpCode(200) snooze(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.NotificationSnoozeSchema)) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'notifications', 'snooze', id, t, k, b, r);
  }
  @Get('push/subscriptions') subscriptions(
    @CurrentActor() a: RequestActor,
    @Query(new ZodValidationPipe(c.PushSubscriptionQuerySchema))
    q: Record<string, unknown>,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.read(a, 'subscriptions', undefined, q, r);
  }
  @Post('push/subscriptions') subscribe(
    @CurrentActor() a: RequestActor,
    @Body(new ZodValidationPipe(c.PushSubscriptionCreateSchema)) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(
      a,
      'subscriptions',
      'create',
      undefined,
      undefined,
      k,
      b,
      r,
    );
  }
  @Patch('push/subscriptions/:id') updateSubscription(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.PushSubscriptionCreateSchema)) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'subscriptions', 'patch', id, t, k, b, r);
  }
  @Delete('push/subscriptions/:id') @HttpCode(200) unsubscribe(
    @CurrentActor() a: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(none) b: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') t: string | undefined,
    @Headers('idempotency-key') k: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.write(a, 'subscriptions', 'revoke', id, t, k, b ?? {}, r);
  }
}
