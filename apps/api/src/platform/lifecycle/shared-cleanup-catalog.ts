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
// Future FK changes still fail closed until reviewed.
export const SHARED_CLEANUP_FK_SHA256 =
  '5a2f9c1bf386bcc6448a84c4259db02b51077d8b522863fdfd93a5406a7912ec';
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
