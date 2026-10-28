import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
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
  page = new ZodValidationPipe(c.CursorQuerySchema),
  idPipe = new ZodValidationPipe(c.TaskIdSchema);
function required(tag: string | undefined) {
  const r = expectedRevision(tag);
  if (r === undefined) throw new BadRequestException();
  return r;
}
function versioned<T extends { revision: number }>(res: Response, v: T) {
  res.setHeader('ETag', revisionTag(v.revision));
  return v;
}
import { NotesService } from '../application/notes.service.js';

@Controller('notes')
@UseGuards(VerifiedSessionGuard)
export class NotesController {
  constructor(
    @Inject(NotesService) private readonly service: NotesService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.NoteCreateSchema)) body: c.NoteCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.create(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(c.NoteQuerySchema))
    q: z.infer<typeof c.NoteQuerySchema>,
  ) {
    return this.service.list(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(c.NoteReadQuerySchema))
    q: z.infer<typeof c.NoteReadQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.get(
        await this.spaces.authorizePersonal(actor),
        id,
        q.includeDeleted === 'true',
      ),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.NotePatchSchema)) body: c.NotePatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete(':id') async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patch(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { state: 'DELETED' },
      ),
    );
  }
  @Get(':id/history') async history(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.history(
      await this.spaces.authorizePersonal(actor),
      id,
      q,
    );
  }
}
@Controller('notes/folders')
@UseGuards(VerifiedSessionGuard)
export class NoteFoldersController {
  constructor(
    @Inject(NotesService) private readonly service: NotesService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {}
  @Post() async create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(c.NoteFolderCreateSchema))
    body: c.NoteFolderCreate,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.createFolder(
        await this.spaces.authorizePersonal(actor),
        key,
        body,
      ),
    );
  }
  @Get() async list(
    @CurrentActor() actor: RequestActor,
    @Query(page) q: z.infer<typeof c.CursorQuerySchema>,
  ) {
    return this.service.folders(await this.spaces.authorizePersonal(actor), q);
  }
  @Get(':id') async get(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.folder(await this.spaces.authorizePersonal(actor), id),
    );
  }
  @Patch(':id') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.NoteFolderPatchSchema))
    body: c.NoteFolderPatch,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchFolder(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        body,
      ),
    );
  }
  @Delete(':id') async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(c.EmptyQuerySchema.optional())) _body: unknown,
    @Query(empty) _q: unknown,
    @Headers('if-match') tag: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return versioned(
      res,
      await this.service.patchFolder(
        await this.spaces.authorizePersonal(actor),
        id,
        required(tag),
        { state: 'ARCHIVED' },
      ),
    );
  }
}
