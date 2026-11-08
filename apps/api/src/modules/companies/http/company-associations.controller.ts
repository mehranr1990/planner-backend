import {
  Inject,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Res,
  UseGuards,
  HttpCode,
  BadRequestException,
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
import { CompanyAssociationsService } from '../application/company-associations.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  kindPipe = new ZodValidationPipe(c.CompanyAssociationKindSchema),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyAssociationsController {
  constructor(
    @Inject(CompanyAssociationsService)
    private readonly service: CompanyAssociationsService,
  ) {}
  @Post('associations') async create(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyAssociationCreateSchema))
    body: z.infer<typeof c.CompanyAssociationCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.service.create(actor, id, scopeId, body, key);
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }
  @Get('associations') async associations(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyAssociationQuerySchema))
    q: z.infer<typeof c.CompanyAssociationQuerySchema>,
  ) {
    return this.service.list(actor, id, scopeId, q, false);
  }
  @Get('attachments') async attachments(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyAssociationQuerySchema))
    q: z.infer<typeof c.CompanyAssociationQuerySchema>,
  ) {
    return this.service.list(actor, id, scopeId, q, true);
  }
  @Post('associations/:kind/:target/accept') @HttpCode(200) async accept(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('kind', kindPipe)
    kind: z.infer<typeof c.CompanyAssociationKindSchema>,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const out = await this.service.change(
      actor,
      id,
      scopeId,
      kind,
      target,
      rev(match),
      'accept',
    );
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }
  @Post('associations/:kind/:target/attachment-requests')
  @HttpCode(200)
  async requestAttachment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('kind', kindPipe)
    kind: z.infer<typeof c.CompanyAssociationKindSchema>,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const out = await this.service.change(
      actor,
      id,
      scopeId,
      kind,
      target,
      rev(match),
      'request-attachment',
    );
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }
  @Post('associations/:kind/:target/attachment-requests/accept')
  @HttpCode(200)
  async acceptAttachment(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('kind', kindPipe)
    kind: z.infer<typeof c.CompanyAssociationKindSchema>,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void body;
    const out = await this.service.change(
      actor,
      id,
      scopeId,
      kind,
      target,
      rev(match),
      'accept-attachment',
    );
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }
  @Post('associations/:kind/:target/revoke') @HttpCode(200) async revoke(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('kind', kindPipe)
    kind: z.infer<typeof c.CompanyAssociationKindSchema>,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyAssociationActionSchema))
    body: z.infer<typeof c.CompanyAssociationActionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.service.change(
      actor,
      id,
      scopeId,
      kind,
      target,
      rev(match),
      'revoke',
      body.side,
    );
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }

  @Post('associations/:kind/:target/detach')
  @HttpCode(200)
  async detach(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('kind', kindPipe)
    kind: z.infer<typeof c.CompanyAssociationKindSchema>,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CompanyAssociationActionSchema))
    body: z.infer<typeof c.CompanyAssociationActionSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.service.change(
      actor,
      id,
      scopeId,
      kind,
      target,
      rev(match),
      'detach',
      body.side,
    );
    res.setHeader('ETag', revisionTag(out.revision));
    return out;
  }
}
