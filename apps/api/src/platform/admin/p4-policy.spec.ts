import { describe, expect, it } from 'vitest';
import {
  communicationEligibility,
  communicationNeedsApproval,
  renderCommunication,
} from './communications-policy.js';
import {
  ticketTransition,
  publicTicketMessages,
  ticketSlaDeadline,
  ticketAssigneeEligible,
} from './support-policy.js';
import {
  moderationAppeal,
  independentAppealReviewer,
  reportedItemAccess,
  moderationTransition,
} from './moderation-policy.js';

const now = new Date('2026-11-25T10:00:00Z');
describe('P4 communication privacy and template boundaries', () => {
  const recipient = {
    active: true,
    verifiedEmail: true,
    pushAvailable: false,
    channels: { EMAIL: false, IN_APP: true, WEB_PUSH: true },
    quietUntil: new Date(now.getTime() + 60000),
  };
  it('honors channel preferences and quiet hours for ordinary communication', () => {
    expect(
      communicationEligibility('DIRECT', 'EMAIL', recipient, now).state,
    ).toBe('SUPPRESSED');
    expect(communicationEligibility('GROUP', 'IN_APP', recipient, now)).toEqual(
      { state: 'DEFERRED', notBefore: recipient.quietUntil },
    );
    expect(
      communicationEligibility('GLOBAL', 'WEB_PUSH', recipient, now).state,
    ).toBe('SUPPRESSED');
  });
  it('essential security notices bypass preferences but never device or identity eligibility', () => {
    expect(
      communicationEligibility('SECURITY', 'EMAIL', recipient, now).state,
    ).toBe('SEND');
    expect(
      communicationEligibility(
        'SECURITY',
        'EMAIL',
        { ...recipient, verifiedEmail: false },
        now,
      ).state,
    ).toBe('SUPPRESSED');
    expect(
      communicationEligibility('SECURITY', 'WEB_PUSH', recipient, now).state,
    ).toBe('SUPPRESSED');
    expect(
      communicationEligibility(
        'SECURITY',
        'IN_APP',
        { ...recipient, active: false },
        now,
      ).state,
    ).toBe('SUPPRESSED');
    expect(communicationNeedsApproval('GLOBAL')).toBe(true);
    expect(communicationNeedsApproval('SECURITY')).toBe(true);
    expect(communicationNeedsApproval('DIRECT')).toBe(false);
  });
  const templates = [
    {
      locale: 'en',
      subject: 'Hello {{recipientName}}',
      body: 'Update: {{publicReason}}',
    },
    {
      locale: 'fa',
      subject: 'سلام {{recipientName}}',
      body: '{{publicReason}}',
    },
  ];
  it('selects locale, language and mandatory fallback without recursively rendering values', () => {
    expect(
      renderCommunication(templates, 'fa-IR', 'en', {
        recipientName: 'مهران',
        publicReason: '{{recipientName}}',
      }),
    ).toEqual({
      locale: 'fa',
      subject: 'سلام مهران',
      body: '{{recipientName}}',
    });
    expect(
      renderCommunication(templates, 'de', 'en', {
        recipientName: 'Owner',
        publicReason: 'Notice',
      }).locale,
    ).toBe('en');
    expect(() => renderCommunication(templates, 'fa', 'de', {})).toThrow(
      'MISSING_TEMPLATE_FALLBACK',
    );
  });
  it('rejects unapproved or missing variables, header injection and duplicate locales', () => {
    expect(() =>
      renderCommunication(
        [{ locale: 'en', subject: 'Hello', body: '{{password}}' }],
        'en',
        'en',
        {},
      ),
    ).toThrow('UNAPPROVED_TEMPLATE_VARIABLE');
    expect(() => renderCommunication(templates, 'en', 'en', {})).toThrow(
      'MISSING_TEMPLATE_VALUE',
    );
    expect(() =>
      renderCommunication(templates, 'en', 'en', {
        recipientName: 'X\r\nBcc: secret',
        publicReason: 'N',
      }),
    ).toThrow('INVALID_TEMPLATE_VALUE');
    expect(() =>
      renderCommunication([...templates, templates[0]!], 'en', 'en', {}),
    ).toThrow('DUPLICATE_TEMPLATE_LOCALE');
  });
});
describe('P4 support lifecycle boundaries', () => {
  const input = {
    now,
    resolvedAt: new Date(now.getTime() - 86400000),
    reopenDays: 7,
    archived: false,
  };
  it('reopens within a finite window and refuses exact deadline, future evidence and archived tickets', () => {
    expect(() => ticketTransition('RESOLVED', 'REOPENED', input)).not.toThrow();
    expect(() =>
      ticketTransition('CLOSED', 'REOPENED', {
        ...input,
        resolvedAt: new Date(now.getTime() - 7 * 86400000),
      }),
    ).toThrow();
    expect(() =>
      ticketTransition('CLOSED', 'REOPENED', {
        ...input,
        resolvedAt: new Date(now.getTime() + 1),
      }),
    ).toThrow();
    expect(() =>
      ticketTransition('CLOSED', 'REOPENED', { ...input, archived: true }),
    ).toThrow();
    expect(() => ticketTransition('NEW', 'REOPENED', input)).toThrow();
  });
  it('excludes internal notes from public replies', () => {
    expect(
      publicTicketMessages([
        { internal: true, body: 'Private' },
        { internal: false, body: 'Reply' },
      ]),
    ).toEqual([{ internal: false, body: 'Reply' }]);
  });
  it('bounds SLA and denies inactive, blocked or unauthorized assignees', () => {
    expect(ticketSlaDeadline(now, 15).getTime()).toBe(now.getTime() + 900000);
    expect(() => ticketSlaDeadline(now, 0)).toThrow();
    const eligible = {
      active: true,
      mfaEnabled: true,
      permitted: true,
      blockedUntil: null,
    };
    expect(ticketAssigneeEligible(eligible, now)).toBe(true);
    expect(ticketAssigneeEligible({ ...eligible, permitted: false }, now)).toBe(
      false,
    );
    expect(
      ticketAssigneeEligible(
        { ...eligible, blockedUntil: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(false);
  });
});
describe('P4 moderation privacy and appeal boundaries', () => {
  it('requires a timely first appeal and an independent reviewer', () => {
    const input = {
      state: 'ACTION_TAKEN' as const,
      now,
      decidedAt: new Date(now.getTime() - 1000),
      appealDays: 14,
      alreadyAppealed: false,
    };
    expect(() => moderationAppeal(input)).not.toThrow();
    expect(() =>
      moderationAppeal({ ...input, alreadyAppealed: true }),
    ).toThrow();
    expect(() =>
      moderationAppeal({
        ...input,
        decidedAt: new Date(now.getTime() - 14 * 86400000),
      }),
    ).toThrow();
    expect(() => independentAppealReviewer('first', 'first')).toThrow();
    expect(() => independentAppealReviewer(null, 'second')).toThrow();
    expect(() => independentAppealReviewer('first', 'second')).not.toThrow();
  });
  it('never permits a direct unreviewed penalty', () => {
    expect(() => moderationTransition('NEW', 'ACTION_TAKEN')).toThrow();
    expect(() =>
      moderationTransition('TRIAGED', 'INVESTIGATING'),
    ).not.toThrow();
    expect(() => moderationTransition('CLOSED', 'INVESTIGATING')).toThrow();
  });
  it('binds content access to the specific case, exact reported item, capability and current source', () => {
    const input = {
      permitted: true,
      caseId: 'case',
      requestedCaseId: 'case',
      reportedItemId: 'item',
      requestedItemId: 'item',
      state: 'INVESTIGATING' as const,
      sourceAvailable: true,
    };
    expect(() => reportedItemAccess(input)).not.toThrow();
    for (const changed of [
      { permitted: false },
      { requestedCaseId: 'other' },
      { requestedItemId: 'other' },
      { reportedItemId: null },
      { state: 'CLOSED' as const },
      { sourceAvailable: false },
    ])
      expect(() => reportedItemAccess({ ...input, ...changed })).toThrow(
        'REPORTED_ITEM_ACCESS_DENIED',
      );
  });
});

import { permits } from './admin-policy.js';
it('keeps support and reported-content capabilities explicit and separate', () => {
  expect(permits('SUPPORT', 'admin.support.read')).toBe(true);
  expect(permits('SUPPORT', 'admin.moderation.content.read')).toBe(false);
  expect(permits('SECURITY_REVIEWER', 'admin.moderation.content.read')).toBe(
    true,
  );
  expect(permits('SECURITY_REVIEWER', 'admin.users.suspend')).toBe(false);
  expect(permits('BILLING_MANAGER', 'admin.support.read')).toBe(false);
});
