import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  effectiveSubscription,
  resolveAllowance,
} from '../domain/commercial-policy.js';
import { termWindow } from '../domain/term-clock.js';
export const commerceLock = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'commerce:' + id},0))::text`;
export async function resolveEntitlements(
  tx: Prisma.TransactionClient,
  customerId: string,
  now = new Date(),
) {
  const policy = await tx.commercePolicy.findUniqueOrThrow({
    where: { id: 'GLOBAL' },
  });
  const customer = await tx.commerceCustomer.findUniqueOrThrow({
    where: { id: customerId },
  });
  const subscriptions = await tx.commerceSubscription.findMany({
    where: {
      customerId,
      state: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'GRACE'] },
    },
    include: {
      r_versionId: { include: { r_CommerceAllowance_versionId: true } },
      r_CommerceTerm_subscriptionId: {
        include: { shifts: true, closure: true },
        orderBy: { startsAt: 'desc' },
      },
    },
    orderBy: { id: 'asc' },
  });
  const current = subscriptions.filter(
    (s) =>
      ['ACTIVE', 'GRACE'].includes(effectiveSubscription(s, now)) &&
      (effectiveSubscription(s, now) !== 'GRACE' || s.graceWritable),
  );
  const base = subscriptions.find(
    (s) =>
      s.kind === 'PLAN' &&
      !['CANCELED', 'EXPIRED'].includes(effectiveSubscription(s, now)),
  );
  const overrides = await tx.commerceOverride.findMany({
    where: {
      customerId,
      revokedAt: null,
      OR: [
        { duration: 'LIFETIME' },
        { duration: 'DATE', expiresAt: { gt: now } },
        { duration: 'TERM' },
      ],
    },
  });
  const terms = new Set(
    current.flatMap((s) =>
      s.r_CommerceTerm_subscriptionId
        .filter((t) => {
          const w = termWindow(t);
          return w.startsAt <= now && (!w.endsAt || w.endsAt > now);
        })
        .map((t) => t.id),
    ),
  );
  const features = await tx.commerceFeature.findMany({
    where: { archived: false },
    orderBy: { key: 'asc' },
  });
  const values = features.map((f) => {
    const allowances = current.map(
      (s) =>
        s.r_versionId.r_CommerceAllowance_versionId.find(
          (a) => a.featureId === f.id,
        )?.value ?? 0n,
    );
    const active = overrides.filter(
      (o) =>
        o.featureId === f.id &&
        (o.duration !== 'TERM' || (o.termId !== null && terms.has(o.termId))),
    );
    let value = resolveAllowance(
      0n,
      [
        ...allowances,
        ...active.filter((o) => o.mode === 'ADD').map((o) => o.value),
      ],
      active.filter((o) => o.mode === 'CAP').map((o) => o.value),
    );
    if (f.kind === 'BOOLEAN') value = value > 0n ? 1n : 0n;
    return {
      key: f.key,
      name: f.name,
      kind: f.kind,
      value: (customer.closedAt ? 0n : value).toString(),
      enforced: f.enforced,
      binding: f.binding,
    };
  });
  return {
    customerId,
    mode: policy.enforcement ? ('COMMERCIAL' as const) : ('FREE' as const),
    subscriptionState: base ? effectiveSubscription(base, now) : null,
    features: values,
  };
}
/** Invoked inside real owner transactions. This never grants authorization. */
export async function assertCommercialFeature(
  tx: Prisma.TransactionClient,
  selector: string,
  binding: string,
  usage = 0,
  growth = 0,
) {
  const policy = await tx.commercePolicy.findUniqueOrThrow({
    where: { id: 'GLOBAL' },
  });
  if (!policy.enforcement) return;
  const feature = await tx.commerceFeature.findUnique({ where: { binding } });
  if (!feature || !feature.enforced || feature.archived) return;
  const customer = await tx.commerceCustomer.findFirst({
    where: {
      OR: [{ scopeId: selector }, { spaceId: selector, kind: 'PERSONAL' }],
      closedAt: null,
    },
  });
  if (!customer)
    throw new ForbiddenException({ code: 'COMMERCIAL_ENTITLEMENT_REQUIRED' });
  await commerceLock(tx, customer.id);
  const resolved = await resolveEntitlements(tx, customer.id);
  const value = BigInt(
    resolved.features.find((f) => f.key === feature.key)?.value ?? '0',
  );
  if (
    value === 0n ||
    (feature.kind === 'QUOTA' && BigInt(usage) + BigInt(growth) > value)
  )
    throw new ForbiddenException({ code: 'COMMERCIAL_ENTITLEMENT_REQUIRED' });
}
