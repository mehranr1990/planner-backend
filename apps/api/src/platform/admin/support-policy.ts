export const ticketStates = [
  'NEW',
  'OPEN',
  'WAITING_FOR_USER',
  'WAITING_FOR_SUPPORT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
] as const;
export type TicketState = (typeof ticketStates)[number];

const ticketTransitions: Record<TicketState, readonly TicketState[]> = {
  NEW: [
    'OPEN',
    'WAITING_FOR_USER',
    'WAITING_FOR_SUPPORT',
    'RESOLVED',
    'CLOSED',
  ],
  OPEN: ['WAITING_FOR_USER', 'WAITING_FOR_SUPPORT', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_USER: ['OPEN', 'WAITING_FOR_SUPPORT', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_SUPPORT: ['OPEN', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: [
    'OPEN',
    'WAITING_FOR_USER',
    'WAITING_FOR_SUPPORT',
    'RESOLVED',
    'CLOSED',
  ],
};
export function ticketTransition(
  before: TicketState,
  after: TicketState,
  input: {
    now: Date;
    resolvedAt: Date | null;
    reopenDays: number;
    archived: boolean;
  },
): void {
  if (input.archived || !ticketTransitions[before]?.includes(after))
    throw new Error('INVALID_TICKET_TRANSITION');
  if (
    after === 'REOPENED' &&
    (!Number.isInteger(input.reopenDays) ||
      input.reopenDays < 1 ||
      input.reopenDays > 90 ||
      !input.resolvedAt ||
      input.resolvedAt > input.now ||
      input.now.getTime() >=
        input.resolvedAt.getTime() + input.reopenDays * 86400000)
  )
    throw new Error('TICKET_REOPEN_WINDOW_EXPIRED');
}

export function publicTicketMessages<T extends { internal: boolean }>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) => !message.internal);
}

export function ticketSlaDeadline(now: Date, minutes: number): Date {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 43200)
    throw new Error('INVALID_SUPPORT_SLA');
  return new Date(now.getTime() + minutes * 60000);
}

/** Assignment is a manual action; it never grants content authority to an operator. */
export function ticketAssigneeEligible(
  operator: {
    active: boolean;
    mfaEnabled: boolean;
    permitted: boolean;
    blockedUntil: Date | null;
  },
  now: Date,
): boolean {
  return (
    operator.active &&
    operator.mfaEnabled &&
    operator.permitted &&
    (!operator.blockedUntil || operator.blockedUntil <= now)
  );
}
