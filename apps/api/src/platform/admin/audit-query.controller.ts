import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminAuditQuerySchema, adminAuditRoutes } from '@mehran/api-contracts';
import { RequireAdmin } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { AdminAuditQuery } from './audit-query.service.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
@Controller('admin/audit')
export class AdminAuditController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AdminAuditQuery) private readonly audit: AdminAuditQuery,
  ) {}
  @Get()
  @RequireAdmin('admin.audit.read')
  async list(
    @Req() req: ContextRequest,
    @Query(new ZodValidationPipe(AdminAuditQuerySchema))
    query: z.infer<typeof AdminAuditQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await this.admin.authorize(req.headers, 'admin.audit.read');
    res.setHeader('Cache-Control', 'no-store');
    return adminAuditRoutes['GET audit'].response.parse(
      await this.audit.list(actor.user, query),
    );
  }
  @Get('export')
  @RequireAdmin('admin.audit.export')
  async export(
    @Req() req: ContextRequest,
    @Query(new ZodValidationPipe(AdminAuditQuerySchema))
    query: z.infer<typeof AdminAuditQuerySchema>,
    @Res() res: Response,
  ) {
    const event = await this.admin.auditAttempt('ADMIN_AUDIT_EXPORT', req.id);
    let id: string | null = null;
    try {
      const actor = await this.admin.authorize(
        req.headers,
        'admin.audit.export',
      );
      id = actor.user.id;
      this.admin.requireRecent(actor);
      const data = await this.audit.csv(actor.user, query);
      const csv = adminAuditRoutes['GET audit/export'].response.parse(data.csv);
      await this.admin.auditOutcome(event.id, 'SUCCEEDED', id);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="admin-audit.csv"',
      );
      if (data.nextCursor) res.setHeader('X-Next-Cursor', data.nextCursor);
      res.status(200).send(csv);
    } catch (error) {
      await this.admin.auditOutcome(event.id, 'DENIED', id);
      throw error;
    }
  }
}
