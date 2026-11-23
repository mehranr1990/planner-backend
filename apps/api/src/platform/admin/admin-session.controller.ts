import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service.js';
import { RequireAdmin } from './admin.guard.js';
@Controller('admin')
export class AdminSessionController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('session')
  @RequireAdmin('admin.session.read')
  async session(@Req() req: Request) {
    const actor = await this.admin.authorize(req.headers, 'admin.session.read');
    return {
      id: actor.user.id,
      role: actor.user.role,
      expiresAt: actor.session.expiresAt.toISOString(),
    };
  }
}
