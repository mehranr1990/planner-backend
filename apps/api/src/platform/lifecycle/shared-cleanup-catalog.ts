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
// SocialLoan.dueProposedByUserId is SET NULL.
// P6-05 (0081) adds 13 Social goal edges (1,147 total). SocialGoal CASCADEs from
// its one SocialGroup or SocialActivity; participants, entries and history
// CASCADE from the goal through same-goal composite keys. User edges are
// SET NULL and never block Personal erasure. Future FK changes fail closed.
// ADR 0068 (0085) adds one edge (1,148 total): StoredFileScan CASCADEs from its
// StoredFile, so Shared STORAGE purge and Personal Space erasure remove the
// verdict with the file row. It references no User, Space or custody content.
export const SHARED_CLEANUP_FK_SHA256 =
  // Platform Admin adds ten edges (1,169 total): four independent Admin identity/audit
  // references and six P1 attribution/initiation/receipt/delivery references. Delivery
  // cascades on User erasure; invitation/handover attribution is removed with its
  // existing owner-controlled records. No new FK points into ordinary work content.
  // M098 makes only nine enumerated locator FKs DEFERRABLE INITIALLY IMMEDIATE;
  // delete actions/order are unchanged. Root-wide transfer disposal stays fenced.
  // P2 adds 17 references (1,186 FKs): Admin approval/alert/retention ownership,
  // typed deletion review subjects (SET NULL on User/Team/Company removal),
  // immutable Admin request history, and AccountDeletionJob provenance. These
  // neither broaden cleanup custody nor retain the erased User/Team/Company.
  // P3 adds twelve references confined to Admin identities, operational policy,
  // incidents and backup reviews (1,198 FKs). No edge enters customer custody.
  // Client completion adds eight reviewed edges (1,206 total): Personal habit
  // reminder cascade; Company invitation supervisor snapshots removed with offers
  // before memberships; push attempts cascade from their typed offer, subscription
  // or recipient. No independent content gains a new retention dependency.
  // P4 adds 43 explicit references (1,249 FKs): ticket content/receipts/notices
  // cascade with the ticket/user; evidence detaches for durable blob cleanup;
  // reported sources and operators SET NULL. No FK blocks source-owner erasure.
  // P5 adds 61 edges (1,310 total). Financial history references pseudonymous
  // customers; live Space/scope/evidence/actor references detach, user receipts
  // and grants cascade. No new reference retains customer work content.
  // P6 adds 13 edges (1,323 total). Typed targets SET NULL on erasure/custody
  // purge. All other edges join configuration/approval evidence, never content.
  // M123 adds two configuration/approval-only release-schedule references.
  'bfd87eee40804a75865e0a2c88a9edaca6e1bde241ca34bae153172c2a56c9eb';
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
