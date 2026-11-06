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
import { TeamGuard } from './teams.controller.js';
import { TeamCareService } from '../application/team-care.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
function result<T>(res: Response, value: T) {
  if (
    value &&
    typeof value === 'object' &&
    'revision' in value &&
    typeof value.revision === 'number'
  )
    res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamCareController {
  constructor(
    @Inject(TeamCareService) private readonly service: TeamCareService,
  ) {}
  @Get('cases') async operation0(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCasePageSchema.parse(await this.service.list(actor, id, q)),
    );
  }
  @Post('cases') async operation1(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamCaseCreateSchema))
    body: z.infer<typeof c.TeamCaseCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCaseSchema.parse(await this.service.create(actor, id, body, key)),
    );
  }
  @Get('cases/:caseId') async operation2(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCaseSchema.parse(await this.service.read(actor, id, caseId)),
    );
  }
  @Get('cases/:caseId/entries') async operation3(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCaseEntryPageSchema.parse(
        await this.service.entries(actor, id, caseId, q),
      ),
    );
  }
  @Post('cases/:caseId/entries') async operation4(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamCaseEntryInputSchema))
    body: z.infer<typeof c.TeamCaseEntryInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCaseSchema.parse(
        await this.service.entry(actor, id, caseId, rev(match), body, key),
      ),
    );
  }
  @Post('cases/:caseId/reviews') async operation5(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamCaseReviewInputSchema))
    body: z.infer<typeof c.TeamCaseReviewInputSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamCaseSchema.parse(
        await this.service.entry(
          actor,
          id,
          caseId,
          rev(match),
          body,
          key,
          true,
        ),
      ),
    );
  }
  @Get('cases/:caseId/disclosures') async operation6(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureProposalPageSchema.parse(
        await this.service.proposals(actor, id, caseId, q),
      ),
    );
  }
  @Post('cases/:caseId/disclosures') async operation7(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('caseId', uuid) caseId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamDisclosureCreateSchema))
    body: z.infer<typeof c.TeamDisclosureCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureProposalSchema.parse(
        await this.service.propose(actor, id, caseId, body, key),
      ),
    );
  }
  @Post('disclosures/:disclosureId/review') async operation8(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('disclosureId', uuid) disclosureId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamDisclosureReviewSchema))
    body: z.infer<typeof c.TeamDisclosureReviewSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureProposalSchema.parse(
        await this.service.decide(actor, id, disclosureId, rev(match), {
          kind: 'REVIEW',
          ...body,
        }),
      ),
    );
  }
  @Post('disclosures/:disclosureId/consent') async operation9(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('disclosureId', uuid) disclosureId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.TeamRecognitionConsentSchema))
    body: z.infer<typeof c.TeamRecognitionConsentSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureProposalSchema.parse(
        await this.service.decide(actor, id, disclosureId, rev(match), {
          kind: 'CONSENT',
          ...body,
        }),
      ),
    );
  }
  @Post('disclosures/:disclosureId/revoke') async operation10(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('disclosureId', uuid) disclosureId: string,
    @Query(empty) _q: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema.optional()))
    _body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureProposalSchema.parse(
        await this.service.decide(actor, id, disclosureId, rev(match), {
          kind: 'REVOKE',
        }),
      ),
    );
  }
  @Get('disclosures') async operation11(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(c.ProjectPageQuerySchema))
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureSummaryPageSchema.parse(
        await this.service.summaries(actor, id, q),
      ),
    );
  }
  @Get('disclosures/:disclosureId') async operation12(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('disclosureId', uuid) disclosureId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      res,
      c.TeamDisclosureSummarySchema.parse(
        await this.service.summaries(actor, id, { limit: 1 }, disclosureId),
      ),
    );
  }
}
