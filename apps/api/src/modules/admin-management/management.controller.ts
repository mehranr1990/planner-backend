import {
  All,
  Controller,
  Inject,
  Req,
  Res,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  adminManagementRoutes,
  adminManagementResponses,
  AdminDashboardSchema,
} from '@mehran/api-contracts';
import { ManagementService } from './management.service.js';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { csvCell } from '../../platform/admin/management-policy.js';

@Controller('admin')
@RequireAdmin('admin.session.read')
export class ManagementController {
  constructor(
    @Inject(ManagementService) private readonly management: ManagementService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([
    ...new Set(
      Object.keys(adminManagementRoutes).map((route) => route.split(' ')[1]!),
    ),
  ])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const path = req.path.slice('/api/v1/admin/'.length).split('/');
    let match: keyof typeof adminManagementRoutes | undefined,
      id: string | undefined;
    for (const route of Object.keys(
      adminManagementRoutes,
    ) as (keyof typeof adminManagementRoutes)[]) {
      const [method, template] = route.split(' ') as [string, string];
      const parts = template.split('/');
      if (
        method === req.method &&
        parts.length === path.length &&
        parts.every((p, i) => p === ':id' || p === path[i])
      ) {
        match = route;
        id = parts.includes(':id') ? path[parts.indexOf(':id')] : undefined;
        break;
      }
    }
    if (!match) throw new NotFoundException();
    if (
      req.method !== 'GET' &&
      (!req.headers.origin ||
        !trustedOrigins(this.config).includes(req.headers.origin))
    )
      throw new ForbiddenException();
    const raw = await this.management.handle(match, id, req);
    const data = (
      match === 'GET dashboard/export'
        ? AdminDashboardSchema
        : adminManagementResponses[match]
    ).parse(JSON.parse(JSON.stringify(raw)));
    res.setHeader('Cache-Control', 'no-store');
    if (match === 'GET dashboard/export') {
      const lines: string[] = ['metric,value'];
      const visit = (prefix: string, value: unknown) => {
        if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value))
            visit(prefix ? prefix + '.' + key : key, item);
        } else if (value !== undefined)
          lines.push(csvCell(prefix) + ',' + csvCell(value));
      };
      visit('', data);
      const csv = lines.join('\r\n') + '\r\n';
      if (Buffer.byteLength(csv) > 1048576) throw new ForbiddenException();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="admin-dashboard.csv"',
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(csv);
    } else res.status(200).json(data);
  }
}
