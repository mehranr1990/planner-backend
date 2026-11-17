const applicationUserRelations: Readonly<Record<string, string>> = {
  keyedProjects: 'keyedProjectsProject[]@relation("ProjectKeyOwnerUser")',
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
  // P6-02/P6-03 (ADR 0060): SET NULL / notice-only CASCADE Social links.
  socialActivitiesCreated:
    'socialActivitiesCreatedSocialActivity[]@relation("SocialActivity_creator")',
  socialParticipations:
    'socialParticipationsSocialActivityParticipant[]@relation("SocialActivityParticipant_user")',
  socialNotices: 'socialNoticesSocialNotice[]@relation("SocialNotice_user")',
  socialExpensesProposed:
    'socialExpensesProposedSocialExpense[]@relation("SocialExpense_proposer")',
  socialRevisionsPaid:
    'socialRevisionsPaidSocialExpenseRevision[]@relation("SocialExpenseRevision_payer")',
  socialRevisionsProposed:
    'socialRevisionsProposedSocialExpenseRevision[]@relation("SocialExpenseRevision_proposer")',
  socialRevisionsDecided:
    'socialRevisionsDecidedSocialExpenseRevision[]@relation("SocialExpenseRevision_decider")',
  socialShares:
    'socialSharesSocialExpenseShare[]@relation("SocialExpenseShare_user")',
  socialSettlementsPaid:
    'socialSettlementsPaidSocialSettlement[]@relation("SocialSettlement_payer")',
  socialSettlementsReceived:
    'socialSettlementsReceivedSocialSettlement[]@relation("SocialSettlement_payee")',
  socialAuditEvents:
    'socialAuditEventsSocialAuditEvent[]@relation("SocialAuditEvent_actor")',
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
