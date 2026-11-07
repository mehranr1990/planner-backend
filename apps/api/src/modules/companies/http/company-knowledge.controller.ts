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
  Req,
  Inject,
  UseGuards,
  BadRequestException,
  HttpCode,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
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
import { FileThrottleGuard } from '../../../platform/storage/public/index.js';
import { Throttle } from '@nestjs/throttler';
import { CompanyGuard } from './companies.controller.js';
import { CompanyKnowledgeService } from '../application/company-knowledge.service.js';
import { CompanyKnowledgeFilesService } from '../application/company-knowledge-files.service.js';
import { CompanyReportsService } from '../application/company-reports.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.CollaborationEmptySchema);
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyKnowledgeController {
  constructor(
    @Inject(CompanyKnowledgeService)
    private readonly knowledge: CompanyKnowledgeService,
    @Inject(CompanyKnowledgeFilesService)
    private readonly files: CompanyKnowledgeFilesService,
    @Inject(CompanyReportsService)
    private readonly reports: CompanyReportsService,
  ) {}
  @Post('knowledge/folders')
  async folderCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgeFolderCreateSchema))
    body: z.infer<typeof c.CompanyKnowledgeFolderCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeFolderSchema.strip().parse(
      await this.knowledge.folderCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('knowledge/folders')
  async folders(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyKnowledgeFolderQuerySchema))
    query: z.infer<typeof c.CompanyKnowledgeFolderQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyKnowledgeFolderPageSchema.strip().parse(
      await this.knowledge.folders(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Patch('knowledge/folders/:target')
  @HttpCode(200)
  async folderPatch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgeFolderPatchSchema))
    body: z.infer<typeof c.CompanyKnowledgeFolderPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeFolderSchema.strip().parse(
      await this.knowledge.folderPatch(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('knowledge/documents')
  async documentCreate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgeDocumentCreateSchema))
    body: z.infer<typeof c.CompanyKnowledgeDocumentCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeDocumentSchema.strip().parse(
      await this.knowledge.documentCreate(actor, id, scopeId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('knowledge/documents')
  async documents(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyKnowledgeQuerySchema))
    query: z.infer<typeof c.CompanyKnowledgeQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyKnowledgeDocumentPageSchema.strip().parse(
      await this.knowledge.documents(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('knowledge/documents/:target')
  async detail(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeDocumentSchema.strip().parse(
      await this.knowledge.detail(actor, id, scopeId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Patch('knowledge/documents/:target')
  @HttpCode(200)
  async documentPatch(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgeDocumentPatchSchema))
    body: z.infer<typeof c.CompanyKnowledgeDocumentPatchSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeDocumentSchema.strip().parse(
      await this.knowledge.documentPatch(
        actor,
        id,
        scopeId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('knowledge/documents/:documentId/versions')
  async initiate(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgeVersionCreateSchema))
    body: z.infer<typeof c.CompanyKnowledgeVersionCreateSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeVersionSchema.strip().parse(
      await this.knowledge.initiate(actor, id, scopeId, documentId, body, key),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Get('knowledge/documents/:documentId/versions')
  async versions(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(new ZodValidationPipe(c.CompanyStaffPageQuerySchema))
    query: z.infer<typeof c.CompanyStaffPageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyKnowledgeVersionPageSchema.strip().parse(
      await this.knowledge.versions(actor, id, scopeId, documentId, query),
    );
    void res;
    return value;
  }
  @Get('knowledge/documents/:documentId/versions/:target')
  async getVersion(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeVersionSchema.strip().parse(
      await this.knowledge.getVersion(actor, id, scopeId, documentId, target),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('knowledge/documents/:documentId/versions/:target/publish')
  @HttpCode(200)
  async publish(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyKnowledgePublishSchema))
    body: z.infer<typeof c.CompanyKnowledgePublishSchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    const value = c.CompanyKnowledgeVersionSchema.strip().parse(
      await this.knowledge.publish(
        actor,
        id,
        scopeId,
        documentId,
        target,
        rev(match),
        body,
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('knowledge/documents/:documentId/versions/:target/remove')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async remove(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Param('target', uuid) target: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    void body;
    const value = c.CompanyKnowledgeVersionSchema.strip().parse(
      await this.files.remove(
        actor,
        id,
        scopeId,
        documentId,
        target,
        rev(match),
      ),
    );
    res.setHeader('ETag', revisionTag(value.revision));
    return value;
  }
  @Post('knowledge/files/reconcile')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async reconcile(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CollaborationEmptySchema))
    body: z.infer<typeof c.CollaborationEmptySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    void query;
    void body;
    const value = c.CompanyReceiptCleanupSchema.strip().parse(
      await this.files.reconcile(actor, id, scopeId),
    );
    void res;
    return value;
  }
  @Get('reports/operations')
  async operations(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyReportQuerySchema))
    query: z.infer<typeof c.CompanyReportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyOperationsReportSchema.strip().parse(
      await this.reports.operations(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('reports/finance')
  async financial(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyReportQuerySchema))
    query: z.infer<typeof c.CompanyReportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyFinanceReportSchema.strip().parse(
      await this.reports.financial(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('reports/portfolio')
  async portfolio(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyReportQuerySchema))
    query: z.infer<typeof c.CompanyReportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyPortfolioReportSchema.strip().parse(
      await this.reports.portfolio(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Get('audit')
  async audit(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(new ZodValidationPipe(c.CompanyAuditQuerySchema))
    query: z.infer<typeof c.CompanyAuditQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const value = c.CompanyAuditPageSchema.strip().parse(
      await this.reports.audit(actor, id, scopeId, query),
    );
    void res;
    return value;
  }
  @Post('exports')
  @HttpCode(200)
  async export(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) query: unknown,
    @Body(new ZodValidationPipe(c.CompanyExportInputSchema))
    body: z.infer<typeof c.CompanyExportInputSchema>,
    @Res() res: Response,
  ) {
    void query;
    const value = await this.reports.export(actor, id, scopeId, body);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', value.mimeType);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + value.filename + '"',
    );
    res.send(value.body);
  }
  @Post('knowledge/documents/:documentId/versions/:target/complete')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Param('target', uuid) target: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      const v = c.CompanyKnowledgeVersionSchema.parse(
        await this.files.complete(
          actor,
          id,
          scopeId,
          documentId,
          target,
          rev(match),
          req,
          req.headers['content-length'],
        ),
      );
      res.setHeader('ETag', revisionTag(v.revision));
      return v;
    } catch (e) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw e;
    }
  }
  @Get('knowledge/documents/:documentId/versions/:target/download')
  @UseGuards(FileThrottleGuard)
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Param('target', uuid) target: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.files.download(
      actor,
      id,
      scopeId,
      documentId,
      target,
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
