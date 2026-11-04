import { createHash } from 'node:crypto';
export const taskToolsMigrationHashes: Readonly<Record<string, string>> = {
  '202611040012_task_tool_publication_updates':
    '4c99ee9a4ffd329e7965d610b0723821625d9f6a87ba4e1ab9431092b17df20a',
  '202611040010_task_fields_and_dependencies':
    'ce23cdddf3a4a3578ee19cb187b19c1f786cd8b42851d22567c70e74258bdc9b',
  '202611040011_task_workflows':
    '1b3815e71697d9cfce5847bf2134108d61ffb86220ea297d77ae134096e82629',
};
/** M07 review: scoped typed links, immutable publications, bounded graph and additive usage keys. */
export function assertReviewedTaskToolsMigration(name: string, sql: string) {
  if (
    !taskToolsMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      taskToolsMigrationHashes[name]
  )
    throw new Error('Unreviewed Task tools migration name or bytes');
}
