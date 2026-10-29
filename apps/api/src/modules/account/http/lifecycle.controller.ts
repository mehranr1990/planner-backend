import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  Query,
  Req,
  Res,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { SpacesService } from '../../spaces/public/index.js';
import { PersonalLifecycle } from '../public/lifecycle.js';
export const lifecycleThrottle = ThrottlerModule.forRoot([
  { name: 'lifecycle', ttl: 60000, limit: 10 },
]);
@Controller('me')
@UseGuards(ThrottlerGuard)
@Throttle({ lifecycle: { limit: 10, ttl: 60000 } })
export class LifecycleController {
  constructor(
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(PersonalLifecycle) private readonly lifecycle: PersonalLifecycle,
  ) {}
  @Post('export')
  @UseGuards(VerifiedSessionGuard)
  async export(
    @CurrentActor() actor: RequestActor,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.ExportRequestSchema))
    body: z.infer<typeof c.ExportRequestSchema>,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.lifecycle.requestExport(
      await this.spaces.authorizePersonal(actor),
      key,
      body,
    );
  }
  @Get('exports/:id')
  @UseGuards(VerifiedSessionGuard)
  async status(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(c.TaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.lifecycle.exportStatus(
      await this.spaces.authorizePersonal(actor),
      id,
    );
  }
  @Get('exports/:id/download')
  @UseGuards(VerifiedSessionGuard)
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(c.TaskIdSchema)) id: string,
    @Headers('x-export-proof') proof: string | undefined,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Res() res: Response,
  ) {
    const value = await this.lifecycle.download(
      await this.spaces.authorizePersonal(actor),
      id,
      proof,
    );
    res.setHeader('Content-Type', value.mimeType);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="personal-export.json"',
    );
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(value.stream, res);
  }
  @Get('exports/:id/attachments/:fileId')
  @UseGuards(VerifiedSessionGuard)
  async attachment(
    @CurrentActor() actor: RequestActor,
    @Param('id', new ZodValidationPipe(c.TaskIdSchema)) id: string,
    @Param('fileId', new ZodValidationPipe(c.TaskIdSchema)) fileId: string,
    @Headers('x-export-proof') proof: string | undefined,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
    @Res() res: Response,
  ) {
    const value = await this.lifecycle.download(
      await this.spaces.authorizePersonal(actor),
      id,
      proof,
      fileId,
    );
    res.setHeader('Content-Type', value.mimeType);
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(value.stream, res);
  }
  @Post('deletion-request')
  @UseGuards(VerifiedSessionGuard)
  async deletion(
    @CurrentActor() actor: RequestActor,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(c.DeletionRequestSchema))
    body: z.infer<typeof c.DeletionRequestSchema>,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.lifecycle.requestDeletion(
      await this.spaces.authorizePersonal(actor),
      key,
      body,
    );
  }
  @Post('deletion-request/confirm')
  confirm(
    @Body(new ZodValidationPipe(c.DeletionConfirmSchema))
    body: z.infer<typeof c.DeletionConfirmSchema>,
    @Headers('x-deletion-proof') proof: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.lifecycle.confirm(body, proof, req.headers);
  }
  @Get('deletion-request')
  deletionStatus(
    @Query(new ZodValidationPipe(c.DeletionStatusQuerySchema))
    query: z.infer<typeof c.DeletionStatusQuerySchema>,
    @Headers('x-deletion-recovery') recovery: string | undefined,
  ) {
    return this.lifecycle.deletionStatus(query.jobId, recovery);
  }
  @Post('deletion-request/cancel')
  cancel(
    @Body(new ZodValidationPipe(c.DeletionCancelSchema))
    body: z.infer<typeof c.DeletionCancelSchema>,
    @Headers('x-deletion-recovery') recovery: string | undefined,
    @Query(new ZodValidationPipe(c.EmptyQuerySchema)) _q: unknown,
  ) {
    return this.lifecycle.cancel(body, recovery);
  }
}
