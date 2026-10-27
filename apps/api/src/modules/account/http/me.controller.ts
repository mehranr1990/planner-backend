import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  Res,
  Headers,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  EmptyQuerySchema,
  ProfilePatchSchema,
  SettingsPatchSchema,
} from '@mehran/api-contracts';
import type { ProfilePatch, SettingsPatch } from '@mehran/api-contracts';
import {
  VerifiedSessionGuard,
  CurrentIdentity,
} from '../../../platform/auth/session.guard.js';
import type { VerifiedIdentity } from '../../../platform/auth/session.guard.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { AccountService } from '../application/account.service.js';
import { SpacesService } from '../../spaces/public/index.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { AuditService } from '../../../platform/audit/audit.service.js';

@Controller('me')
@UseGuards(VerifiedSessionGuard)
export class MeController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  @Get()
  me(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    return this.account.profile(identity);
  }
  @Patch()
  async update(
    @Req() request: Request,
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(ProfilePatchSchema)) patch: ProfilePatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    const audit = await this.audit.record({
      action: 'ACCOUNT_PROFILE_UPDATE',
      outcome: 'ATTEMPTED',
      actorUserId: actor.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      changedFields: Object.keys(patch) as Array<keyof ProfilePatch>,
    });
    try {
      await this.auth.updateProfile(request.headers, patch);
      await this.audit.outcome(audit.id, 'SUCCEEDED', actor.userId);
    } catch (error) {
      await this.audit.outcome(
        audit.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
        actor.userId,
      );
      throw error;
    }
    const current = await this.auth.session(request.headers);
    if (!current) throw new UnauthorizedException();
    return this.account.profile(current.user);
  }
  @Get('settings')
  async settings(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.account.preferences(identity.id);
    response.setHeader('ETag', revisionTag(result.revision));
    return result.data;
  }
  @Patch('settings')
  async updateSettings(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(SettingsPatchSchema)) patch: SettingsPatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
    @Headers('if-match') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const revision = expectedRevision(header);
    const scope = await this.spaces.authorizePersonal(actor);
    const result = await this.account.updatePreferences(scope, patch, revision);
    response.setHeader('ETag', revisionTag(result.revision));
    return result.data;
  }
  @Get('spaces')
  async personalSpaces(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    return [await this.spaces.personalFor(identity.id)];
  }
}
