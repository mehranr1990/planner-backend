import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
// Reviewed through the 2026-11-13 backend completion (878 FKs): Team completion
// (35, TeamCleanupService), Meeting minutes attribution (2; meeting-cleanup
// deletes actions/decisions before admissions), Company completion (19,
// CompanyCleanupService) and backend completion (45: 32 Team rows deleted by
// TeamCleanupService before members/actors, Task/Goal links cascade; 13 Company
// reason/request rows deleted before their events, budgets and adjustments)
// and the TM-11 Team file library (13: versions, files, then leaf folders are
// deleted in TEAM_CONTENT before StoredFile rows are purged in STORAGE) and the
// gap closure (55: Messaging/Meetings rows deleted by their cleanups, Company rows
// in COMPANY_CONTENT before their sources, Brain Dump via the Personal Space cascade)
// and the final closure (5: CompanyContextMove rows deleted in COMPANY_CONTENT
// before units, departments and actors, CompanyRoomBookingTitle before
// allocations; 951 FKs).
// Personal gap closure adds two same-space Routine references (953 FKs):
// RoutineExecution and Reminder cascade from Routine. Routine's owner-composite
// Space FK restricts it to Personal custody; neither edge joins shared content.
// Shared deletion ownership/order is unchanged. Personal erasure follows the
// existing Routine/Space cascade, including executions and reminder derivatives.
// Project gap closure adds 15 reviewed FKs (968 total): TaskWorkflowDraft is
// removed in TASKS before workflows, scopes and actors; ProjectRegisterDetail
// before risk/issue sources and Task associations; risk comments/activity before
// register rows; ProjectFileVersion before files, files before leaf-first folders.
// Team links retain independent Project custody. No parent-owned finance is purged.
// Key namespaces add two typed User/Team references (970): Project disposal removes
// the referencing row. Team deletion atomically rehomes its Projects' namespaces
// to their current owners; a collision blocks deletion without renaming data.
// Personal identity erasure clears the account namespace with SET NULL and a
// typed ERASED-owner tombstone; retained Projects never block account erasure.
// Future FK changes still fail closed until reviewed.
export const SHARED_CLEANUP_FK_SHA256 =
  '277ebbfeb7671c28d683c198a4eb9c0c3b2d7db7833c5e6db537f20be2a79fb1';
export async function assertSharedCleanupCatalog(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<
    { table: string; name: string; target: string; definition: string }[]
  >`SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=(SELECT relnamespace FROM pg_class WHERE oid=to_regclass('"Space"'))`;
  const canonical = rows.map((r) => ({
    table: r.table,
    name: r.name,
    target: r.target,
    definition: r.definition,
  }));
  canonical.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
  if (digest !== SHARED_CLEANUP_FK_SHA256)
    throw new ConflictException({
      code: 'UNREVIEWED_SHARED_CLEANUP_REFERENCE',
    });
}
