import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { SpacesService } from '../../spaces/public/index.js';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { BrainDumpService } from '../application/brain-dump.service.js';
const empty = new ZodValidationPipe(c.EmptyQuerySchema),
  dayPipe = new ZodValidationPipe(c.PlanningDateSchema),
  body = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
/** B3 Personal Brain Dump (owner-approved). */
@Controller('brain-dump/pages')
@UseGuards(VerifiedSessionGuard)
export class BrainDumpController {
  constructor(
    @Inject(BrainDumpService) private readonly service: BrainDumpService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  private scope(actor: RequestActor) {
    return this.spaces.authorizePersonal(actor);
  }
  @Get() async pages(
    @CurrentActor() a: RequestActor,
    @Query(empty) _q: unknown,
  ) {
    return this.service.pages(await this.scope(a));
  }
  @Get(':period') async page(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
  ) {
    return this.service.read(await this.scope(a), day);
  }
  @Put(':period') async save(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpSaveSchema))
    input: z.infer<typeof c.BrainDumpSaveSchema>,
  ) {
    return this.service.save(await this.scope(a), day, input);
  }
  @Post(':period/lines') async add(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpAddSchema))
    input: z.infer<typeof c.BrainDumpAddSchema>,
  ) {
    return this.service.add(await this.scope(a), day, input);
  }
  @Post(':period/sort') @HttpCode(200) async sort(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpSortSchema))
    input: z.infer<typeof c.BrainDumpSortSchema>,
  ) {
    return this.service.sort(await this.scope(a), day, input);
  }
  @Post(':period/strike') @HttpCode(200) async strike(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpStrikeSchema))
    input: z.infer<typeof c.BrainDumpStrikeSchema>,
  ) {
    return this.service.strike(await this.scope(a), day, input);
  }
  @Post(':period/unsort') @HttpCode(200) async unsort(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpIdsSchema))
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    return this.service.unsort(await this.scope(a), day, input);
  }
  @Post(':period/send-to-inbox') @HttpCode(200) async inbox(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpIdsSchema))
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    return this.service.sendToInbox(await this.scope(a), day, input);
  }
  @Post(':period/remove') @HttpCode(200) async remove(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpIdsSchema))
    input: z.infer<typeof c.BrainDumpIdsSchema>,
  ) {
    return this.service.remove(await this.scope(a), day, input);
  }
  @Post(':period/restore') @HttpCode(200) async restore(
    @CurrentActor() a: RequestActor,
    @Param('period', dayPipe) day: string,
    @Query(empty) _q: unknown,
    @Body(body(c.BrainDumpRestoreSchema))
    input: z.infer<typeof c.BrainDumpRestoreSchema>,
  ) {
    return this.service.restore(await this.scope(a), day, input);
  }
}
