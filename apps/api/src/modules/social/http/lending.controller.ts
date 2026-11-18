import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  SocialGuard,
  socialId,
  socialPage,
  socialEmpty,
  socialBody,
  socialExpected,
  socialResult,
} from './social.controller.js';
import { SocialLendingService } from '../application/lending.service.js';
import { SocialLostFoundService } from '../application/lost-found.service.js';
type A = RequestActor;
type K = string | undefined;
type Infer<T extends z.ZodType> = z.infer<T>;
const pipe = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const evidence = pipe(c.SocialEvidenceCreateSchema);
@Controller('social-assets')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialAssetsController {
  constructor(
    @Inject(SocialLendingService) private readonly s: SocialLendingService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialAssetListQuerySchema))
    q: Infer<typeof c.SocialAssetListQuerySchema>,
  ) {
    return this.s.listAssets(a, q);
  }
  @Post() async create(
    @CurrentActor() a: A,
    @Body(pipe(c.SocialAssetCreateSchema))
    b: Infer<typeof c.SocialAssetCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.createAsset(a, b, k));
  }
  @Get(':id') async read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.readAsset(a, id));
  }
  @Patch(':id') async patch(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialAssetPatchSchema))
    b: Infer<typeof c.SocialAssetPatchSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.patchAsset(a, id, b, socialExpected(v), k),
    );
  }
  @Post(':id/actions/:action') async act(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialAssetActionSchema)) _action: 'archive',
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.archiveAsset(a, id, socialExpected(v), k),
    );
  }
}
@Controller('social-loans')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialLoansController {
  constructor(
    @Inject(SocialLendingService) private readonly s: SocialLendingService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialLoanListQuerySchema))
    q: Infer<typeof c.SocialLoanListQuerySchema>,
  ) {
    return this.s.listLoans(a, q);
  }
  @Post() async create(
    @CurrentActor() a: A,
    @Body(pipe(c.SocialLoanCreateSchema))
    b: Infer<typeof c.SocialLoanCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.createLoan(a, b, k));
  }
  @Get(':id') async read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.readLoan(a, id));
  }
  @Post(':id/actions/:action') async act(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialLoanActionSchema))
    action: Infer<typeof c.SocialLoanActionSchema>,
    @Body(pipe(c.SocialLoanDecisionSchema))
    b: Infer<typeof c.SocialLoanDecisionSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.act(a, id, action, b, socialExpected(v), k),
    );
  }
  @Get(':id/history') history(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.loanHistory(a, id);
  }
  @Post(':id/due-date') async proposeDue(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialLoanDueProposalSchema))
    b: Infer<typeof c.SocialLoanDueProposalSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.proposeDue(a, id, b, socialExpected(v), k),
    );
  }
  @Get(':id/evidence') evidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.loanEvidence(a, id);
  }
  @Post(':id/evidence') addEvidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(evidence) b: Infer<typeof c.SocialEvidenceCreateSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.addLoanEvidence(a, id, b, k);
  }
}
@Controller('social-lost-found')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialLostFoundController {
  constructor(
    @Inject(SocialLostFoundService) private readonly s: SocialLostFoundService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialLostFoundListQuerySchema))
    q: Infer<typeof c.SocialLostFoundListQuerySchema>,
  ) {
    return this.s.list(a, q);
  }
  @Post() async create(
    @CurrentActor() a: A,
    @Body(pipe(c.SocialLostFoundCreateSchema))
    b: Infer<typeof c.SocialLostFoundCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.create(a, b, k));
  }
  @Get(':id') async read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.read(a, id));
  }
  @Post(':id/actions/:action') async act(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialLostFoundActionSchema))
    action: Infer<typeof c.SocialLostFoundActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.act(a, id, action, socialExpected(v), k),
    );
  }
  @Get(':id/matches') matches(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(pipe(c.SocialLostFoundMatchQuerySchema))
    q: Infer<typeof c.SocialLostFoundMatchQuerySchema>,
  ) {
    return this.s.matches(a, id, q);
  }
  @Get(':id/history') history(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.history(a, id);
  }
  @Get(':id/evidence') evidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.reportEvidence(a, id);
  }
  @Post(':id/evidence') addEvidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(evidence) b: Infer<typeof c.SocialEvidenceCreateSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.addReportEvidence(a, id, b, k);
  }
  @Get(':id/claims') claims(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: Infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.s.claims(a, id, q);
  }
  @Post(':id/claims') async claim(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialLostFoundClaimCreateSchema))
    b: Infer<typeof c.SocialLostFoundClaimCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.claim(a, id, b, k));
  }
  @Get(':id/claims/:claimId') async readClaim(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('claimId', socialId) claimId: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.readClaim(a, id, claimId));
  }
  @Post(':id/claims/:claimId/actions/:action') async actClaim(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('claimId', socialId) claimId: string,
    @Param('action', pipe(c.SocialLostFoundClaimActionSchema))
    action: Infer<typeof c.SocialLostFoundClaimActionSchema>,
    @Body(pipe(c.SocialLoanDecisionSchema))
    b: Infer<typeof c.SocialLoanDecisionSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.actClaim(a, id, claimId, action, b, socialExpected(v), k),
    );
  }
  @Get(':id/claims/:claimId/evidence') claimEvidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('claimId', socialId) claimId: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.s.claimEvidence(a, id, claimId);
  }
  @Post(':id/claims/:claimId/evidence') addClaimEvidence(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('claimId', socialId) claimId: string,
    @Body(evidence) b: Infer<typeof c.SocialEvidenceCreateSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.addClaimEvidence(a, id, claimId, b, k);
  }
}
