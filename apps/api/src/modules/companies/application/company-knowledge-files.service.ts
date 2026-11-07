import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type {
  CompanyKnowledgeVersion,
  StoredFile,
} from '../../../generated/prisma/client.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { CompanyKnowledgeService } from './company-knowledge.service.js';
import type { StaffContext } from './company-staff.context.js';
@Injectable()
export class CompanyKnowledgeFilesService {
  private readonly active = new Map<
    string,
    { abort: AbortController; finished: Promise<void> }
  >();
  constructor(
    @Inject(CompanyKnowledgeService)
    private readonly knowledge: CompanyKnowledgeService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private view(v: CompanyKnowledgeVersion, f: StoredFile) {
    return this.knowledge.versionView(v, f);
  }
  private async row(
    s: StaffContext,
    documentId: string,
    target: string,
    write = false,
  ) {
    const { v, f } = await this.knowledge.version(s, documentId, target, write);
    return { r: v, f };
  }
  async complete(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    target: string,
    revision: number,
    source: Readable,
    length: string | undefined,
  ) {
    const ticket = await this.knowledge.write(
      actor,
      id,
      scopeId,
      'file.claim',
      target,
      async (s) => {
        const { r, f } = await this.row(s, documentId, target, true);
        if (f.status === 'READY') return { view: this.view(r, f) };
        this.knowledge.op.match(f.revision, revision);
        await s.change();
        return {
          ticket: await this.files.claim(
            s.tx,
            this.knowledge.fileScope(s),
            f.id,
            s.now,
          ),
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
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active.set(target, { abort, finished });
    try {
      const evidence = await this.files.write(
        ticket.ticket,
        source,
        length,
        abort.signal,
      );
      return await this.knowledge.write(
        actor,
        id,
        scopeId,
        'file.ready',
        target,
        async (s) => {
          const { r } = await this.row(s, documentId, target, true);
          await s.change();
          const f = await this.files.ready(
            s.tx,
            this.knowledge.fileScope(s),
            ticket.ticket,
            evidence,
            s.now,
          );
          return this.view(r, f);
        },
      );
    } catch (error) {
      await this.knowledge
        .write(actor, id, scopeId, 'file.reject', target, async (s) => {
          await this.row(s, documentId, target, true);
          await s.change();
          await this.files.reject(
            s.tx,
            this.knowledge.fileScope(s),
            target,
            ticket.ticket.attempt,
          );
        })
        .catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      finish();
      this.active.delete(target);
    }
  }
  async download(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    target: string,
  ) {
    const first = await this.knowledge.read(actor, id, scopeId, async (s) =>
      this.row(s, documentId, target),
    );
    const stream = await this.files.open(first.f);
    try {
      await this.knowledge.read(actor, id, scopeId, async (s) => {
        const current = await this.row(s, documentId, target);
        if (
          current.f.revision !== first.f.revision ||
          current.f.status !== 'READY'
        )
          throw new NotFoundException();
        await this.knowledge.op.audit(s, target, 'company.knowledge.file.read');
      });
      return { stream, file: first.f };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  async remove(
    actor: RequestActor,
    id: string,
    scopeId: string,
    documentId: string,
    target: string,
    revision: number,
  ) {
    const file = await this.knowledge.write(
      actor,
      id,
      scopeId,
      'file.delete',
      target,
      async (s) => {
        const { r, f } = await this.row(s, documentId, target);
        if (r.publishedAt) throw new ConflictException();
        await this.knowledge.document(s, documentId, true);
        await s.change();
        return this.files.deleted(
          s.tx,
          this.knowledge.fileScope(s),
          f.id,
          revision,
          s.now,
        );
      },
    );
    const active = this.active.get(target);
    if (active) {
      active.abort.abort();
      await active.finished;
    }
    await this.files.remove(file);
    return this.knowledge.write(
      actor,
      id,
      scopeId,
      'file.cleanup',
      target,
      async (s) => {
        const { r, f } = await this.row(s, documentId, target);
        await s.change();
        await this.files.cleanupFinished(
          s.tx,
          this.knowledge.fileScope(s),
          target,
          file.uploadAttemptId,
        );
        return this.view(r, f);
      },
    );
  }
  async reconcile(actor: RequestActor, id: string, scopeId: string) {
    const rows = await this.knowledge.write(
      actor,
      id,
      scopeId,
      'file.reconcile',
      scopeId,
      async (s) => {
        this.knowledge.op.manage(s);
        const scope = this.knowledge.fileScope(s);
        const cutoff = new Date(
          s.now.getTime() - this.config.FILE_UPLOAD_TIMEOUT_MS - 30000,
        );
        const ids = (
          await s.tx.companyKnowledgeVersion.findMany({
            where: {
              ...this.knowledge.op.where(s),
              file: {
                is: {
                  purgedAt: null,
                  OR: [
                    { status: 'INITIATED', uploadExpiresAt: { lt: cutoff } },
                    { status: { in: ['REJECTED', 'DELETED'] } },
                  ],
                  AND: [
                    {
                      OR: [
                        { uploadStartedAt: null },
                        { uploadStartedAt: { lt: cutoff } },
                      ],
                    },
                  ],
                },
              },
            },
            select: { fileId: true },
            orderBy: { id: 'asc' },
            take: 25,
          })
        ).map((r) => r.fileId);
        const candidates = await this.files.reconcile(
          s.tx,
          scope,
          s.now,
          false,
          ids,
        );
        if (!candidates.length) return [];
        await s.change();
        return this.files.reconcile(s.tx, scope, s.now, true, ids);
      },
    );
    for (const row of rows) {
      const active = this.active.get(row.id);
      if (active) {
        active.abort.abort();
        await active.finished;
      }
      await this.files.remove(row);
      await this.knowledge.write(
        actor,
        id,
        scopeId,
        'file.cleanup',
        row.id,
        async (s) => {
          this.knowledge.op.manage(s);
          await s.change();
          await this.files.cleanupFinished(
            s.tx,
            this.knowledge.fileScope(s),
            row.id,
            row.uploadAttemptId,
          );
        },
      );
    }
    return { cleaned: rows.length };
  }
}
