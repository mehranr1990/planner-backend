import {
  companyScopeCustodyMigrationName,
  assertReviewedCompanyScopeCustodyMigration,
} from './reviewed-company-scope-custody-migration.ts';
import {
  domainScopeKeysMigrationName,
  assertReviewedDomainScopeKeysMigration,
} from './reviewed-domain-scope-keys-migration.ts';
import {
  scopedLifecycleJobsMigrationName,
  assertReviewedScopedLifecycleJobsMigration,
} from './reviewed-scoped-lifecycle-jobs-migration.ts';
import {
  companyAssociationsMigrationName,
  assertReviewedCompanyAssociationsMigration,
} from './reviewed-company-associations-migration.ts';
import {
  companyLifecycleMigrationName,
  assertReviewedCompanyLifecycleMigration,
} from './reviewed-company-lifecycle-migration.ts';
import {
  companyKnowledgeMigrationName,
  assertReviewedCompanyKnowledgeMigration,
} from './reviewed-company-knowledge-migration.ts';
import {
  companySettlementsMigrationName,
  assertReviewedCompanySettlementsMigration,
} from './reviewed-company-settlements-migration.ts';
import {
  companyFinanceMigrationName,
  assertReviewedCompanyFinanceMigration,
} from './reviewed-company-finance-migration.ts';
import {
  companyStaffMigrationName,
  assertReviewedCompanyStaffMigration,
} from './reviewed-company-staff-migration.ts';
import {
  companySnapshotsName,
  assertReviewedCompanySnapshots,
} from './reviewed-company-invitation-snapshots.ts';
import {
  companyFoundationMigrationName,
  assertReviewedCompanyFoundationMigration,
} from './reviewed-company-foundation-migration.ts';
import {
  teamCalendarOrderName,
  assertReviewedTeamCalendarOrder,
} from './reviewed-team-work-migration.ts';
import {
  teamWorkMigrationName,
  assertReviewedTeamWorkMigration,
} from './reviewed-team-work-migration.ts';
import {
  teamReferenceUsageName,
  assertReviewedTeamReferenceUsage,
} from './reviewed-teams-migration.ts';
import {
  teamsMigrationName,
  assertReviewedTeamsMigration,
} from './reviewed-teams-migration.ts';
import {
  localSecurityMigrationName,
  assertReviewedLocalSecurityMigration,
} from './reviewed-local-security-migration.ts';
import {
  reviewedFinanceMigrationName,
  assertReviewedFinanceMigration,
} from './reviewed-finance-migration.ts';
import {
  reviewedVoiceMigrationName,
  assertReviewedVoiceMigration,
} from './reviewed-voice-migration.ts';
import fs from 'node:fs';
import {
  companyDomainRepresentationMigrationName,
  assertReviewedCompanyDomainRepresentationMigration,
} from './reviewed-company-domain-representation-migration.ts';
import {
  projectCollaborationMigrationHashes,
  assertReviewedProjectCollaborationMigration,
} from './reviewed-project-collaboration-migrations.ts';
import {
  projectExecutionMigrationHashes,
  assertReviewedProjectExecutionMigration,
} from './reviewed-project-execution-migrations.ts';
import {
  taskToolsMigrationHashes,
  assertReviewedTaskToolsMigration,
} from './reviewed-task-tools-migrations.ts';
import {
  assignmentMigrationName,
  assertReviewedAssignmentMigration,
} from './reviewed-assignment-migration.ts';
import {
  projectMigrationHashes,
  assertReviewedProjectMigration,
} from './reviewed-project-migration.ts';
import {
  reviewedRewardsMigrationName,
  assertReviewedRewardsMigration,
} from './reviewed-rewards-migration.ts';
import path from 'node:path';
import {
  collaborationMigrationName,
  assertReviewedCollaborationMigration,
} from './reviewed-collaboration-migration.ts';
import {
  sharedKernelMigrations,
  assertReviewedSharedKernel,
} from './reviewed-shared-kernel.ts';

/** Conservative review gate, not a general SQL parser. Unrecognized migration forms need owner review. */
export function assertAdditiveMigration(sql: string): void {
  if (/\$[a-zA-Z_0-9]*\$/.test(sql))
    throw new Error('Procedural SQL requires explicit migration review.');
  const code = sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) =>
      token.startsWith('--') || token.startsWith('/*')
        ? ''
        : token.startsWith('"')
          ? 'identifier'
          : 'literal',
  );
  const statements = code
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  // A single outer transaction adds atomicity; inspect every enclosed statement normally.
  if (
    /^BEGIN$/i.test(statements[0] ?? '') &&
    /^COMMIT$/i.test(statements.at(-1) ?? '')
  ) {
    statements.shift();
    statements.pop();
  }
  if (
    !statements.length ||
    statements.some(
      (statement) =>
        /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/.test(
          statement
            .toUpperCase()
            .replace(
              /ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)/gi,
              '',
            ),
        ) ||
        !/^(?:CREATE\s+(?:TABLE|TYPE|(?:UNIQUE\s+)?INDEX|SCHEMA\s+IF\s+NOT\s+EXISTS)\b|ALTER\s+TABLE\s+identifier\s+ADD\s+(?:COLUMN|CONSTRAINT)\b)/i.test(
          statement,
        ),
    )
  )
    throw new Error(
      'Empty, destructive or unreviewed migration requires explicit owner approval.',
    );
}

export function reviewMigrations(directory = 'prisma/migrations'): string[] {
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.length) throw new Error('No reviewed migrations found.');
  for (const name of names) {
    const sql = fs.readFileSync(
      path.join(directory, name, 'migration.sql'),
      'utf8',
    );
    if (name === messagingMigrationName)
      assertReviewedMessagingMigration(name, sql);
    else if (name === companyDomainRepresentationMigrationName)
      assertReviewedCompanyDomainRepresentationMigration(name, sql);
    else if (name === scopedLifecycleJobsMigrationName)
      assertReviewedScopedLifecycleJobsMigration(name, sql);
    else if (name === domainScopeKeysMigrationName)
      assertReviewedDomainScopeKeysMigration(name, sql);
    else if (name === companyScopeCustodyMigrationName)
      assertReviewedCompanyScopeCustodyMigration(name, sql);
    else if (name === companyAssociationsMigrationName)
      assertReviewedCompanyAssociationsMigration(name, sql);
    else if (name === companyLifecycleMigrationName)
      assertReviewedCompanyLifecycleMigration(name, sql);
    else if (name === companyKnowledgeMigrationName)
      assertReviewedCompanyKnowledgeMigration(name, sql);
    else if (name === companySettlementsMigrationName)
      assertReviewedCompanySettlementsMigration(name, sql);
    else if (name === companyFinanceMigrationName)
      assertReviewedCompanyFinanceMigration(name, sql);
    else if (name === companyStaffMigrationName)
      assertReviewedCompanyStaffMigration(name, sql);
    else if (name === companySnapshotsName)
      assertReviewedCompanySnapshots(name, sql);
    else if (name === companyFoundationMigrationName)
      assertReviewedCompanyFoundationMigration(name, sql);
    else if (name === teamLifecycleMigrationName)
      assertReviewedTeamLifecycleMigration(name, sql);
    else if (name === teamInteractionsMigrationName)
      assertReviewedTeamInteractionsMigration(name, sql);
    else if (name === teamCapacityMigrationName)
      assertReviewedTeamCapacityMigration(name, sql);
    else if (name === teamCalendarOrderName)
      assertReviewedTeamCalendarOrder(name, sql);
    else if (name === teamWorkMigrationName)
      assertReviewedTeamWorkMigration(name, sql);
    else if (name === teamReferenceUsageName)
      assertReviewedTeamReferenceUsage(name, sql);
    else if (name === teamsMigrationName)
      assertReviewedTeamsMigration(name, sql);
    else if (name === localSecurityMigrationName)
      assertReviewedLocalSecurityMigration(name, sql);
    else if (Object.hasOwn(projectCollaborationMigrationHashes, name))
      assertReviewedProjectCollaborationMigration(name, sql);
    else if (Object.hasOwn(projectExecutionMigrationHashes, name))
      assertReviewedProjectExecutionMigration(name, sql);
    else if (Object.hasOwn(taskToolsMigrationHashes, name))
      assertReviewedTaskToolsMigration(name, sql);
    else if (name === assignmentMigrationName)
      assertReviewedAssignmentMigration(name, sql);
    else if (Object.hasOwn(projectMigrationHashes, name))
      assertReviewedProjectMigration(name, sql);
    else if (name === collaborationMigrationName)
      assertReviewedCollaborationMigration(name, sql);
    else if (Object.hasOwn(sharedKernelMigrations, name))
      assertReviewedSharedKernel(name, sql);
    else if (name === reviewedVoiceMigrationName)
      assertReviewedVoiceMigration(name, sql);
    else if (name === reviewedFinanceMigrationName)
      assertReviewedFinanceMigration(name, sql);
    else if (name === reviewedRewardsMigrationName)
      assertReviewedRewardsMigration(name, sql);
    else assertAdditiveMigration(sql);
  }
  return names;
}

import {
  teamCapacityMigrationName,
  assertReviewedTeamCapacityMigration,
} from './reviewed-team-capacity-migration.ts';

import {
  teamInteractionsMigrationName,
  assertReviewedTeamInteractionsMigration,
} from './reviewed-team-interactions-migration.ts';

import {
  teamLifecycleMigrationName,
  assertReviewedTeamLifecycleMigration,
} from './reviewed-team-lifecycle-migration.ts';
import {
  messagingMigrationName,
  assertReviewedMessagingMigration,
} from './reviewed-messaging-migration.ts';
