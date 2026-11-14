import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Inject,
  UseGuards,
  HttpCode,
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { FileThrottleGuard } from '../../../platform/storage/public/index.js';
import { TeamGuard } from './teams.controller.js';
import { TeamFilesService } from '../application/team-files.service.js';
const uuid = new ZodValidationPipe(c.TeamCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema),
  body = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
function rev(match: string | undefined) {
  const result = expectedRevision(match);
  if (result === undefined) throw new BadRequestException();
  return result;
}
function tagged<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
/** TM-11 Team file library (owner-approved): private, Team-authorized storage. */
@Controller('teams/:id')
@UseGuards(VerifiedSessionGuard, TeamGuard)
export class TeamFilesController {
  constructor(
    @Inject(TeamFilesService) private readonly files: TeamFilesService,
  ) {}
  @Get('file-folders') folders(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(page) q: Page,
  ) {
    return this.files.folders(actor, id, q);
  }
  @Post('file-folders') async createFolder(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamFileFolderCreateSchema))
    input: z.infer<typeof c.TeamFileFolderCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.files.createFolder(actor, id, input, key));
  }
  @Patch('file-folders/:folderId') async renameFolder(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('folderId', uuid) folderId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamFileFolderPatchSchema))
    input: z.infer<typeof c.TeamFileFolderPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.files.renameFolder(actor, id, folderId, rev(match), input),
    );
  }
  @Post('file-folders/:folderId/remove') @HttpCode(200) removeFolder(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('folderId', uuid) folderId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
  ) {
    return this.files.removeFolder(actor, id, folderId, rev(match));
  }
  @Get('files') list(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.TeamFileQuerySchema))
    q: z.infer<typeof c.TeamFileQuerySchema>,
  ) {
    return this.files.list(actor, id, q);
  }
  @Post('files') async create(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamFileCreateSchema))
    input: z.infer<typeof c.TeamFileCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.files.create(actor, id, input, key));
  }
  @Get('files/:fileId') async read(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.files.read(actor, id, fileId));
  }
  @Patch('files/:fileId') async patch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.TeamFilePatchSchema))
    input: z.infer<typeof c.TeamFilePatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.files.patch(actor, id, fileId, rev(match), input),
    );
  }
  @Post('files/:fileId/remove') @HttpCode(200) async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(res, await this.files.remove(actor, id, fileId, rev(match)));
  }
  @Get('files/:fileId/versions') versions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(page) q: Page,
  ) {
    return this.files.versions(actor, id, fileId, q);
  }
  @Post('files/:fileId/versions') async createVersion(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.TeamFileVersionCreateSchema))
    input: z.infer<typeof c.TeamFileVersionCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.files.createVersion(actor, id, fileId, input, key),
    );
  }
  @Post('files/:fileId/versions/:versionId/complete')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Param('versionId', uuid) versionId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return tagged(
        res,
        await this.files.complete(
          actor,
          id,
          fileId,
          versionId,
          rev(match),
          req,
          req.headers['content-length'],
        ),
      );
    } catch (e) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw e;
    }
  }
  @Get('files/:fileId/versions/:versionId/download')
  @UseGuards(FileThrottleGuard)
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Param('versionId', uuid) versionId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.files.download(
      actor,
      id,
      fileId,
      versionId,
    );
    const name = encodeURIComponent(file.filename).replace(
      /[!'()*]/g,
      (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.actualSize!);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${name}`,
    );
    try {
      await pipeline(stream, res);
    } catch {
      res.destroy();
    }
  }
}
