import type { ConfigurationBindingSchema } from '@mehran/api-contracts';
import type { z } from 'zod';
export type TrafficBinding = z.infer<typeof ConfigurationBindingSchema>;
export function trafficBinding(
  path: string,
  method: string,
): TrafficBinding | null {
  path = path.toLowerCase();
  method = method.toUpperCase();
  const part = path.replace(/^\/api\/v1\//, '').split('/')[0] ?? '';
  const aliases: Record<string, TrafficBinding['module']> = {
    auth: 'account',
    'brain-dump': 'capture',
    communications: 'notifications',
    push: 'notifications',
    reminders: 'notifications',
    moods: 'journal',
    productivity: 'tasks',
    search: 'notes',
    'announcement-reminders': 'meetings',
    announcements: 'meetings',
    'meeting-busy': 'meetings',
    'messaging-notifications': 'messaging',
    'conversation-invitations': 'messaging',
    'company-invitations': 'companies',
    'team-invitations': 'teams',
    'project-invitations': 'projects',
    'social-activities': 'social',
    'social-assets': 'social',
    'social-goals': 'social',
    'social-group-invitations': 'social',
    'social-groups': 'social',
    'social-loans': 'social',
    'social-lost-found': 'social',
    'social-notices': 'social',
    'invitation-notifications': 'spaces',
    invitations: 'spaces',
    'resource-invitations': 'spaces',
    'retention-policies': 'spaces',
    'task-recurrences': 'tasks',
    'task-templates': 'tasks',
    'task-occurrences': 'tasks',
    'saved-task-filters': 'tasks',
    labels: 'tasks',
    routines: 'habits',
    'time-entries': 'focus',
    'life-areas': 'goals',
    conversations: 'messaging',
    connections: 'social',
    me: 'account',
    support: 'account',
    moderation: 'account',
  };
  const modules = [
    'tasks',
    'planning',
    'calendar',
    'habits',
    'goals',
    'focus',
    'notes',
    'journal',
    'finance',
    'capture',
    'notifications',
    'insights',
    'rewards',
    'files',
    'sync',
    'projects',
    'teams',
    'companies',
    'social',
    'messaging',
    'meetings',
    'commerce',
    'account',
    'spaces',
  ];
  let module =
    aliases[part] ??
    (modules.includes(part) ? (part as TrafficBinding['module']) : null);
  if (!module) return null;
  if (['teams', 'companies', 'projects', 'spaces'].includes(module)) {
    const nested = path
      .split('/')
      .slice(5)
      .find((p) =>
        [
          'tasks',
          'files',
          'goals',
          'calendar',
          'meetings',
          'finance',
          'notes',
        ].includes(p),
      );
    if (nested) module = nested as TrafficBinding['module'];
  }
  const operation: TrafficBinding['operation'] =
    method === 'DELETE'
      ? 'delete'
      : /\/(?:exports?|export\.zip)(?:\/|$)/.test(path)
        ? 'export'
        : module === 'files' &&
            !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(method)
          ? 'upload'
          : ['GET', 'HEAD', 'OPTIONS'].includes(method)
            ? 'read'
            : 'write';
  return { module, operation };
}
export function bindingMatches(
  bindings: readonly TrafficBinding[],
  action: TrafficBinding,
) {
  return (
    !bindings.length ||
    bindings.some(
      (b) =>
        b.module === action.module &&
        (b.operation === action.operation ||
          (b.operation === 'write' &&
            ['upload', 'delete'].includes(action.operation))),
    )
  );
}
export function maintenanceBlocks(
  mode: string,
  bindings: readonly TrafficBinding[],
  action: TrafficBinding,
) {
  return (
    bindingMatches(bindings, action) &&
    (mode === 'FULL' ||
      (mode === 'READ_ONLY' &&
        ['write', 'upload', 'delete'].includes(action.operation)))
  );
}
