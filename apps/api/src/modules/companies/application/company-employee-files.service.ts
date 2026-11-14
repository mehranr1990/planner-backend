import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  CompanyEmployeeDocument,
  StoredFile,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import type { SharedFileScope } from '../../../platform/storage/public/index.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext } from './company-staff.context.js';
const PACK_LIMIT = 100 * 1024 * 1024;
/**
 * OD-8 / C9 (owner-approved): sealed employee files. Content is readable only
 * by the employee (own file) and by holders of an active, unexpired HR grant;
 * Owner/Admin roles never open it implicitly. Only the Company Owner issues or
 * revokes grants, never to themself, always with an explicit expiry. Every
 * open, upload, download and pack is logged; grants are re-checked per access.
 */
@Injectable()
export class CompanyEmployeeFilesService {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private rootOnly(s: StaffContext) {
    if (s.scopeId !== s.spaceId) throw new NotFoundException();
  }
  private owner(s: StaffContext) {
    if (s.root.role !== 'OWNER') throw new ForbiddenException();
  }
  private fileScope(s: StaffContext): SharedFileScope {
    return {
      spaceId: s.spaceId,
      scopeId: s.spaceId,
      actorId: s.me.actorId,
      verify: (tx) => {
        if (tx !== s.tx) throw new ForbiddenException();
      },
    };
  }
  private async hrGrant(s: StaffContext) {
    return s.tx.companyEmployeeGrant.findFirst({
      where: {
        spaceId: s.spaceId,
        granteeAccessId: s.me.accessId,
        granteeGeneration: s.me.generation,
        kind: 'HR',
        revokedAt: null,
        expiresAt: { gt: s.now },
      },
      orderBy: { expiresAt: 'desc' },
    });
  }
  private async subject(s: StaffContext, subjectAccessId: string) {
    const row = await s.tx.contextAccess.findFirst({
      where: { id: subjectAccessId, spaceId: s.spaceId, scopeId: s.spaceId },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  /** SELF for the employee, HR for an active grant holder, else null (sealed). */
  private async access(s: StaffContext, subjectAccessId: string) {
    this.rootOnly(s);
    await this.subject(s, subjectAccessId);
    if (s.me.accessId === subjectAccessId)
      return { kind: 'SELF' as const, expiresAt: null };
    const grant = await this.hrGrant(s);
    return grant ? { kind: 'HR' as const, expiresAt: grant.expiresAt } : null;
  }
  private log(
    s: StaffContext,
    subjectAccessId: string,
    action: string,
    targetId: string | null = null,
  ) {
    return s.tx.companyEmployeeFileLog.create({
      data: {
        id: randomUUID(),
        spaceId: s.spaceId,
        subjectAccessId,
        actorId: s.me.actorId,
        action,
        targetId,
      },
    });
  }
  private grantView(g: {
    id: string;
    granteeAccessId: string;
    granteeGeneration: number;
    kind: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  }) {
    return c.EmployeeGrantSchema.parse({
      id: g.id,
      grantee: { accessId: g.granteeAccessId, generation: g.granteeGeneration },
      kind: g.kind,
      expiresAt: g.expiresAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
    });
  }
  grants(actor: RequestActor, id: string) {
    return this.op.read(actor, id, id, async (s) => {
      this.owner(s);
      return c.EmployeeGrantListSchema.parse({
        items: (
          await s.tx.companyEmployeeGrant.findMany({
            where: { spaceId: s.spaceId },
            orderBy: { createdAt: 'desc' },
            take: 500,
          })
        ).map((g) => this.grantView(g)),
      });
    });
  }
  grant(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.EmployeeGrantCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.EmployeeGrantCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      id,
      'company.employee.grant',
      body.id,
      async (s) => {
        this.owner(s);
        if (body.grantee.accessId === s.me.accessId)
          throw new ForbiddenException({ code: 'SELF_GRANT_FORBIDDEN' });
        if (new Date(body.expiresAt) <= s.now)
          throw new ConflictException({ code: 'GRANT_EXPIRY_REQUIRED' });
        await this.op.member(s, body.grantee);
        await this.op.once(s, 'company.employee.grant', key, body, async () => {
          await s.change();
          await s.tx.companyEmployeeGrant.create({
            data: {
              id: body.id,
              spaceId: s.spaceId,
              granteeAccessId: body.grantee.accessId,
              granteeGeneration: body.grantee.generation,
              kind: body.kind,
              expiresAt: new Date(body.expiresAt),
              issuedByActorId: s.me.actorId,
            },
          });
          await this.log(s, body.grantee.accessId, 'GRANT', body.id);
          return { id: body.id };
        });
        const g = await s.tx.companyEmployeeGrant.findFirst({
          where: { id: body.id, spaceId: s.spaceId },
        });
        if (!g) throw new NotFoundException();
        return this.grantView(g);
      },
    );
  }
  revoke(actor: RequestActor, id: string, grantId: string) {
    return this.op.write(
      actor,
      id,
      id,
      'company.employee.grant.revoke',
      grantId,
      async (s) => {
        this.owner(s);
        const g = await s.tx.companyEmployeeGrant.findFirst({
          where: { id: grantId, spaceId: s.spaceId },
        });
        if (!g) throw new NotFoundException();
        if (g.revokedAt) return this.grantView(g);
        await s.change();
        await this.log(s, g.granteeAccessId, 'REVOKE', g.id);
        return this.grantView(
          await s.tx.companyEmployeeGrant.update({
            where: { id: g.id },
            data: { revokedAt: s.now, revokedByActorId: s.me.actorId },
          }),
        );
      },
    );
  }
  private async documents(s: StaffContext, subjectAccessId: string) {
    const rows = await s.tx.companyEmployeeDocument.findMany({
      where: { spaceId: s.spaceId, subjectAccessId, removedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return Promise.all(
      rows.map(async (d) => ({
        d,
        f: await this.files.row(s.tx, this.fileScope(s), d.id),
      })),
    );
  }
  private documentView(d: CompanyEmployeeDocument, f: StoredFile) {
    return c.EmployeeDocumentSchema.parse({
      id: d.id,
      title: d.title,
      kind: d.kind,
      filename: f.filename,
      size: f.actualSize,
      status: f.status,
      revision: f.revision,
      createdAt: d.createdAt.toISOString(),
    });
  }
  /** Sealed unless SELF or an active HR grant; opening is logged. */
  file(actor: RequestActor, id: string, subjectAccessId: string) {
    return this.op.write(
      actor,
      id,
      id,
      'company.employee.file.open',
      subjectAccessId,
      async (s) => {
        const access = await this.access(s, subjectAccessId);
        if (!access)
          return c.EmployeeFileSchema.parse({
            status: 'sealed',
            subjectAccessId,
            requested: Boolean(
              await s.tx.companyEmployeeFileRequest.findFirst({
                where: {
                  spaceId: s.spaceId,
                  subjectAccessId,
                  requesterAccessId: s.me.accessId,
                  requesterGeneration: s.me.generation,
                },
              }),
            ),
          });
        await s.change();
        await this.log(s, subjectAccessId, 'OPEN');
        return c.EmployeeFileSchema.parse({
          status: 'open',
          subjectAccessId,
          own: access.kind === 'SELF',
          access: {
            kind: access.kind,
            expiresAt: access.expiresAt?.toISOString() ?? null,
          },
          canAddDocument: access.kind === 'HR',
          documents: (await this.documents(s, subjectAccessId)).map(
            ({ d, f }) => this.documentView(d, f),
          ),
          log: (
            await s.tx.companyEmployeeFileLog.findMany({
              where: { spaceId: s.spaceId, subjectAccessId },
              orderBy: { createdAt: 'desc' },
              take: 200,
            })
          ).map((l) => ({
            id: l.id,
            action: l.action,
            at: l.createdAt.toISOString(),
            actorId: l.actorId,
          })),
        });
      },
    );
  }
  /** A request notifies the Company Owner in-app; it grants nothing by itself. */
  requestAccess(actor: RequestActor, id: string, subjectAccessId: string) {
    return this.op.write(
      actor,
      id,
      id,
      'company.employee.file.request',
      subjectAccessId,
      async (s) => {
        if (await this.access(s, subjectAccessId))
          throw new ConflictException({ code: 'ALREADY_AUTHORIZED' });
        await s.change();
        await s.tx.companyEmployeeFileRequest.createMany({
          data: [
            {
              id: randomUUID(),
              spaceId: s.spaceId,
              subjectAccessId,
              requesterAccessId: s.me.accessId,
              requesterGeneration: s.me.generation,
            },
          ],
          skipDuplicates: true,
        });
        await this.log(s, subjectAccessId, 'REQUEST');
        const custody = await s.tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId: s.spaceId },
        });
        const owner =
          custody.primaryOwnerAccessId &&
          (await s.tx.contextAccess.findFirst({
            where: { id: custody.primaryOwnerAccessId, state: 'ACTIVE' },
          }));
        if (owner)
          await s.tx.companyNotification.createMany({
            data: [
              {
                id: randomUUID(),
                spaceId: s.spaceId,
                scopeId: s.spaceId,
                recipientAccessId: owner.id,
                recipientGeneration: owner.generation,
                kind: 'EMPLOYEE_FILE_REQUEST',
                subjectId: subjectAccessId,
                dedupeKey: 'file:' + subjectAccessId + ':' + s.me.accessId,
              },
            ],
            skipDuplicates: true,
          });
        return { requested: true as const };
      },
    );
  }
  addDocument(
    actor: RequestActor,
    id: string,
    subjectAccessId: string,
    input: z.infer<typeof c.EmployeeDocumentCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.EmployeeDocumentCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      id,
      'company.employee.document.create',
      body.id,
      async (s) => {
        if ((await this.access(s, subjectAccessId))?.kind !== 'HR')
          throw new ForbiddenException();
        await this.op.once(
          s,
          'company.employee.document.create',
          key,
          { ...body, subjectAccessId },
          async () => {
            await s.change();
            await this.files.initiate(
              s.tx,
              this.fileScope(s),
              body.id,
              body.upload,
              s.now,
            );
            await s.tx.companyEmployeeDocument.create({
              data: {
                id: body.id,
                spaceId: s.spaceId,
                scopeId: s.spaceId,
                subjectAccessId,
                kind: body.kind,
                title: body.title,
                addedByActorId: s.me.actorId,
              },
            });
            await this.log(s, subjectAccessId, 'UPLOAD', body.id);
            return { id: body.id };
          },
        );
        const d = await this.document(s, subjectAccessId, body.id);
        return this.documentView(d.d, d.f);
      },
    );
  }
  private async document(
    s: StaffContext,
    subjectAccessId: string,
    documentId: string,
  ) {
    const d = await s.tx.companyEmployeeDocument.findFirst({
      where: {
        id: documentId,
        spaceId: s.spaceId,
        subjectAccessId,
        removedAt: null,
      },
    });
    if (!d) throw new NotFoundException();
    return { d, f: await this.files.row(s.tx, this.fileScope(s), d.id) };
  }
  async complete(
    actor: RequestActor,
    id: string,
    subjectAccessId: string,
    documentId: string,
    revision: number,
    source: Readable,
    length: string | undefined,
  ) {
    const ticket = await this.op.write(
      actor,
      id,
      id,
      'company.employee.document.claim',
      documentId,
      async (s) => {
        if ((await this.access(s, subjectAccessId))?.kind !== 'HR')
          throw new ForbiddenException();
        const { d, f } = await this.document(s, subjectAccessId, documentId);
        if (f.status === 'READY') return { view: this.documentView(d, f) };
        this.op.match(f.revision, revision);
        await s.change();
        return {
          ticket: await this.files.claim(s.tx, this.fileScope(s), f.id, s.now),
        };
      },
    );
    if ('view' in ticket) {
      source.resume();
      return ticket.view;
    }
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        this.config.FILE_UPLOAD_TIMEOUT_MS,
      );
    try {
      const evidence = await this.files.write(
        ticket.ticket,
        source,
        length,
        abort.signal,
      );
      return await this.op.write(
        actor,
        id,
        id,
        'company.employee.document.ready',
        documentId,
        async (s) => {
          if ((await this.access(s, subjectAccessId))?.kind !== 'HR')
            throw new ForbiddenException();
          const { d } = await this.document(s, subjectAccessId, documentId);
          await s.change();
          const f = await this.files.ready(
            s.tx,
            this.fileScope(s),
            ticket.ticket,
            evidence,
            s.now,
          );
          return this.documentView(d, f);
        },
      );
    } catch (error) {
      await this.op
        .write(
          actor,
          id,
          id,
          'company.employee.document.reject',
          documentId,
          async (s) => {
            await s.change();
            await this.files.reject(
              s.tx,
              this.fileScope(s),
              documentId,
              ticket.ticket.attempt,
            );
          },
        )
        .catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  /** Re-checks SELF/HR access and the exact file revision after opening bytes. */
  async download(
    actor: RequestActor,
    id: string,
    subjectAccessId: string,
    documentId: string,
  ) {
    const first = await this.op.write(
      actor,
      id,
      id,
      'company.employee.document.download',
      documentId,
      async (s) => {
        if (!(await this.access(s, subjectAccessId)))
          throw new NotFoundException();
        const row = await this.document(s, subjectAccessId, documentId);
        await s.change();
        await this.log(s, subjectAccessId, 'DOWNLOAD', documentId);
        return row.f;
      },
    );
    const stream = await this.files.open(first);
    try {
      await this.op.read(actor, id, id, async (s) => {
        if (!(await this.access(s, subjectAccessId)))
          throw new NotFoundException();
        const { f } = await this.document(s, subjectAccessId, documentId);
        if (f.revision !== first.revision || f.status !== 'READY')
          throw new NotFoundException();
      });
      return { stream, file: first };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  /** Ready documents for a download pack (bounded); the caller streams them as one archive. */
  async pack(actor: RequestActor, id: string, subjectAccessId: string) {
    const rows = await this.op.write(
      actor,
      id,
      id,
      'company.employee.file.pack',
      subjectAccessId,
      async (s) => {
        if (!(await this.access(s, subjectAccessId)))
          throw new NotFoundException();
        const ready = (await this.documents(s, subjectAccessId)).filter(
          ({ f }) => f.status === 'READY',
        );
        if (ready.reduce((n, { f }) => n + (f.actualSize ?? 0), 0) > PACK_LIMIT)
          throw new PayloadTooLargeException();
        await s.change();
        await this.log(s, subjectAccessId, 'PACK');
        return ready.map(({ f }) => f);
      },
    );
    return {
      files: rows,
      open: (f: StoredFile) => this.files.open(f),
    };
  }
  remove(
    actor: RequestActor,
    id: string,
    subjectAccessId: string,
    documentId: string,
    revision: number,
  ) {
    return this.op
      .write(
        actor,
        id,
        id,
        'company.employee.document.remove',
        documentId,
        async (s) => {
          if ((await this.access(s, subjectAccessId))?.kind !== 'HR')
            throw new ForbiddenException();
          const { d } = await this.document(s, subjectAccessId, documentId);
          await s.change();
          await s.tx.companyEmployeeDocument.update({
            where: { id: d.id },
            data: { removedAt: s.now },
          });
          await this.log(s, subjectAccessId, 'REMOVE', documentId);
          return this.files.deleted(
            s.tx,
            this.fileScope(s),
            d.id,
            revision,
            s.now,
          );
        },
      )
      .then(async (file) => {
        await this.files.remove(file);
        await this.op.write(
          actor,
          id,
          id,
          'company.employee.document.cleanup',
          documentId,
          async (s) => {
            await s.change();
            await this.files.cleanupFinished(
              s.tx,
              this.fileScope(s),
              file.id,
              file.uploadAttemptId,
            );
          },
        );
        return { id: documentId, removed: true as const };
      });
  }
}
