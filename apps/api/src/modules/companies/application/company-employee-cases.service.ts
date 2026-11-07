import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyEmployeeCase,
  CompanyEmployeeCaseEntry,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext, StaffPage } from './company-staff.context.js';
const ref = (
  r: CompanyEmployeeCase,
  kind: 'author' | 'subject' | 'reviewer',
) => ({ accessId: r[`${kind}AccessId`], generation: r[`${kind}Generation`] });
const caseView = (r: CompanyEmployeeCase) =>
  c.CompanyEmployeeCaseSchema.strip().parse({
    ...r,
    author: ref(r, 'author'),
    subject: ref(r, 'subject'),
    reviewer: ref(r, 'reviewer'),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    redactedAt: r.redactedAt?.toISOString() ?? null,
  });
const entryView = (r: CompanyEmployeeCaseEntry) =>
  c.CompanyCaseEntrySchema.strip().parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
@Injectable()
export class CompanyEmployeeCasesService {
  constructor(
    @Inject(CompanyStaffContext) private readonly op: CompanyStaffContext,
  ) {}
  private allowed(s: StaffContext, r: CompanyEmployeeCase) {
    return (
      this.op.self(s, ref(r, 'author')) ||
      this.op.self(s, ref(r, 'subject')) ||
      (this.op.self(s, ref(r, 'reviewer')) && this.op.access.isAdmin(s))
    );
  }
  private async row(s: StaffContext, id: string) {
    const r = await s.tx.companyEmployeeCase.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!r || !this.allowed(s, r)) throw new NotFoundException();
    return r;
  }
  async create(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyEmployeeCaseCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyEmployeeCaseCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.employee.case.create',
      body.id,
      async (s) => {
        this.op.manage(s);
        await this.op.member(s, body.subject);
        const reviewer = await this.op.member(s, body.reviewer);
        if (!(await this.op.access.staffReviewer(s, reviewer)))
          throw new ForbiddenException();
        if (
          new Set([
            s.me.accessId,
            body.subject.accessId,
            body.reviewer.accessId,
          ]).size !== 3
        )
          throw new ConflictException({
            code: 'DISTINCT_CASE_PARTICIPANTS_REQUIRED',
          });
        await this.op.once(
          s,
          'company.employee.case.create',
          key,
          body,
          async () => {
            await this.op.growth(
              s,
              'company.employee-case',
              await s.tx.companyEmployeeCase.count({ where: { spaceId: id } }),
            );
            await s.change();
            return s.tx.companyEmployeeCase.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                authorAccessId: s.me.accessId,
                authorGeneration: s.me.generation,
                subjectAccessId: body.subject.accessId,
                subjectGeneration: body.subject.generation,
                reviewerAccessId: body.reviewer.accessId,
                reviewerGeneration: body.reviewer.generation,
                reason: body.reason,
                evidence: body.evidence,
                state: 'OPEN',
              },
            });
          },
        );
        return caseView(await this.row(s, body.id));
      },
      'company.employee-case',
    );
  }
  async read(actor: RequestActor, id: string, scopeId: string, caseId: string) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const r = await this.row(s, caseId);
        await this.op.audit(s, caseId);
        return caseView(r);
      },
      false,
    );
  }
  async list(actor: RequestActor, id: string, scopeId: string, q: StaffPage) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        const where: Prisma.CompanyEmployeeCaseWhereInput = {
          ...this.op.where(s),
          OR: [
            {
              authorAccessId: s.me.accessId,
              authorGeneration: s.me.generation,
            },
            {
              subjectAccessId: s.me.accessId,
              subjectGeneration: s.me.generation,
            },
            ...(this.op.access.isAdmin(s)
              ? [
                  {
                    reviewerAccessId: s.me.accessId,
                    reviewerGeneration: s.me.generation,
                  },
                ]
              : []),
          ],
        };
        const result = await this.op.page(
          s,
          'company.employee-cases',
          q,
          async () =>
            (
              await s.tx.companyEmployeeCase.findMany({ where, take: 1001 })
            ).map(caseView),
        );
        await this.op.audit(s, scopeId, 'company.employee.case.list');
        return result;
      },
      false,
    );
  }
  async entries(
    actor: RequestActor,
    id: string,
    scopeId: string,
    caseId: string,
    q: StaffPage,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        await this.row(s, caseId);
        await this.op.audit(s, caseId);
        return this.op.page(s, 'company.case-entries:' + caseId, q, async () =>
          (
            await s.tx.companyEmployeeCaseEntry.findMany({
              where: { ...this.op.where(s), caseId },
              take: 1001,
            })
          ).map(entryView),
        );
      },
      false,
    );
  }
  async append(
    actor: RequestActor,
    id: string,
    scopeId: string,
    caseId: string,
    revision: number,
    input: z.infer<typeof c.CompanyCaseEntryCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.CompanyCaseEntryCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.case.entry.create',
      body.id,
      async (s) => {
        const row = await this.row(s, caseId);
        if (row.redactedAt) throw new ConflictException();
        const required =
          body.kind === 'CORRECTION'
            ? 'author'
            : body.kind === 'REVIEW'
              ? 'reviewer'
              : 'subject';
        if (
          !this.op.self(s, ref(row, required)) ||
          (required === 'reviewer' && !this.op.access.isAdmin(s))
        )
          throw new ForbiddenException();
        await this.op.once(
          s,
          'company.case.entry.create',
          key,
          { caseId, ...body },
          async () => {
            this.op.match(row.revision, revision);
            await this.op.growth(
              s,
              'company.case-entry',
              await s.tx.companyEmployeeCaseEntry.count({
                where: { spaceId: id },
              }),
            );
            await s.change();
            await s.tx.companyEmployeeCase.update({
              where: { id: caseId },
              data: {
                ...(body.kind === 'REVIEW' ? { state: body.state } : {}),
                ...this.op.changed(s),
              },
            });
            return s.tx.companyEmployeeCaseEntry.create({
              data: {
                id: body.id,
                ...this.op.where(s),
                caseId,
                createdByActorId: s.root.actorId,
                kind: body.kind,
                body: body.body,
              },
            });
          },
        );
        const entry = await s.tx.companyEmployeeCaseEntry.findFirst({
          where: { ...this.op.where(s), id: body.id, caseId },
        });
        if (!entry) throw new ConflictException();
        return {
          entry: entryView(entry),
          case: caseView(await this.row(s, caseId)),
        };
      },
      'company.case-entry',
    );
  }
  async erase(
    actor: RequestActor,
    id: string,
    scopeId: string,
    caseId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.employee.case.erase',
      caseId,
      async (s) => {
        const row = await this.row(s, caseId);
        if (!this.op.self(s, ref(row, 'subject')))
          throw new ForbiddenException();
        this.op.match(row.revision, revision);
        await this.op.erasureAllowed(s.tx, id);
        if (row.redactedAt) return caseView(row);
        await s.change();
        const changed = await s.tx.companyEmployeeCase.update({
          where: { id: caseId },
          data: {
            reason: null,
            evidence: null,
            redactedAt: s.now,
            ...this.op.changed(s),
          },
        });
        await s.tx.companyEmployeeCaseEntry.updateMany({
          where: { ...this.op.where(s), caseId, body: { not: null } },
          data: { body: null, ...this.op.changed(s) },
        });
        return caseView(changed);
      },
    );
  }
}
