import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Company,
  CompanyDepartment,
  CompanyUnit,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyAccess, SharedKernel } from '../../spaces/public/index.js';
import type { CompanyTransaction } from '../../spaces/public/index.js';
import {
  companyAllows,
  validCompanyOverride,
} from '../domain/company-policy.js';
import type { CompanyRule } from '../domain/company-policy.js';
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Page = z.infer<typeof c.CompanyPageQuerySchema>;
@Injectable()
export class CompaniesService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CompanyAccess) readonly access: CompanyAccess,
  ) {}
  private company(row: Company, state: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') {
    return c.CompanySchema.strip().parse({
      ...row,
      state,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  private context(row: CompanyDepartment | CompanyUnit) {
    return c.CompanyContextSchema.strip().parse({
      ...row,
      kind: 'departmentId' in row ? 'UNIT' : 'DEPARTMENT',
      departmentId: 'departmentId' in row ? row.departmentId : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async hint(id: string) {
    this.kernel.assertEnabled();
    const row = await this.db.client.company.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async path(ctx: CompanyTransaction, scopeId: string) {
    if (scopeId === ctx.spaceId) return [ctx.spaceId];
    const department = await ctx.tx.companyDepartment.findFirst({
      where: { id: scopeId, spaceId: ctx.spaceId },
    });
    if (department) return [ctx.spaceId, department.id];
    const unit = await ctx.tx.companyUnit.findFirst({
      where: { id: scopeId, spaceId: ctx.spaceId },
    });
    if (!unit) throw new NotFoundException();
    return [ctx.spaceId, unit.departmentId, unit.id];
  }
  private async admittedContext(ctx: CompanyTransaction, scopeId: string) {
    if (scopeId !== ctx.spaceId && !this.access.isAdmin(ctx))
      await this.access.seat(ctx, scopeId);
    return this.path(ctx, scopeId);
  }
  private async chain(ctx: CompanyTransaction, scopeId: string) {
    const out = [];
    for (const id of await this.path(ctx, scopeId)) {
      const row = await ctx.tx.companyScopePolicy.findFirst({
        where: { spaceId: ctx.spaceId, scopeId: id },
        orderBy: { version: 'desc' },
      });
      if (!row) throw new NotFoundException();
      out.push(
        c.CompanyPolicySchema.parse({
          spaceId: row.spaceId,
          scopeId: row.scopeId,
          version: row.version,
          rules: row.rules,
        }),
      );
    }
    return out;
  }
  private async visible(
    ctx: CompanyTransaction,
    scopeId: string,
    key: CompanyRule['key'],
    administrative = true,
  ) {
    const chain = await this.chain(ctx, scopeId);
    if (administrative && this.access.isAdmin(ctx)) return chain;
    const rootRole = c.CompanyRoleSchema.parse(ctx.root.role);
    if (!companyAllows(chain.slice(0, 1), key, rootRole))
      throw new NotFoundException();
    const role =
      scopeId === ctx.spaceId
        ? rootRole
        : c.CompanyRoleSchema.parse(
            (await this.access.seat(ctx, scopeId)).role,
          );
    if (!companyAllows(chain, key, role)) throw new NotFoundException();
    return chain;
  }
  async create(
    actor: RequestActor,
    input: z.infer<typeof c.CompanyCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyCreateSchema.parse(input);
    if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
    try {
      await this.kernel.provision(
        actor,
        body.id,
        body.retentionPolicyVersion,
        async (tx, b) => {
          await tx.company.create({
            data: {
              id: body.id,
              spaceId: body.id,
              scopeId: body.id,
              title: body.title,
              description: body.description ?? null,
              createdByActorId: b.actorId,
              creationKey: hash(key),
              creationFingerprint: hash(body),
            },
          });
          await tx.companyScopePolicy.create({
            data: {
              spaceId: body.id,
              scopeId: body.id,
              version: 1,
              rules: [],
              createdByActorId: b.actorId,
              auditId: randomUUID(),
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            body.id,
            b.actorId,
            'company.create',
            body.id,
            randomUUID(),
          );
        },
        'COMPANY',
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }
    return this.access.read(actor, body.id, async (ctx) => {
      await this.visible(ctx, body.id, 'structure.read');
      const row = await ctx.tx.company.findUniqueOrThrow({
        where: { id: body.id },
      });
      if (
        row.creationKey !== hash(key) ||
        row.creationFingerprint !== hash(body) ||
        !(await this.kernel.creatorIs(
          ctx.tx,
          row.createdByActorId,
          actor.userId,
        ))
      )
        throw new ConflictException();
      return this.company(row);
    });
  }
  async read(actor: RequestActor, id: string) {
    await this.hint(id);
    return this.access.read(actor, id, async (ctx) => {
      await this.visible(ctx, id, 'structure.read');
      return this.company(
        await ctx.tx.company.findUniqueOrThrow({ where: { id } }),
        (
          await ctx.tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: id },
          })
        ).state as 'ACTIVE' | 'ARCHIVED',
      );
    });
  }
  async list(actor: RequestActor, q: Page) {
    const hints = await this.kernel.readableContextHints(actor, 'COMPANY'),
      items = [];
    for (const id of hints.ids) {
      try {
        items.push(await this.read(actor, id));
      } catch (e) {
        if (
          !(e instanceof NotFoundException) &&
          !(e instanceof ForbiddenException)
        )
          throw e;
      }
    }
    const stamp = hash(hints),
      context = 'companies',
      after = this.kernel.cursorPosition(context, stamp, actor.userId, q.after),
      rows = items
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((r) => !after || r.id > after),
      page = rows.slice(0, q.limit);
    return this.kernel.cursorPage(context, stamp, actor.userId, {
      items: page,
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    });
  }
  async patch(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.CompanyPatchSchema>,
  ) {
    await this.hint(id);
    const body = c.CompanyPatchSchema.parse(input);
    return this.access.write(actor, id, 'company.update', id, async (ctx) => {
      if (!this.access.isAdmin(ctx)) throw new ForbiddenException();
      const row = await ctx.tx.company.findUniqueOrThrow({ where: { id } });
      if (row.revision !== revision) throw new ConflictException();
      const audit = await ctx.begin(),
        changed = await ctx.tx.company.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
            revision: { increment: 1 },
            updatedAt: ctx.now,
          },
        });
      await this.access.effect(ctx, 'company.update', id, audit);
      return this.company(changed);
    });
  }
  async createContext(
    actor: RequestActor,
    id: string,
    departmentId: string | null,
    input: z.infer<typeof c.CompanyContextCreateSchema>,
    key: string | undefined,
  ) {
    await this.hint(id);
    const body = c.CompanyContextCreateSchema.parse(input),
      kind = departmentId ? 'UNIT' : 'DEPARTMENT',
      action = departmentId
        ? 'company.unit.create'
        : 'company.department.create';
    return this.access.write(actor, id, action, body.id, async (ctx) => {
      if (!this.access.isAdmin(ctx)) throw new ForbiddenException();
      if (
        departmentId &&
        !(await ctx.tx.companyDepartment.findFirst({
          where: { id: departmentId, spaceId: id },
        }))
      )
        throw new NotFoundException();
      const result = await this.access
        .once(
          ctx,
          departmentId ?? id,
          action,
          key,
          { ...body, departmentId },
          async () => {
            const audit = await ctx.begin();
            await this.access.seedScope(ctx, body.id, kind);
            const data = {
              id: body.id,
              spaceId: id,
              scopeId: body.id,
              createdByActorId: ctx.root.actorId,
              title: body.title,
              description: body.description ?? null,
              creationKey: hash(ctx.root.generation + ':' + key),
              creationFingerprint: hash({ body, departmentId }),
            };
            const row = departmentId
              ? await ctx.tx.companyUnit.create({
                  data: { ...data, departmentId },
                })
              : await ctx.tx.companyDepartment.create({ data });
            await ctx.tx.companyScopePolicy.create({
              data: {
                spaceId: id,
                scopeId: row.id,
                version: 1,
                rules: [],
                createdByActorId: ctx.root.actorId,
                auditId: randomUUID(),
              },
            });
            await this.kernel.featureGrowth(
              ctx.tx,
              id,
              departmentId ? 'company.unit' : 'company.department',
            );
            await this.access.effect(
              ctx,
              action,
              row.id,
              audit,
              departmentId ? 'company.unit' : 'company.department',
            );
            return row;
          },
        )
        .catch((error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'P2002'
          )
            throw new ConflictException();
          throw error;
        });
      const row = departmentId
        ? await ctx.tx.companyUnit.findFirst({
            where: { id: result.id, spaceId: id, departmentId },
          })
        : await ctx.tx.companyDepartment.findFirst({
            where: { id: result.id, spaceId: id },
          });
      if (!row) throw new NotFoundException();
      return this.context(row);
    });
  }
  async contextRead(
    actor: RequestActor,
    id: string,
    scopeId: string,
    kind: 'DEPARTMENT' | 'UNIT',
  ) {
    await this.hint(id);
    return this.access.read(actor, id, async (ctx) => {
      await this.visible(ctx, scopeId, 'structure.read');
      const row =
        kind === 'DEPARTMENT'
          ? await ctx.tx.companyDepartment.findFirst({
              where: { id: scopeId, spaceId: id },
            })
          : await ctx.tx.companyUnit.findFirst({
              where: { id: scopeId, spaceId: id },
            });
      if (!row) throw new NotFoundException();
      return this.context(row);
    });
  }
  async contextList(
    actor: RequestActor,
    id: string,
    departmentId: string | null,
    q: Page,
  ) {
    await this.hint(id);
    return this.access.read(actor, id, async (ctx) => {
      await this.visible(ctx, id, 'structure.read');
      if (
        departmentId &&
        !(await ctx.tx.companyDepartment.findFirst({
          where: { id: departmentId, spaceId: id },
        }))
      )
        throw new NotFoundException();
      const all = departmentId
          ? await ctx.tx.companyUnit.findMany({
              where: { spaceId: id, departmentId },
              orderBy: { id: 'asc' },
            })
          : await ctx.tx.companyDepartment.findMany({
              where: { spaceId: id },
              orderBy: { id: 'asc' },
            }),
        visible = [];
      for (const row of all) {
        try {
          await this.visible(ctx, row.id, 'structure.read');
          visible.push(this.context(row));
        } catch (e) {
          if (
            !(e instanceof NotFoundException) &&
            !(e instanceof ForbiddenException)
          )
            throw e;
        }
      }
      if (departmentId && !visible.length && !this.access.isAdmin(ctx))
        await this.visible(ctx, departmentId, 'structure.read');
      const context = 'company-structure:' + id + ':' + (departmentId ?? id),
        stamp = hash([ctx.root.generation, String(this.kernelStamp(ctx))]),
        after = this.kernel.cursorPosition(
          context,
          stamp,
          actor.userId,
          q.after,
        ),
        rows = visible.filter((r) => !after || r.id > after),
        items = rows.slice(0, q.limit);
      return this.kernel.cursorPage(context, stamp, actor.userId, {
        items,
        nextCursor: rows.length > q.limit ? items.at(-1)!.id : null,
      });
    });
  }
  private kernelStamp(ctx: CompanyTransaction) {
    return ctx.root.authorizationVersion;
  }
  async contextPatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    kind: 'DEPARTMENT' | 'UNIT',
    revision: number,
    input: z.infer<typeof c.CompanyPatchSchema>,
  ) {
    await this.hint(id);
    const body = c.CompanyPatchSchema.parse(input);
    return this.access.write(
      actor,
      id,
      'company.context.update',
      scopeId,
      async (ctx) => {
        if (!this.access.isAdmin(ctx)) throw new ForbiddenException();
        await this.path(ctx, scopeId);
        const row =
          kind === 'DEPARTMENT'
            ? await ctx.tx.companyDepartment.findFirst({
                where: { id: scopeId, spaceId: id },
              })
            : await ctx.tx.companyUnit.findFirst({
                where: { id: scopeId, spaceId: id },
              });
        if (!row) throw new NotFoundException();
        if (row.revision !== revision) throw new ConflictException();
        const audit = await ctx.begin(),
          data = {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
            revision: { increment: 1 },
            updatedAt: ctx.now,
          },
          changed =
            kind === 'DEPARTMENT'
              ? await ctx.tx.companyDepartment.update({
                  where: { id: scopeId },
                  data,
                })
              : await ctx.tx.companyUnit.update({
                  where: { id: scopeId },
                  data,
                });
        await this.access.effect(ctx, 'company.context.update', scopeId, audit);
        return this.context(changed);
      },
    );
  }
  async members(actor: RequestActor, id: string, scopeId: string, q: Page) {
    await this.hint(id);
    return this.access.read(actor, id, async (ctx) => {
      await this.visible(ctx, scopeId, 'directory.read');
      return this.access.members(ctx, scopeId, q);
    });
  }
  /** Staff content requires actual child admission even for Company administrators. */
  async staffVisibility(
    ctx: CompanyTransaction,
    scopeId: string,
    ordinary = true,
  ) {
    await this.access.seat(ctx, scopeId);
    await this.path(ctx, scopeId);
    if (ordinary) await this.visible(ctx, scopeId, 'directory.read', false);
  }
  async invite(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyInvitationCreateSchema>,
    key: string | undefined,
  ) {
    await this.hint(id);
    return this.access.invite(actor, id, scopeId, input, key, async (ctx) => {
      await this.admittedContext(ctx, scopeId);
    });
  }
  async invitation(
    actor: RequestActor,
    id: string,
    scopeId: string,
    invitationId: string,
    revoke = false,
    revision?: number,
  ) {
    await this.hint(id);
    const work = async (ctx: CompanyTransaction) => {
      await this.admittedContext(ctx, scopeId);
      return this.access.offer(ctx, scopeId, invitationId, revoke, revision);
    };
    return revoke
      ? this.access.write(
          actor,
          id,
          'company.invitation.revoke',
          invitationId,
          work,
        )
      : this.access.read(actor, id, work);
  }
  async changeMember(
    actor: RequestActor,
    id: string,
    scopeId: string,
    accessId: string,
    revision: number,
    input: z.infer<typeof c.CompanyMembershipChangeSchema>,
  ) {
    await this.hint(id);
    const body = c.CompanyMembershipChangeSchema.parse(input);
    return this.access.write(
      actor,
      id,
      'company.membership.change',
      accessId,
      async (ctx) => {
        await this.admittedContext(ctx, scopeId);
        await this.access.administer(ctx, scopeId, [body.memberRole]);
        return this.access.change(ctx, scopeId, accessId, revision, body);
      },
    );
  }
  async leave(
    actor: RequestActor,
    id: string,
    scopeId: string,
    revision: number,
  ) {
    await this.hint(id);
    if (scopeId !== id)
      await this.access.read(actor, id, (ctx) => this.path(ctx, scopeId));
    return this.access.leave(actor, id, scopeId, revision);
  }
  async policy(actor: RequestActor, id: string, scopeId: string) {
    await this.hint(id);
    return this.access.read(actor, id, async (ctx) => {
      const chain = await this.visible(ctx, scopeId, 'structure.read');
      return { scopeId, version: chain.at(-1)!.version, chain };
    });
  }
  async publish(
    actor: RequestActor,
    id: string,
    scopeId: string,
    version: number,
    input: z.infer<typeof c.CompanyPolicyPublishSchema>,
  ) {
    await this.hint(id);
    const body = c.CompanyPolicyPublishSchema.parse(input);
    return this.access.write(
      actor,
      id,
      'company.policy.publish',
      scopeId,
      async (ctx) => {
        if (!this.access.isAdmin(ctx)) throw new ForbiddenException();
        const chain = await this.chain(ctx, scopeId),
          current = chain.at(-1)!;
        if (current.version !== version) throw new ConflictException();
        if (!validCompanyOverride(chain.slice(0, -1), body.rules))
          throw new ConflictException({
            code: 'EXPLICIT_DEFAULT_OVERRIDE_REQUIRED',
          });
        const audit = await ctx.begin();
        await this.kernel.featureGrowth(ctx.tx, id, 'company.policy-version');
        await ctx.tx.companyScopePolicy.create({
          data: {
            spaceId: id,
            scopeId,
            version: version + 1,
            rules: body.rules,
            createdByActorId: ctx.root.actorId,
            auditId: audit,
          },
        });
        await this.access.effect(
          ctx,
          'company.policy.publish',
          scopeId,
          audit,
          'company.policy-version',
        );
        return {
          scopeId,
          version: version + 1,
          chain: [
            ...chain.slice(0, -1),
            { spaceId: id, scopeId, version: version + 1, rules: body.rules },
          ],
        };
      },
    );
  }
  async preview(proof: string | undefined) {
    const offer = await this.access.preview(proof),
      company = await this.db.client.company.findUnique({
        where: { id: offer.spaceId },
      });
    if (!company) throw new NotFoundException();
    return {
      companyId: company.id,
      title: company.title,
      kind: 'MEMBERSHIP' as const,
      expiresAt: offer.expiresAt,
    };
  }
}
