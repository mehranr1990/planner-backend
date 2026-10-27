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
} from '@nestjs/common';
import type { Request } from 'express';
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

@Controller('me')
@UseGuards(VerifiedSessionGuard)
export class MeController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(AuthService) private readonly auth: AuthService,
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
    @Body(new ZodValidationPipe(ProfilePatchSchema)) patch: ProfilePatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    await this.auth.updateProfile(request.headers, patch);
    const current = await this.auth.session(request.headers);
    if (!current) throw new UnauthorizedException();
    return this.account.profile(current.user);
  }
  @Get('settings')
  settings(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    return this.account.preferences(identity.id);
  }
  @Patch('settings')
  updateSettings(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Body(new ZodValidationPipe(SettingsPatchSchema)) patch: SettingsPatch,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    return this.account.updatePreferences(identity.id, patch);
  }
  @Get('spaces')
  async personalSpaces(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Query(new ZodValidationPipe(EmptyQuerySchema)) _query: unknown,
  ) {
    return [await this.spaces.personalFor(identity.id)];
  }
}
