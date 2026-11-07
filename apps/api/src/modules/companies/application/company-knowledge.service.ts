import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type {
  CompanyKnowledgeDocument,
  CompanyKnowledgeFolder,
  CompanyKnowledgeVersion,
} from '../../../generated/prisma/client.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import { CompanyStaffContext } from './company-staff.context.js';
import type { StaffContext } from './company-staff.context.js';
import type { CompanyTransaction } from '../../spaces/public/index.js';
import { CompaniesService } from './companies.service.js';
const dates = <T extends { createdAt: Date; updatedAt: Date }>(r: T) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
@Injectable()
export class CompanyKnowledgeService {
  constructor(
    @Inject(CompanyStaffContext) readonly op: CompanyStaffContext,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
    @Inject(SharedFiles) readonly files: SharedFiles,
  ) {}
  visibility(ctx: CompanyTransaction, scopeId: string, ordinary: boolean) {
    return this.companies.staffVisibility(ctx, scopeId, ordinary);
  }
  manager(s: StaffContext) {
    return (
      this.op.access.isAdmin(s) ||
      (s.scopeId !== s.spaceId && s.me.role === 'DEPT_MANAGER')
    );
  }
  read<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    work: (s: StaffContext) => Promise<T>,
  ) {
    return this.op.read(
      actor,
      id,
      scopeId,
      async (s) => {
        await this.companies.staffVisibility(s, scopeId, !this.manager(s));
        return work(s);
      },
      false,
    );
  }
  write<T>(
    actor: RequestActor,
    id: string,
    scopeId: string,
    action: string,
    target: string,
    work: (s: StaffContext) => Promise<T>,
    feature?:
      | 'company.knowledge-folder'
      | 'company.knowledge-document'
      | 'company.knowledge-version',
  ) {
    return this.op.write(
      actor,
      id,
      scopeId,
      'company.knowledge.' + action,
      target,
      async (s) => {
        this.op.manage(s);
        return work(s);
      },
      feature,
    );
  }
  fileScope(s: StaffContext) {
    return {
      spaceId: s.spaceId,
      scopeId: s.scopeId,
      actorId: s.me.actorId,
      verify: (tx: typeof s.tx, write: boolean) => {
        if (tx !== s.tx) throw new ForbiddenException();
        if (write) this.op.manage(s);
      },
    };
  }
  async ancestors(
    s: StaffContext,
    id: string,
    allowArchived = this.manager(s),
  ) {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current) || seen.size >= 9) throw new ConflictException();
      seen.add(current);
      const f: CompanyKnowledgeFolder | null =
        await s.tx.companyKnowledgeFolder.findFirst({
          where: { ...this.op.where(s), id: current },
        });
      if (!f || (!allowArchived && f.archived)) throw new NotFoundException();
      current = f.parentId;
    }
    return seen;
  }
  async document(s: StaffContext, id: string, mutable = false) {
    const d = await s.tx.companyKnowledgeDocument.findFirst({
      where: { ...this.op.where(s), id },
    });
    if (!d) throw new NotFoundException();
    await this.ancestors(s, d.folderId, mutable ? false : this.manager(s));
    if ((mutable || !this.manager(s)) && d.archived)
      throw new NotFoundException();
    if (!this.manager(s) && !d.publishedVersionId)
      throw new NotFoundException();
    return d;
  }
  async version(
    s: StaffContext,
    documentId: string,
    id: string,
    mutable = false,
  ) {
    const d = await this.document(s, documentId, mutable),
      v = await s.tx.companyKnowledgeVersion.findFirst({
        where: { ...this.op.where(s), documentId, id },
      });
    if (!v || (!this.manager(s) && !v.publishedAt))
      throw new NotFoundException();
    if (mutable) {
      this.op.manage(s);
      if (v.publishedAt) throw new ConflictException();
      if (
        v.uploaderAccessId !== s.me.accessId ||
        v.uploaderGeneration !== s.me.generation
      )
        throw new ForbiddenException();
    }
    const f = await this.files.row(s.tx, this.fileScope(s), v.fileId);
    if (
      v.publishedAt &&
      (f.status !== 'READY' ||
        f.revision !== v.pinnedRevision ||
        f.sha256 !== v.pinnedHash)
    )
      throw new ConflictException({ code: 'KNOWLEDGE_EVIDENCE_CHANGED' });
    return { d, v, f };
  }
  versionView(
    v: CompanyKnowledgeVersion,
    f: Awaited<ReturnType<SharedFiles['row']>>,
  ) {
    return c.CompanyKnowledgeVersionSchema.strip().parse({
      ...dates(v),
      revision: f.revision,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      filename: f.filename,
      mimeType: f.mimeType,
      expectedSize: f.expectedSize,
      actualSize: f.actualSize,
      status: f.status,
      sha256: f.sha256,
    });
  }
  async documentView(s: StaffContext, d: CompanyKnowledgeDocument) {
    if (this.manager(s))
      return c.CompanyKnowledgeDocumentSchema.strip().parse(dates(d));
    const { v } = await this.version(s, d.id, d.publishedVersionId!);
    return c.CompanyKnowledgeDocumentSchema.parse({
      id: d.id,
      spaceId: d.spaceId,
      scopeId: d.scopeId,
      folderId: d.folderId,
      title: v.title,
      description: v.description,
      archived: false,
      publishedVersionId: v.id,
      revision: v.revision,
      createdAt: v.publishedAt!.toISOString(),
      updatedAt: v.publishedAt!.toISOString(),
    });
  }
  folderCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyKnowledgeFolderCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'folder.create',
      input.id,
      async (s) => {
        const r = await this.op.once(
          s,
          'company.knowledge.folder',
          key,
          input,
          async () => {
            if (input.parentId) {
              const path = await this.ancestors(s, input.parentId, false);
              if (path.size >= 8) throw new ConflictException();
            }
            await this.op.growth(
              s,
              'company.knowledge-folder',
              await s.tx.companyKnowledgeFolder.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            return s.tx.companyKnowledgeFolder.create({
              data: { ...this.op.where(s), ...input },
            });
          },
        );
        return dates(
          await s.tx.companyKnowledgeFolder.findUniqueOrThrow({
            where: { id: r.id },
          }),
        );
      },
      'company.knowledge-folder',
    );
  }
  folderPatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyKnowledgeFolderPatchSchema>,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'folder.update',
      target,
      async (s) => {
        const r = await s.tx.companyKnowledgeFolder.findFirst({
          where: { ...this.op.where(s), id: target },
        });
        if (!r) throw new NotFoundException();
        this.op.match(r.revision, revision);
        await s.change();
        return dates(
          await s.tx.companyKnowledgeFolder.update({
            where: { id: target },
            data: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...('description' in input && input.description !== undefined
                ? { description: input.description }
                : {}),
              ...(input.archived !== undefined
                ? { archived: input.archived }
                : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  async folders(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyKnowledgeQuerySchema>,
  ) {
    return this.read(actor, id, scopeId, async (s) =>
      this.op.page(
        s,
        'knowledge.folders:' + JSON.stringify({ search: q.search }),
        q,
        async () => {
          const rows = await s.tx.companyKnowledgeFolder.findMany({
            where: this.op.where(s),
            take: 1001,
          });
          if (rows.length > 1000) throw new PayloadTooLargeException();
          const visible = new Set<string>();
          if (!this.manager(s)) {
            for (const d of await s.tx.companyKnowledgeDocument.findMany({
              where: {
                ...this.op.where(s),
                archived: false,
                publishedVersionId: { not: null },
              },
              take: 1001,
            })) {
              try {
                for (const f of await this.ancestors(s, d.folderId, false))
                  visible.add(f);
              } catch (e) {
                if (!(e instanceof NotFoundException)) throw e;
              }
            }
          }
          return rows
            .filter(
              (r) =>
                (this.manager(s) || visible.has(r.id)) &&
                (!q.search ||
                  r.title
                    .toLocaleLowerCase()
                    .includes(q.search.toLocaleLowerCase())),
            )
            .map(dates);
        },
      ),
    );
  }
  documentCreate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyKnowledgeDocumentCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'document.create',
      input.id,
      async (s) => {
        const r = await this.op.once(
          s,
          'company.knowledge.document',
          key,
          input,
          async () => {
            await this.ancestors(s, input.folderId, false);
            await this.op.growth(
              s,
              'company.knowledge-document',
              await s.tx.companyKnowledgeDocument.count({
                where: this.op.where(s),
              }),
            );
            await s.change();
            return s.tx.companyKnowledgeDocument.create({
              data: { ...this.op.where(s), ...input },
            });
          },
        );
        return this.documentView(s, await this.document(s, r.id));
      },
      'company.knowledge-document',
    );
  }
  documentPatch(
    actor: RequestActor,
    id: string,
    scopeId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyKnowledgeDocumentPatchSchema>,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'document.update',
      target,
      async (s) => {
        const d = await this.document(s, target);
        this.op.match(d.revision, revision);
        await s.change();
        return this.documentView(
          s,
          await s.tx.companyKnowledgeDocument.update({
            where: { id: target },
            data: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...('description' in input && input.description !== undefined
                ? { description: input.description }
                : {}),
              ...(input.archived !== undefined
                ? { archived: input.archived }
                : {}),
              ...this.op.changed(s),
            },
          }),
        );
      },
    );
  }
  detail(actor: RequestActor, id: string, scopeId: string, target: string) {
    return this.read(actor, id, scopeId, async (s) =>
      this.documentView(s, await this.document(s, target)),
    );
  }
  async documentsIn(
    s: StaffContext,
    q: { search?: string | undefined; folderId?: string | undefined } = {},
  ) {
    const rows = await s.tx.companyKnowledgeDocument.findMany({
      where: {
        ...this.op.where(s),
        ...(q.folderId ? { folderId: q.folderId } : {}),
      },
      take: 1001,
    });
    if (rows.length > 1000) throw new PayloadTooLargeException();
    const out = [];
    for (const row of rows) {
      try {
        const d = await this.document(s, row.id),
          view = await this.documentView(s, d);
        let filename = '';
        if (d.publishedVersionId) {
          const { f } = await this.version(s, d.id, d.publishedVersionId);
          filename = f.filename;
        }
        if (
          !q.search ||
          [view.title, view.description ?? '', filename].some((v) =>
            v.toLocaleLowerCase().includes(q.search!.toLocaleLowerCase()),
          )
        )
          out.push(view);
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    return out;
  }
  documents(
    actor: RequestActor,
    id: string,
    scopeId: string,
    q: z.infer<typeof c.CompanyKnowledgeQuerySchema>,
  ) {
    return this.read(actor, id, scopeId, (s) =>
      this.op.page(
        s,
        'knowledge.documents:' +
          JSON.stringify({ search: q.search, folderId: q.folderId }),
        q,
        () => this.documentsIn(s, q),
      ),
    );
  }
  versions(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    q: z.infer<typeof c.CompanyStaffPageQuerySchema>,
  ) {
    return this.read(actor, id, scopeId, async (s) => {
      await this.document(s, documentId);
      return this.op.page(
        s,
        'knowledge.versions:' + documentId,
        q,
        async () => {
          const rows = await s.tx.companyKnowledgeVersion.findMany({
            where: {
              ...this.op.where(s),
              documentId,
              ...(!this.manager(s) ? { publishedAt: { not: null } } : {}),
            },
            take: 1001,
          });
          if (rows.length > 1000) throw new PayloadTooLargeException();
          const out = [];
          for (const v of rows) {
            const { f } = await this.version(s, documentId, v.id);
            if (f.status !== 'DELETED') out.push(this.versionView(v, f));
          }
          return out;
        },
      );
    });
  }
  getVersion(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    target: string,
  ) {
    return this.read(actor, id, scopeId, async (s) => {
      const { v, f } = await this.version(s, documentId, target);
      return this.versionView(v, f);
    });
  }
  initiate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    input: z.infer<typeof c.CompanyKnowledgeVersionCreateSchema>,
    key?: string,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'version.create',
      input.id,
      async (s) => {
        const d = await this.document(s, documentId, true);
        const r = await this.op.once(
          s,
          'company.knowledge.version',
          key,
          { documentId, input },
          async () => {
            await this.op.growth(
              s,
              'company.knowledge-version',
              await s.tx.companyKnowledgeVersion.count({
                where: { ...this.op.where(s), documentId },
              }),
            );
            await s.change();
            await this.files.initiate(
              s.tx,
              this.fileScope(s),
              input.id,
              input,
              s.now,
            );
            return s.tx.companyKnowledgeVersion.create({
              data: {
                ...this.op.where(s),
                id: input.id,
                documentId,
                fileId: input.id,
                uploaderAccessId: s.me.accessId,
                uploaderGeneration: s.me.generation,
                title: d.title,
                description: d.description,
              },
            });
          },
        );
        const { v, f } = await this.version(s, documentId, r.id);
        return this.versionView(v, f);
      },
      'company.knowledge-version',
    );
  }
  publish(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    target: string,
    revision: number,
    input: z.infer<typeof c.CompanyKnowledgePublishSchema>,
  ) {
    return this.write(
      actor,
      id,
      scopeId,
      'version.publish',
      target,
      async (s) => {
        const { d, v, f } = await this.version(s, documentId, target);
        this.op.match(f.revision, revision);
        this.op.match(d.revision, input.documentRevision);
        if (v.publishedAt) throw new ConflictException();
        await this.document(s, documentId, true);
        if (f.status !== 'READY' || !f.sha256) throw new ConflictException();
        await s.change();
        const published = await s.tx.companyKnowledgeVersion.update({
          where: { id: target },
          data: {
            publishedAt: s.now,
            pinnedRevision: f.revision,
            pinnedHash: f.sha256,
            ...this.op.changed(s),
          },
        });
        await s.tx.companyKnowledgeDocument.update({
          where: { id: documentId },
          data: { publishedVersionId: target, ...this.op.changed(s) },
        });
        return this.versionView(published, f);
      },
    );
  }
}
