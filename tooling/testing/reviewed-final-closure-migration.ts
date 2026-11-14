import { createHash } from 'node:crypto';
// Final Phase 1–5 closure (2026-11-14): nullable Personal Task category (B4
// estimates; the productivity audit may name it), optional room booking
// titles, the CompanyContextMove record (OD-5) and company_domain_guard()
// allowing a unit's departmentId to change only to its recorded move.
export const finalClosureMigrationName = '202611140054_final_closure';
export const finalClosureMigrationHash =
  '5c4644805e7e79550d27b956af028e3fdd649c7c6b6120cebc585ca70907f21c';
export function assertReviewedFinalClosureMigration(name: string, sql: string) {
  if (
    name !== finalClosureMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== finalClosureMigrationHash
  )
    throw Error('Unreviewed final closure migration');
}
