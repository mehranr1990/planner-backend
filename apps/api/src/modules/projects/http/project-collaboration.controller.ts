import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  UnsupportedMediaTypeException,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Throttle } from '@nestjs/throttler';
import { FileThrottleGuard } from '../../../platform/storage/public/index.js';
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
import { ProjectGuard } from './projects.controller.js';
import { ProjectContentService } from '../application/project-content.service.js';
import { ProjectFilesService } from '../application/project-files.service.js';
import { ProjectViewsService } from '../application/project-views.service.js';
import { ProjectsService } from '../application/projects.service.js';
import { ProjectExportService } from '../application/project-export.service.js';
const uuid = new ZodValidationPipe(c.ProjectCreateSchema.shape.id),
  kind = new ZodValidationPipe(c.ProjectContentTargetSchema.shape.kind),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema),
  empty = new ZodValidationPipe(c.ProjectEmptySchema);
function revision(raw: string | undefined) {
  const n = expectedRevision(raw);
  if (n === undefined) throw new BadRequestException();
  return n;
}
type Kind = z.infer<typeof c.ProjectContentTargetSchema>['kind'];
@Controller('projects/:projectId')
@UseGuards(VerifiedSessionGuard, ProjectGuard)
export class ProjectCollaborationController {
  constructor(
    @Inject(ProjectContentService)
    private readonly content: ProjectContentService,
    @Inject(ProjectFilesService) private readonly files: ProjectFilesService,
    @Inject(ProjectViewsService) private readonly views: ProjectViewsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectExportService)
    private readonly exports: ProjectExportService,
  ) {}
  @Post('exports')
  @HttpCode(200)
  async export(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectExportInputSchema))
    v: z.infer<typeof c.ProjectExportInputSchema>,
    @Res() res: Response,
  ) {
    const result = await this.exports.build(a, p, v);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.body);
  }
  @Post('content-grant-offers')
  @HttpCode(200)
  grant(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectContentGrantCreateSchema))
    v: z.infer<typeof c.ProjectContentGrantCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.projects.createContentGrantOffer(a, p, v, key);
  }
  @Get('documents')
  documents(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.content.documents(a, p, q);
  }
  @Post('documents')
  @HttpCode(200)
  async documentCreate(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectDocumentCreateSchema))
    v: z.infer<typeof c.ProjectDocumentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.publishDocument(
      a,
      p,
      v.id,
      0,
      { title: v.title, body: v.body },
      key,
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('documents/:documentId')
  async document(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('documentId', uuid) id: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.getDocument(a, p, id);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Put('documents/:documentId')
  async documentPublish(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('documentId', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectDocumentInputSchema))
    v: z.infer<typeof c.ProjectDocumentInputSchema>,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.publishDocument(a, p, id, revision(raw), v);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Delete('documents/:documentId')
  async documentRetire(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('documentId', uuid) id: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional())) _v: unknown,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.retireDocument(a, p, id, revision(raw));
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('documents/:documentId/versions')
  versions(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('documentId', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.content.documentVersions(a, p, id, q);
  }
  @Post('comments')
  @HttpCode(200)
  async commentCreate(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectCommentCreateSchema))
    v: z.infer<typeof c.ProjectCommentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.createComment(a, p, v, key);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('content/:targetKind/:targetId/comments')
  comments(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.content.comments(a, p, { ...q, targetKind: k, targetId: id });
  }
  @Get('content/:targetKind/:targetId/comments/:commentId/history')
  history(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('commentId', uuid) commentId: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.content.commentVersions(a, p, commentId, { kind: k, id }, q);
  }
  @Put('content/:targetKind/:targetId/comments/:commentId')
  async commentEdit(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('commentId', uuid) commentId: string,
    @Body(new ZodValidationPipe(c.ProjectCommentInputSchema))
    v: z.infer<typeof c.ProjectCommentInputSchema>,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.updateComment(
      a,
      p,
      commentId,
      { kind: k, id },
      revision(raw),
      v,
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Delete('content/:targetKind/:targetId/comments/:commentId')
  async commentDelete(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('commentId', uuid) commentId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional())) _v: unknown,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.content.updateComment(
      a,
      p,
      commentId,
      { kind: k, id },
      revision(raw),
      null,
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('content/:targetKind/:targetId/activity')
  activity(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.content.activityList(a, p, {
      ...q,
      targetKind: k,
      targetId: id,
    });
  }
  @Get('content/:targetKind/:targetId/files')
  @UseGuards(FileThrottleGuard)
  fileList(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Query(page) q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.files.list(a, p, { ...q, targetKind: k, targetId: id });
  }
  @Post('files')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 20, ttl: 60000 } })
  async initiate(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectFileCreateSchema))
    v: z.infer<typeof c.ProjectFileCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.files.initiate(a, p, v, key);
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('content/:targetKind/:targetId/files/:fileId')
  @UseGuards(FileThrottleGuard)
  async file(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.files.get(a, p, fileId, { kind: k, id });
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Post('content/:targetKind/:targetId/files/:fileId/complete')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.is('application/json')) {
      empty.transform(req.body ?? {});
      const r = await this.files.retryComplete(a, p, fileId, { kind: k, id });
      res.setHeader('ETag', revisionTag(r.revision));
      return r;
    }
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      const r = await this.files.complete(
        a,
        p,
        fileId,
        { kind: k, id },
        req,
        req.headers['content-length'],
      );
      res.setHeader('ETag', revisionTag(r.revision));
      return r;
    } catch (e) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw e;
    }
  }
  @Delete('content/:targetKind/:targetId/files/:fileId')
  @UseGuards(FileThrottleGuard)
  async fileDelete(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional())) _v: unknown,
    @Headers('if-match') raw: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.files.delete(
      a,
      p,
      fileId,
      { kind: k, id },
      revision(raw),
    );
    res.setHeader('ETag', revisionTag(r.revision));
    return r;
  }
  @Get('content/:targetKind/:targetId/files/:fileId/download')
  @UseGuards(FileThrottleGuard)
  async download(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Param('targetKind', kind) k: Kind,
    @Param('targetId', uuid) id: string,
    @Param('fileId', uuid) fileId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.files.download(a, p, fileId, {
      kind: k,
      id,
    });
    const name = encodeURIComponent(file.filename).replace(
      /[!'()*]/g,
      (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.actualSize!);
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
  @Post('files/reconcile')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  reconcile(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Body(new ZodValidationPipe(c.ProjectEmptySchema.optional())) _v: unknown,
  ) {
    return this.files.reconcile(a, p);
  }
  @Get('views')
  view(
    @CurrentActor() a: RequestActor,
    @Param('projectId', uuid) p: string,
    @Query(new ZodValidationPipe(c.ProjectViewQuerySchema))
    q: z.infer<typeof c.ProjectViewQuerySchema>,
  ) {
    return this.views.query(a, p, q);
  }
}
