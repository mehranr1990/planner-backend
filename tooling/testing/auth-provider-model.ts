const applicationUserRelations: Readonly<Record<string, string>> = {
  settings: 'settingsUserSettings?',
  spaces: 'spacesSpace[]',
  securityAuditEvents: 'securityAuditEventsSecurityAuditEvent[]',
  createdTasks: 'createdTasksTask[]@relation("TaskCreator")',
  taskChanges: 'taskChangesTaskChange[]@relation("TaskActor")',
  sharedActors: 'sharedActorsSharedActor[]',
  ContextInvitation: 'ContextInvitationContextInvitation[]',
  receivedDmBlocks:
    'receivedDmBlocksDmContactBlock[]@relation("DmContactBlock_target_fk")',
  socialRequestsSent:
    'socialRequestsSentSocialConnection[]@relation("SocialConnection_requester")',
  socialRequestsReceived:
    'socialRequestsReceivedSocialConnection[]@relation("SocialConnection_recipient")',
  socialJoinRequests: 'socialJoinRequestsSocialJoinRequest[]',
};
/** Ignore only exact reviewed application-owned inverse relations, never provider columns/indexes. */
export function normalizedAuthModel(source: string, name: string): string {
  const match = source.match(
    new RegExp(`model ${name} \\{([\\s\\S]*?)^\\}`, 'm'),
  );
  if (!match) throw Error(`Auth model missing: ${name}`);
  return match[1]!
    .split('\n')
    .filter((line) => {
      if (name !== 'User') return true;
      const field = line.trim().match(/^(\w+)\s/)?.[1],
        expected = field ? applicationUserRelations[field] : undefined;
      if (!expected) return true;
      if (line.replace(/\s+/g, '') !== expected)
        throw Error(
          'Unreviewed application inverse relation in User: ' + field,
        );
      return false;
    })
    .join('\n')
    .replace(/\s+/g, '');
}
