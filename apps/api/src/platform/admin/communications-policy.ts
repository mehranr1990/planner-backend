/** P4 delivery policy. Callers supply current authoritative recipient state. */
export type CommunicationChannel = 'IN_APP' | 'EMAIL' | 'WEB_PUSH';
export type CommunicationType =
  'SYSTEM' | 'DIRECT' | 'GROUP' | 'GLOBAL' | 'SECURITY';
export type RecipientDeliveryState = {
  active: boolean;
  verifiedEmail: boolean;
  pushAvailable: boolean;
  channels: Record<CommunicationChannel, boolean>;
  quietUntil: Date | null;
};

export function communicationEligibility(
  type: CommunicationType,
  channel: CommunicationChannel,
  recipient: RecipientDeliveryState,
  now: Date,
): { state: 'SEND' | 'SUPPRESSED' | 'DEFERRED'; notBefore: Date | null } {
  if (!recipient.active) return { state: 'SUPPRESSED', notBefore: null };
  if (channel === 'EMAIL' && !recipient.verifiedEmail)
    return { state: 'SUPPRESSED', notBefore: null };
  if (channel === 'WEB_PUSH' && !recipient.pushAvailable)
    return { state: 'SUPPRESSED', notBefore: null };
  if (type !== 'SECURITY' && !recipient.channels[channel])
    return { state: 'SUPPRESSED', notBefore: null };
  if (type !== 'SECURITY' && recipient.quietUntil && recipient.quietUntil > now)
    return { state: 'DEFERRED', notBefore: recipient.quietUntil };
  return { state: 'SEND', notBefore: null };
}

export const communicationLimits = {
  previewRecipients: 1000,
  dispatchBatch: 25,
  previewLifetimeMs: 15 * 60_000,
  approvalLifetimeMs: 30 * 60_000,
  maxAttempts: 5,
} as const;

/** Global and security broadcasts always require independent approval. */
export function communicationNeedsApproval(type: CommunicationType): boolean {
  return type === 'GLOBAL' || type === 'SECURITY';
}

export type LocalizedTemplate = {
  locale: string;
  subject: string;
  body: string;
};
const variableNames = [
  'recipientName',
  'workspaceName',
  'publicReason',
] as const;
export type CommunicationVariables = Partial<
  Record<(typeof variableNames)[number], string>
>;

export function validateTemplate(template: LocalizedTemplate): void {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(template.locale))
    throw new Error('INVALID_TEMPLATE_LOCALE');
  if (
    !template.subject.trim() ||
    template.subject.length > 200 ||
    /[\r\n\0]/.test(template.subject)
  )
    throw new Error('INVALID_TEMPLATE_SUBJECT');
  if (
    !template.body.trim() ||
    template.body.length > 10000 ||
    template.body.includes('\0')
  )
    throw new Error('INVALID_TEMPLATE_BODY');
  for (const content of [template.subject, template.body]) {
    const remaining = content.replace(
      /\{\{([A-Za-z]+)\}\}/g,
      (_match, name: string) => {
        if (!(variableNames as readonly string[]).includes(name))
          throw new Error('UNAPPROVED_TEMPLATE_VARIABLE');
        return '';
      },
    );
    if (/[{}]/.test(remaining)) throw new Error('INVALID_TEMPLATE_VARIABLE');
  }
}

/** Plain text only. Values are substituted once and cannot introduce variables. */
export function renderCommunication(
  templates: readonly LocalizedTemplate[],
  locale: string,
  fallbackLocale: string,
  variables: CommunicationVariables,
): { locale: string; subject: string; body: string } {
  if (
    new Set(templates.map((t) => t.locale.toLowerCase())).size !==
    templates.length
  )
    throw new Error('DUPLICATE_TEMPLATE_LOCALE');
  for (const template of templates) validateTemplate(template);
  const find = (value: string) =>
    templates.find((t) => t.locale.toLowerCase() === value.toLowerCase());
  if (!find(fallbackLocale)) throw new Error('MISSING_TEMPLATE_FALLBACK');
  const selected =
    find(locale) ?? find(locale.split('-')[0]!) ?? find(fallbackLocale)!;
  for (const [key, value] of Object.entries(variables)) {
    if (
      !(variableNames as readonly string[]).includes(key) ||
      typeof value !== 'string' ||
      value.length > 500 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error('INVALID_TEMPLATE_VALUE');
  }
  const render = (content: string) =>
    content.replace(
      /\{\{([A-Za-z]+)\}\}/g,
      (_match, name: keyof CommunicationVariables) => {
        const value = variables[name];
        if (value === undefined) throw new Error('MISSING_TEMPLATE_VALUE');
        return value;
      },
    );
  const subject = render(selected.subject),
    body = render(selected.body);
  if (subject.length > 200 || body.length > 10000)
    throw new Error('RENDERED_TEMPLATE_LIMIT');
  return { locale: selected.locale, subject, body };
}
