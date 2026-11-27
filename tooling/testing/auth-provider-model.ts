const applicationUserRelations: Readonly<Record<string, string>> = {
  // ADR 0081: application-only metadata ownership; no provider scalar change.
  systemEmailObservations: 'systemEmailObservationsSystemEmailObservation[]',
  analyticsEvents: 'analyticsEventsProductAnalyticsEvent[]',
  // ADR 0078: exact application-only target navigation.
  r_PlatformConfigTarget_userId:
    'r_PlatformConfigTarget_userIdPlatformConfigTarget[]@relation("PlatformConfigTarget_userId")',
  // ADR 0077: exact application inverse navigation, no provider scalar change.
  r_CommerceFinancialGrant_userId:
    'r_CommerceFinancialGrant_userIdCommerceFinancialGrant[]@relation("CommerceFinancialGrant_userId")',
  r_CommerceEvent_actorUserId:
    'r_CommerceEvent_actorUserIdCommerceEvent[]@relation("CommerceEvent_actorUserId")',
  r_CommerceReceipt_userId:
    'r_CommerceReceipt_userIdCommerceReceipt[]@relation("CommerceReceipt_userId")',
  // ADR 0075: application-owned, recipient-only push delivery metadata.
  invitationPushAttempts: 'invitationPushAttemptsInvitationPushAttempt[]',
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
  // P6-04/P6-05 (ADR 0064/0065): relation-only Social links; registered with ADR 0067.
  socialAssets: 'socialAssetsSocialAsset[]@relation("SocialAsset_owner")',
  socialLoansLent: 'socialLoansLentSocialLoan[]@relation("SocialLoan_lender")',
  socialLoansBorrowed:
    'socialLoansBorrowedSocialLoan[]@relation("SocialLoan_borrower")',
  socialLoanOutcomes:
    'socialLoanOutcomesSocialLoan[]@relation("SocialLoan_pendingOutcomeBy")',
  socialLoanDisputes:
    'socialLoanDisputesSocialLoan[]@relation("SocialLoan_disputedBy")',
  socialLoanDueProposals:
    'socialLoanDueProposalsSocialLoan[]@relation("SocialLoan_dueProposedBy")',
  socialGoalsCreated:
    'socialGoalsCreatedSocialGoal[]@relation("SocialGoal_creator")',
  socialGoalParticipations:
    'socialGoalParticipationsSocialGoalParticipant[]@relation("SocialGoalParticipant_user")',
  socialGoalEntriesSubmitted:
    'socialGoalEntriesSubmittedSocialGoalEntry[]@relation("SocialGoalEntry_submittedBy")',
  socialGoalEntriesReviewed:
    'socialGoalEntriesReviewedSocialGoalEntry[]@relation("SocialGoalEntry_reviewedBy")',
  socialGoalEvents:
    'socialGoalEventsSocialGoalEvent[]@relation("SocialGoalEvent_actor")',
  socialLostFoundReports:
    'socialLostFoundReportsSocialLostFoundReport[]@relation("SocialLostFoundReport_reporter")',
  socialLostFoundClaims:
    'socialLostFoundClaimsSocialLostFoundClaim[]@relation("SocialLostFoundClaim_claimant")',
  socialLostFoundDisputes:
    'socialLostFoundDisputesSocialLostFoundClaim[]@relation("SocialLostFoundClaim_disputedBy")',
  socialLendingEvents:
    'socialLendingEventsSocialLendingEvent[]@relation("SocialLendingEvent_actor")',
  socialEvidence:
    'socialEvidenceSocialEvidence[]@relation("SocialEvidence_addedBy")',
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
