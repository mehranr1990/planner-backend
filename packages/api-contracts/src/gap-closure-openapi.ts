import * as c from './index.js';
import { ProjectPageQuerySchema } from './projects.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
import type { Operation } from './team-completion-openapi.js';
const empty = c.BackendCompletionEmptySchema,
  team = '/teams/{id}',
  ctx = '/companies/{id}/contexts/{scopeId}',
  co = '/companies/{id}',
  file = co + '/employee-files/{subjectAccessId}',
  page = ctx + '/knowledge/documents/{documentId}/page',
  dump = '/brain-dump/pages/{period}';
const post = (
  path: string,
  output: Operation['output'],
  input: Operation['input'] = empty,
  extra: Partial<Operation> = {},
): Operation => ({
  path,
  method: 'post',
  output,
  input,
  status: 200,
  ...extra,
});
export const gapClosureOperations: Operation[] = [
  // Team checklists, dependencies, readiness, export
  {
    path: team + '/tasks/{sourceId}/checklist',
    method: 'get',
    output: c.TeamChecklistSchema,
    etag: true,
  },
  post(
    team + '/tasks/{sourceId}/checklist',
    c.TeamChecklistSchema,
    c.TeamChecklistChangeSchema,
    { revision: true, etag: true },
  ),
  {
    path: team + '/dependencies',
    method: 'get',
    output: c.DependencyGraphSchema,
  },
  {
    path: team + '/dependencies',
    method: 'post',
    output: c.DependencySchema,
    input: c.DependencyInputSchema,
    etag: true,
  },
  post(
    team + '/dependencies/{dependencyId}/retire',
    c.DependencySchema,
    empty,
    { revision: true, etag: true },
  ),
  {
    path: team + '/task-readiness',
    method: 'get',
    output: c.TeamTaskReadinessSchema,
  },
  post(team + '/exports', c.TeamExportSchema),
  // Messaging (OD-10, OD-11)
  {
    path: '/conversations/{id}/settings',
    method: 'get',
    output: c.ConversationSettingsSchema,
  },
  {
    path: '/conversations/{id}/settings',
    method: 'patch',
    output: c.ConversationSettingsSchema,
    input: c.ConversationSettingsPatchSchema,
    revision: true,
  },
  {
    path: '/conversations/{id}/preferences',
    method: 'patch',
    output: c.ConversationSettingsSchema,
    input: c.ConversationPreferencesPatchSchema,
    revision: true,
  },
  {
    path: '/conversations/{id}/reports',
    method: 'post',
    output: c.ConversationReportSchema,
    input: c.ConversationReportCreateSchema,
  },
  {
    path: '/conversations/{id}/reports',
    method: 'get',
    output: c.ConversationReportListSchema,
  },
  post(
    '/conversations/{id}/reports/{reportId}/resolve',
    c.ConversationReportSchema,
    c.ConversationReportResolveSchema,
    { revision: true },
  ),
  {
    path: '/messaging/search',
    method: 'get',
    output: c.GlobalMessageSearchPageSchema,
    query: c.GlobalMessageSearchQuerySchema,
  },
  // Meetings and announcements (OD-12, OD-13)
  {
    path: '/meetings/{id}/busy-visibility',
    method: 'put',
    output: c.MeetingBusyVisibilitySchema,
    input: c.MeetingBusyVisibilityInputSchema,
    revision: true,
  },
  {
    path: '/meeting-busy',
    method: 'get',
    output: c.MeetingBusyListSchema,
    query: c.MeetingBusyQuerySchema,
  },
  post(
    '/announcements/{id}/versions/{versionId}/remind',
    c.AnnouncementRemindResultSchema,
  ),
  {
    path: '/announcement-reminders',
    method: 'get',
    output: c.AnnouncementReminderListSchema,
  },
  post(
    '/announcement-reminders/{reminderId}/read',
    c.AnnouncementReminderSchema,
  ),
  // Company goals (OD-2)
  {
    path: ctx + '/goals',
    method: 'get',
    output: c.CompanyGoalPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: ctx + '/goals',
    method: 'post',
    output: c.CompanyGoalSchema,
    input: c.CompanyGoalCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: ctx + '/goals/{goalId}',
    method: 'get',
    output: c.CompanyGoalSchema,
    etag: true,
  },
  {
    path: ctx + '/goals/{goalId}',
    method: 'patch',
    output: c.CompanyGoalSchema,
    input: c.CompanyGoalPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: ctx + '/goals/{goalId}/key-results',
    method: 'post',
    output: c.CompanyGoalSchema,
    input: c.CompanyKeyResultCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: ctx + '/goals/{goalId}/key-results/{keyResultId}',
    method: 'patch',
    output: c.CompanyKeyResultSchema,
    input: c.CompanyKeyResultPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: ctx + '/goals/{goalId}/key-results/{keyResultId}/checkins',
    method: 'post',
    output: c.CompanyKeyResultCheckinSchema,
    input: c.CompanyKeyResultCheckinCreateSchema,
    idempotency: true,
  },
  {
    path: ctx + '/goals/{goalId}/key-results/{keyResultId}/checkins',
    method: 'get',
    output: c.CompanyKeyResultCheckinPageSchema,
    query: ProjectPageQuerySchema,
  },
  // Rooms and utilization (OD-3)
  {
    path: ctx + '/resources/{resourceId}/room',
    method: 'put',
    output: c.CompanyRoomSchema,
    input: c.CompanyRoomProfileInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: ctx + '/rooms',
    method: 'get',
    output: c.CompanyRoomListSchema,
    query: c.CompanyRoomQuerySchema,
  },
  {
    path: ctx + '/reports/utilization',
    method: 'get',
    output: c.CompanyUtilizationSchema,
    query: c.CompanyUtilizationQuerySchema,
  },
  // Knowledge pages (OD-6)
  {
    path: page,
    method: 'get',
    output: c.KnowledgePageSchema,
    query: c.KnowledgePageQuerySchema,
    etag: true,
  },
  post(page + '/versions', c.KnowledgePageSchema, c.KnowledgePageSaveSchema, {
    revision: true,
    etag: true,
  }),
  post(page + '/publish', c.KnowledgePageSchema, c.KnowledgePagePublishSchema, {
    revision: true,
    etag: true,
  }),
  post(page + '/acknowledge', c.KnowledgePageSchema, empty, { etag: true }),
  {
    path: page + '/acknowledgements',
    method: 'get',
    output: c.KnowledgeAcknowledgementReportSchema,
  },
  post(page + '/remind', c.CompanyRemindResultSchema),
  {
    path: ctx + '/notifications',
    method: 'get',
    output: c.CompanyNotificationPageSchema,
    query: ProjectPageQuerySchema,
  },
  post(
    ctx + '/notifications/{notificationId}/read',
    c.CompanyNotificationSchema,
  ),
  // Payment runs (OD-7)
  {
    path: ctx + '/finance/payment-runs/eligible',
    method: 'get',
    output: c.PaymentRunEligibleSchema,
  },
  {
    path: ctx + '/finance/payment-runs',
    method: 'get',
    output: c.PaymentRunPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: ctx + '/finance/payment-runs',
    method: 'post',
    output: c.PaymentRunSchema,
    input: c.PaymentRunCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: ctx + '/finance/payment-runs/{runId}',
    method: 'get',
    output: c.PaymentRunSchema,
    etag: true,
  },
  post(
    ctx + '/finance/payment-runs/{runId}/confirm',
    c.PaymentRunSchema,
    c.PaymentRunConfirmSchema,
    { revision: true, etag: true },
  ),
  post(
    ctx + '/finance/payment-runs/{runId}/cancel',
    c.PaymentRunSchema,
    empty,
    { revision: true, etag: true },
  ),
  // Sealed employee files (OD-8 / C9)
  {
    path: co + '/employee-grants',
    method: 'get',
    output: c.EmployeeGrantListSchema,
  },
  {
    path: co + '/employee-grants',
    method: 'post',
    output: c.EmployeeGrantSchema,
    input: c.EmployeeGrantCreateSchema,
    idempotency: true,
  },
  post(co + '/employee-grants/{grantId}/revoke', c.EmployeeGrantSchema),
  { path: file, method: 'get', output: c.EmployeeFileSchema },
  post(file + '/access-requests', c.EmployeeFileRequestResultSchema),
  {
    path: file + '/documents',
    method: 'post',
    output: c.EmployeeDocumentSchema,
    input: c.EmployeeDocumentCreateSchema,
    idempotency: true,
    etag: true,
  },
  post(
    file + '/documents/{documentId}/complete',
    c.EmployeeDocumentSchema,
    empty,
    { revision: true, etag: true },
  ),
  {
    path: file + '/documents/{documentId}/download',
    method: 'get',
    output: c.EmployeeDocumentSchema,
  },
  post(
    file + '/documents/{documentId}/remove',
    c.EmployeeDocumentRemovedSchema,
    empty,
    { revision: true },
  ),
  { path: file + '/pack', method: 'get', output: c.EmployeeDocumentSchema },
  // Department transfer (OD-5)
  {
    path: co + '/department-transfers/preview',
    method: 'get',
    output: c.DepartmentTransferPreviewSchema,
    query: c.DepartmentTransferQuerySchema,
  },
  {
    path: co + '/department-transfers',
    method: 'post',
    output: c.DepartmentTransferSchema,
    input: c.DepartmentTransferCreateSchema,
    revision: true,
  },
  // Brain Dump (B3)
  {
    path: '/brain-dump/pages',
    method: 'get',
    output: c.BrainDumpPageListSchema,
  },
  { path: dump, method: 'get', output: c.BrainDumpPageSchema },
  {
    path: dump,
    method: 'put',
    output: c.BrainDumpPageSchema,
    input: c.BrainDumpSaveSchema,
  },
  {
    path: dump + '/lines',
    method: 'post',
    output: c.BrainDumpLineSchema,
    input: c.BrainDumpAddSchema,
  },
  post(dump + '/sort', c.BrainDumpPageSchema, c.BrainDumpSortSchema),
  post(dump + '/strike', c.BrainDumpPageSchema, c.BrainDumpStrikeSchema),
  post(dump + '/unsort', c.BrainDumpPageSchema, c.BrainDumpIdsSchema),
  post(dump + '/send-to-inbox', c.BrainDumpPageSchema, c.BrainDumpIdsSchema),
  post(dump + '/remove', c.BrainDumpRemovalSchema, c.BrainDumpIdsSchema),
  post(dump + '/restore', c.BrainDumpPageSchema, c.BrainDumpRestoreSchema),
  // Insights patterns (B4)
  {
    path: '/insights/patterns',
    method: 'get',
    output: c.InsightPatternResultSchema,
    query: c.InsightPatternQuerySchema,
  },
];
const binary = {
  'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
};
export function gapClosurePaths() {
  const paths = teamCompletionPaths(gapClosureOperations, {
    prefix: 'gapClosure',
    tag: 'gap-closure',
    description: 'Current authorized result',
  });
  const at = (p: string) =>
    paths['/api/v1' + p] as Record<string, Record<string, unknown>>;
  at(file + '/documents/{documentId}/complete').post!.requestBody = {
    required: true,
    content: binary,
  };
  for (const p of [file + '/documents/{documentId}/download', file + '/pack'])
    (at(p).get!.responses as Record<string, unknown>)['200'] = {
      description: 'Authorized private employee-file bytes',
      headers: {
        'Cache-Control': {
          schema: { type: 'string', const: 'private, no-store' },
        },
        'Content-Disposition': { schema: { type: 'string' } },
        'X-Content-Type-Options': {
          schema: { type: 'string', const: 'nosniff' },
        },
      },
      content: binary,
    };
  return paths;
}
