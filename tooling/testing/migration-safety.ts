import {
  adminP7FinancialMigrationName,
  assertReviewedAdminP7FinancialMigration,
} from './reviewed-admin-p7-migration.ts';
import {
  adminP7ContextMigrationName,
  assertReviewedAdminP7ContextMigration,
} from './reviewed-admin-p7-migration.ts';
import {
  adminP7FenceMigrationName,
  assertReviewedAdminP7FenceMigration,
} from './reviewed-admin-p7-migration.ts';
import {
  adminP7OrderMigrationName,
  assertReviewedAdminP7OrderMigration,
} from './reviewed-admin-p7-migration.ts';
import {
  adminP7MigrationName,
  assertReviewedAdminP7Migration,
} from './reviewed-admin-p7-migration.ts';
import {
  adminP5ClosureMigrationName,
  assertReviewedAdminP5ClosureMigration,
} from './reviewed-admin-p5-migration.ts';
import {
  adminP5ClockMigrationName,
  assertReviewedAdminP5ClockMigration,
} from './reviewed-admin-p5-migration.ts';
import {
  adminP5MigrationName,
  assertReviewedAdminP5Migration,
} from './reviewed-admin-p5-migration.ts';
import {
  adminP4AudienceMigrationName,
  assertReviewedAdminP4AudienceMigration,
} from './reviewed-admin-p4-migration.ts';
import {
  adminP4PreferencesMigrationName,
  assertReviewedAdminP4PreferencesMigration,
} from './reviewed-admin-p4-migration.ts';
import {
  adminP4MigrationName,
  assertReviewedAdminP4Migration,
} from './reviewed-admin-p4-migration.ts';
import {
  retentionPolicyRecoveryMigrationName,
  assertReviewedRetentionPolicyRecoveryMigration,
} from './reviewed-retention-policy-recovery-migration.ts';
import {
  taskRestoreDeadlineMigrationName,
  assertReviewedTaskRestoreDeadlineMigration,
} from './reviewed-task-restore-deadline-migration.ts';
import {
  recoveryWindowMigrationName,
  assertReviewedRecoveryWindowMigration,
} from './reviewed-recovery-window-migration.ts';
import {
  socialGroupConversationMigrationName,
  assertReviewedSocialGroupConversationMigration,
} from './reviewed-social-group-conversation-migration.ts';
import {
  socialGoalNoticesMigrationName,
  assertReviewedSocialGoalNoticesMigration,
} from './reviewed-social-goal-notices-migration.ts';
import {
  socialLendingGapMigrationName,
  assertReviewedSocialLendingGapMigration,
} from './reviewed-social-lending-gap-migration.ts';
import {
  socialGapMigrationName,
  assertReviewedSocialGapMigration,
} from './reviewed-social-gap-migration.ts';
import {
  messagesMeetingsGapMigrationName,
  assertReviewedMessagesMeetingsGapMigration,
} from './reviewed-messages-meetings-gap-migration.ts';
import {
  companyGapMigrationHashes,
  assertReviewedCompanyGapMigration,
} from './reviewed-company-gap-migration.ts';
import {
  teamGapMigrationHashes,
  assertReviewedTeamGapMigration,
} from './reviewed-team-gap-migration.ts';
import {
  socialMigrationName,
  assertReviewedSocialMigration,
} from './reviewed-social-migration.ts';
import {
  communicationLifecycleMigrationName,
  assertReviewedCommunicationLifecycleMigration,
} from './reviewed-communication-lifecycle-migration.ts';
import {
  messagingMediaMigrationName,
  assertReviewedMessagingMediaMigration,
} from './reviewed-messaging-media-migration.ts';
import {
  meetingsMigrationName,
  assertReviewedMeetingsMigration,
} from './reviewed-meetings-migration.ts';
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
  projectGapMigrationHashes,
  assertReviewedProjectGapMigration,
} from './reviewed-project-gap-migrations.ts';
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
  adminP3MigrationName,
  assertReviewedAdminP3Migration,
} from './reviewed-admin-p3-migration.ts';
import {
  isAdminP2Migration,
  assertReviewedAdminP2Migration,
} from './reviewed-admin-p2-migration.ts';
import {
  adminP1MigrationName,
  teamScopedDisposalMigrationName,
  assertReviewedTeamScopedDisposalMigration,
  teamCompanyCustodyMigrationName,
  assertReviewedTeamCompanyCustodyMigration,
  teamCompanyCustodyProtocolMigrationName,
  assertReviewedTeamCompanyCustodyProtocolMigration,
  assertReviewedAdminP1Migration,
  adminInvitationDeliveryMigrationName,
  assertReviewedAdminInvitationDeliveryMigration,
} from './reviewed-admin-p1-migration.ts';
import {
  finalClosureMigrationName,
  assertReviewedFinalClosureMigration,
} from './reviewed-final-closure-migration.ts';
import {
  companyGoalSourceMigrationName,
  assertReviewedCompanyGoalSourceMigration,
} from './reviewed-company-goal-source-migration.ts';
import {
  companyCompletionMigrationName,
  assertReviewedCompanyCompletionMigration,
} from './reviewed-company-completion-migration.ts';
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
    if (name === adminP7FinancialMigrationName)
      assertReviewedAdminP7FinancialMigration(sql);
    else if (name === adminP7ContextMigrationName)
      assertReviewedAdminP7ContextMigration(sql);
    else if (name === adminP7FenceMigrationName)
      assertReviewedAdminP7FenceMigration(sql);
    else if (name === adminP7OrderMigrationName)
      assertReviewedAdminP7OrderMigration(sql);
    else if (name === adminP7MigrationName) assertReviewedAdminP7Migration(sql);
    else if (name === adminP6ScheduleMigrationName)
      assertReviewedAdminP6ScheduleMigration(sql);
    else if (name === adminP6MigrationName) assertReviewedAdminP6Migration(sql);
    else if (name === adminP5ClosureMigrationName)
      assertReviewedAdminP5ClosureMigration(sql);
    else if (name === adminP5ClockMigrationName)
      assertReviewedAdminP5ClockMigration(sql);
    else if (name === adminP5MigrationName) assertReviewedAdminP5Migration(sql);
    else if (name === adminP4AudienceMigrationName)
      assertReviewedAdminP4AudienceMigration(sql);
    else if (name === adminP4PreferencesMigrationName)
      assertReviewedAdminP4PreferencesMigration(sql);
    else if (name === adminP4MigrationName) assertReviewedAdminP4Migration(sql);
    else if (name === clientBackendMigrationName) {
      assertReviewedClientBackendMigration(sql);
      assertAdditiveMigration(sql);
    } else if (name === clientMaterializationMigrationName) {
      assertReviewedClientMaterializationMigration(sql);
      assertAdditiveMigration(sql);
    } else if (name === clientPushConsentMigrationName) {
      assertReviewedClientPushConsentMigration(sql);
      assertAdditiveMigration(sql);
    } else if (name === adminP3MigrationName)
      assertReviewedAdminP3Migration(sql);
    else if (isAdminP2Migration(name))
      assertReviewedAdminP2Migration(name, sql);
    else if (name === adminInvitationDeliveryMigrationName)
      assertReviewedAdminInvitationDeliveryMigration(sql);
    else if (name === adminP1MigrationName) assertReviewedAdminP1Migration(sql);
    else if (name === teamCompanyCustodyMigrationName)
      assertReviewedTeamCompanyCustodyMigration(sql);
    else if (name === teamCompanyCustodyProtocolMigrationName)
      assertReviewedTeamCompanyCustodyProtocolMigration(sql);
    else if (name === teamScopedDisposalMigrationName)
      assertReviewedTeamScopedDisposalMigration(sql);
    else if (name === retentionPolicyRecoveryMigrationName)
      assertReviewedRetentionPolicyRecoveryMigration(sql);
    else if (name === taskRestoreDeadlineMigrationName)
      assertReviewedTaskRestoreDeadlineMigration(sql);
    else if (name === recoveryWindowMigrationName)
      assertReviewedRecoveryWindowMigration(sql);
    else if (name === socialGroupConversationMigrationName)
      assertReviewedSocialGroupConversationMigration(sql);
    else if (name === socialGoalNoticesMigrationName)
      assertReviewedSocialGoalNoticesMigration(sql);
    else if (name === socialLendingGapMigrationName)
      assertReviewedSocialLendingGapMigration(sql);
    else if (name === socialGapMigrationName)
      assertReviewedSocialGapMigration(sql);
    else if (name === messagesMeetingsGapMigrationName)
      assertReviewedMessagesMeetingsGapMigration(sql);
    else if (Object.hasOwn(companyGapMigrationHashes, name))
      assertReviewedCompanyGapMigration(name, sql);
    else if (Object.hasOwn(teamGapMigrationHashes, name))
      assertReviewedTeamGapMigration(name, sql);
    else if (Object.hasOwn(projectGapMigrationHashes, name))
      assertReviewedProjectGapMigration(name, sql);
    else if (name === finalClosureMigrationName)
      assertReviewedFinalClosureMigration(name, sql);
    else if (name === companyGoalSourceMigrationName)
      assertReviewedCompanyGoalSourceMigration(name, sql);
    else if (name === companyCompletionMigrationName)
      assertReviewedCompanyCompletionMigration(name, sql);
    else if (name === socialMigrationName)
      assertReviewedSocialMigration(name, sql);
    else if (name === communicationLifecycleMigrationName)
      assertReviewedCommunicationLifecycleMigration(name, sql);
    else if (name === meetingsMigrationName)
      assertReviewedMeetingsMigration(name, sql);
    else if (name === messagingMediaMigrationName)
      assertReviewedMessagingMediaMigration(name, sql);
    else if (name === advancedMessagingMigrationName)
      assertReviewedAdvancedMessagingMigration(name, sql);
    else if (name === messagingMigrationName)
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
import {
  advancedMessagingMigrationName,
  assertReviewedAdvancedMessagingMigration,
} from './reviewed-advanced-messaging-migration.ts';
import {
  clientBackendMigrationName,
  assertReviewedClientBackendMigration,
  clientMaterializationMigrationName,
  assertReviewedClientMaterializationMigration,
  clientPushConsentMigrationName,
  assertReviewedClientPushConsentMigration,
} from './reviewed-client-backend-migration.ts';
import {
  adminP6MigrationName,
  assertReviewedAdminP6Migration,
  adminP6ScheduleMigrationName,
  assertReviewedAdminP6ScheduleMigration,
} from './reviewed-admin-p6-migration.ts';
