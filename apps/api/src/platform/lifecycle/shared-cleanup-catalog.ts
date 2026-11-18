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
// P4-GAP-CLOSURE adds 97 typed Company edges (1,067 total). CompanyCleanupService
// removes private revisions/actions before reviews/cycles and one-on-ones; custody,
// maintenance, observations, grant assignments and recovery drafts before their
// members/resources; alert occurrences before rules/budgets; financial events and
// approvals before delegations/policies. No new User FK blocks Personal erasure.
// P5-GAP-CLOSURE adds four typed edges (1,071 total): schedules are removed
// before announcement versions and source intervals; immutable agenda revisions
// are removed under the actual lifecycle claim before entries and admissions.
// None references User or Personal custody.
// P6-02/P6-03 (ADR 0060) adds 36 Social edges (1,107 total). Activity, notice,
// expense, settlement and audit rows CASCADE from SocialGroup/SocialActivity, so
// the existing Space→SocialGroup purge removes them in one cascade; intra-Activity
// composite edges are NO ACTION/deferrable inside that cascade. User edges are
// SET NULL (notices CASCADE) and never block Personal erasure.
// ADR 0060-0062 gap closure adds two edges (1,109 total): the Activity nominee
// reference is same-Activity, deferrable NO ACTION inside the Activity cascade;
// FinanceExternalPosting cascades from its Personal Transaction (Space cascade on
// erasure). Neither joins shared custody content.
// P6-04 adds 22 lending/Lost & Found edges (1,131 total). SocialAsset.groupId is
// SET NULL (a purge detaches personally owned assets); Group Lost & Found posts
// CASCADE from SocialGroup with their claims, events and evidence; loans reference
// assets NO ACTION (assets are never deleted). User edges are SET NULL and never
// block Personal erasure.
// P6-04 gap closure (0080) adds 3 edges (1,134 total): SocialNotice.loanId and
// .lostFoundReportId CASCADE from their (never deleted, or Group-cascaded) parent;
// SocialLoan.dueProposedByUserId is SET NULL. Future FK changes fail closed.
export const SHARED_CLEANUP_FK_SHA256 =
  'd0e57df1823d173ab9dc8141da93b39ffa6129dbe5672f0dca42a2c6a4526400';
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
