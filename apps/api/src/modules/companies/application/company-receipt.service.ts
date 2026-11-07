import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type {
  StoredFile,
  CompanyExpenseReceipt,
} from '../../../generated/prisma/client.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { CompanyFinanceService } from './company-finance.service.js';
import type { FinanceContext } from './company-finance.service.js';
import type { StaffPage } from './company-staff.context.js';
@Injectable()
export class CompanyReceiptService {
  private readonly active = new Map<
    string,
    { abort: AbortController; finished: Promise<void> }
  >();
  constructor(
    @Inject(CompanyFinanceService)
    private readonly finance: CompanyFinanceService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private view(r: CompanyExpenseReceipt, f: StoredFile) {
    return {
      id: r.id,
      spaceId: r.spaceId,
      scopeId: r.scopeId,
      versionId: r.versionId,
      fileId: r.fileId,
      filename: f.filename,
      mimeType: f.mimeType,
      expectedSize: f.expectedSize,
      actualSize: f.actualSize,
      status: f.status,
      sha256: f.sha256,
      pinnedRevision: r.pinnedRevision,
      pinnedHash: r.pinnedHash,
      revision: f.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  private async row(
    s: FinanceContext,
    expenseId: string,
    versionId: string,
    id: string,
    write = false,
  ) {
    const v = write
      ? await this.finance.mutable(s, expenseId, versionId)
      : await this.finance.version(s, expenseId, versionId);
    await this.finance.audience(s, v);
    const r = await s.tx.companyExpenseReceipt.findFirst({
      where: { ...this.finance.op.where(s), versionId, id },
    });
    if (!r) throw new NotFoundException();
    const f = await this.files.row(s.tx, this.finance.fileScope(s), r.fileId);
    if (
      r.pinnedRevision &&
      (f.status !== 'READY' ||
        f.revision !== r.pinnedRevision ||
        f.sha256 !== r.pinnedHash)
    )
      throw new ConflictException({ code: 'RECEIPT_EVIDENCE_CHANGED' });
    return { r, f };
  }
  list(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    versionId: string,
    q: StaffPage,
  ) {
    return this.finance.read(actor, id, scopeId, async (s) => {
      await this.finance.audience(
        s,
        await this.finance.version(s, expenseId, versionId),
      );
      return this.finance.op.page(
        s,
        'finance.receipts:' + versionId,
        q,
        async () => {
          const rows = await s.tx.companyExpenseReceipt.findMany({
            where: { ...this.finance.op.where(s), versionId },
          });
          const out = [];
          for (const r of rows) {
            const f = await this.files.row(
              s.tx,
              this.finance.fileScope(s),
              r.fileId,
            );
            if (f.status !== 'DELETED') out.push(this.view(r, f));
          }
          return out;
        },
      );
    });
  }
  initiate(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    versionId: string,
    input: z.infer<typeof c.CompanyExpenseReceiptCreateSchema>,
    key?: string,
  ) {
    return this.finance.write(
      actor,
      id,
      scopeId,
      'receipt.initiate',
      input.id,
      async (s) => {
        await this.finance.mutable(s, expenseId, versionId);
        const once = await this.finance.op.once(
          s,
          'company.finance.receipt',
          key,
          { expenseId, versionId, input },
          async () => {
            await this.finance.op.growth(
              s,
              'file.shared',
              await s.tx.companyExpenseReceipt.count({
                where: { ...this.finance.op.where(s), versionId },
              }),
            );
            await s.change();
            await this.files.initiate(
              s.tx,
              this.finance.fileScope(s),
              input.id,
              input,
              s.now,
            );
            await s.tx.companyExpenseReceipt.create({
              data: {
                ...this.finance.op.where(s),
                id: input.id,
                versionId,
                fileId: input.id,
              },
            });
            return { id: input.id };
          },
        );
        const { r, f } = await this.row(s, expenseId, versionId, once.id);
        return this.view(r, f);
      },
    );
  }
  async complete(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    versionId: string,
    receiptId: string,
    revision: number,
    source: Readable,
    length: string | undefined,
  ) {
    const ticket = await this.finance.write(
      actor,
      id,
      scopeId,
      'receipt.claim',
      receiptId,
      async (s) => {
        const { r, f } = await this.row(
          s,
          expenseId,
          versionId,
          receiptId,
          true,
        );
        if (f.status === 'READY') return { view: this.view(r, f) };
        this.finance.op.match(f.revision, revision);
        await s.change();
        return {
          ticket: await this.files.claim(
            s.tx,
            this.finance.fileScope(s),
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
    this.active.set(receiptId, { abort, finished });
    try {
      const evidence = await this.files.write(
        ticket.ticket,
        source,
        length,
        abort.signal,
      );
      return await this.finance.write(
        actor,
        id,
        scopeId,
        'receipt.ready',
        receiptId,
        async (s) => {
          const { r } = await this.row(
            s,
            expenseId,
            versionId,
            receiptId,
            true,
          );
          await s.change();
          const f = await this.files.ready(
            s.tx,
            this.finance.fileScope(s),
            ticket.ticket,
            evidence,
            s.now,
          );
          return this.view(r, f);
        },
      );
    } catch (error) {
      await this.finance
        .write(actor, id, scopeId, 'receipt.reject', receiptId, async (s) => {
          await this.row(s, expenseId, versionId, receiptId, true);
          await s.change();
          await this.files.reject(
            s.tx,
            this.finance.fileScope(s),
            receiptId,
            ticket.ticket.attempt,
          );
        })
        .catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      finish();
      this.active.delete(receiptId);
    }
  }
  async download(
    actor: RequestActor,
    id: string,
    scopeId: string,
    expenseId: string,
    versionId: string,
    receiptId: string,
  ) {
    const first = await this.finance.read(actor, id, scopeId, async (s) =>
      this.row(s, expenseId, versionId, receiptId),
    );
    const stream = await this.files.open(first.f);
    try {
      await this.finance.read(actor, id, scopeId, async (s) => {
        const current = await this.row(s, expenseId, versionId, receiptId);
        if (
          current.f.revision !== first.f.revision ||
          current.f.status !== 'READY'
        )
          throw new NotFoundException();
        await this.finance.op.audit(
          s,
          receiptId,
          'company.finance.receipt.read',
        );
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
    expenseId: string,
    versionId: string,
    receiptId: string,
    revision: number,
  ) {
    const file = await this.finance.write(
      actor,
      id,
      scopeId,
      'receipt.delete',
      receiptId,
      async (s) => {
        const { f } = await this.row(s, expenseId, versionId, receiptId, true);
        await s.change();
        return this.files.deleted(
          s.tx,
          this.finance.fileScope(s),
          f.id,
          revision,
          s.now,
        );
      },
    );
    const active = this.active.get(receiptId);
    if (active) {
      active.abort.abort();
      await active.finished;
    }
    await this.files.remove(file);
    return this.finance.write(
      actor,
      id,
      scopeId,
      'receipt.cleanup',
      receiptId,
      async (s) => {
        const { r, f } = await this.row(s, expenseId, versionId, receiptId);
        await s.change();
        await this.files.cleanupFinished(
          s.tx,
          this.finance.fileScope(s),
          receiptId,
          file.uploadAttemptId,
        );
        return this.view(r, f);
      },
    );
  }
  async reconcile(actor: RequestActor, id: string, scopeId: string) {
    const rows = await this.finance.write(
      actor,
      id,
      scopeId,
      'receipt.reconcile',
      scopeId,
      async (s) => {
        this.finance.op.manage(s);
        const scope = this.finance.fileScope(s);
        const candidates = await this.files.reconcile(
          s.tx,
          scope,
          s.now,
          false,
        );
        if (!candidates.length) return [];
        await s.change();
        return this.files.reconcile(s.tx, scope, s.now, true);
      },
    );
    for (const row of rows) {
      const active = this.active.get(row.id);
      if (active) {
        active.abort.abort();
        await active.finished;
      }
      await this.files.remove(row);
      await this.finance.write(
        actor,
        id,
        scopeId,
        'receipt.cleanup',
        row.id,
        async (s) => {
          this.finance.op.manage(s);
          await s.change();
          await this.files.cleanupFinished(
            s.tx,
            this.finance.fileScope(s),
            row.id,
            row.uploadAttemptId,
          );
        },
      );
    }
    return { cleaned: rows.length };
  }
}
