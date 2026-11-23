import {
  Injectable,
  Inject,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { AdminService } from './admin.service.js';
import type { AdminPermission } from './admin-policy.js';

const permissionKey = 'platform-admin-permission';
export const RequireAdmin = (permission: AdminPermission) =>
  SetMetadata(permissionKey, permission);
// Only the closed auth dispatcher may bypass permission metadata.
export const AdminAuthDispatcher = () =>
  SetMetadata('platform-admin-auth-dispatcher', true);
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!/^\/api\/v1\/admin(?:\/|$)/i.test(req.path)) return true;
    if (
      this.reflector.get<boolean>(
        'platform-admin-auth-dispatcher',
        context.getHandler(),
      )
    )
      return true;
    const permission = this.reflector.getAllAndOverride<AdminPermission>(
      permissionKey,
      [context.getHandler(), context.getClass()],
    );
    try {
      if (!permission) throw new ForbiddenException();
      await this.admin.authorize(req.headers, permission);
    } catch (error) {
      await this.admin.auditDenial((req as ContextRequest).id);
      throw error;
    }
    return true;
  }
}
