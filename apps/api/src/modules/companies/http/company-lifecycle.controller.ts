import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { CompanyGuard } from './companies.controller.js';
import { CompanyLifecycleService } from '../application/company-lifecycle.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyLifecycleController {
  constructor(
    @Inject(CompanyLifecycleService)
    private readonly service: CompanyLifecycleService,
  ) {}
  @Post('archive') @HttpCode(200) async archive(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleChangeSchema.parse(
      await this.service.change(actor, id, rev(match), 'archive'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('restore') @HttpCode(200) async restore(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleChangeSchema.parse(
      await this.service.change(actor, id, rev(match), 'restore'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('delete') @HttpCode(200) async close(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyLifecyclePasswordSchema))
    body: z.infer<typeof c.CompanyLifecyclePasswordSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleChangeSchema.parse(
      await this.service.change(actor, id, rev(match), 'delete', body.password),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('status') async status(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleStatusSchema.parse(
      await this.service.status(actor, id),
    );
    void res;
    return value;
  }
  @Post('ownership-handovers') @HttpCode(201) async proposeHandover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.HandoverCreateSchema))
    body: z.infer<typeof c.HandoverCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.OwnerHandoverSchema.parse(
      await this.service.handover(actor, id, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('ownership-handovers/:handoverId') async handover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('handoverId', uuid) handoverId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.OwnerHandoverSchema.parse(
      await this.service.readHandover(actor, id, handoverId),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('ownership-handovers/:handoverId/accept')
  @HttpCode(200)
  async acceptHandover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('handoverId', uuid) handoverId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.HandoverAcceptSchema))
    body: z.infer<typeof c.HandoverAcceptSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.OwnerHandoverSchema.parse(
      await this.service.decide(
        actor,
        id,
        handoverId,
        rev(match),
        'accept',
        body.password,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('ownership-handovers/:handoverId/decline')
  @HttpCode(200)
  async declineHandover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('handoverId', uuid) handoverId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.OwnerHandoverSchema.parse(
      await this.service.decide(actor, id, handoverId, rev(match), 'decline'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('ownership-handovers/:handoverId/revoke')
  @HttpCode(200)
  async revokeHandover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('handoverId', uuid) handoverId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.OwnerHandoverSchema.parse(
      await this.service.decide(actor, id, handoverId, rev(match), 'revoke'),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('lifecycle-job') async job(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleJobSchema.parse(
      await this.service.job(actor, id),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('lifecycle-job/recovery-proof') @HttpCode(200) async proof(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyLifecyclePasswordSchema))
    body: z.infer<typeof c.CompanyLifecyclePasswordSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleProofSchema.parse(
      await this.service.proof(actor, id, rev(match), body.password),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('lifecycle-job/recover') @HttpCode(200) async recover(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyLifecycleRecoverSchema))
    body: z.infer<typeof c.CompanyLifecycleRecoverSchema>,
    @Headers('if-match') match: string | undefined,
    @Headers('x-deletion-recovery') proof: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyLifecycleRecoverySchema.parse(
      await this.service.recover(
        actor,
        id,
        rev(match),
        body.generation,
        proof,
        body.password,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
}
