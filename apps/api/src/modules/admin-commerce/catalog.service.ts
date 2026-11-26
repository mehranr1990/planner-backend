import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  adminCommerceRoutes,
  publicCommerceRoutes,
  type CommerceAdminRoute,
  type CommerceAdminInput,
} from '@mehran/api-contracts';
import { sharedFeatureKeys } from '../spaces/public/shared-features.js';
import { commerceScope } from '../spaces/public/commerce-context.js';
import type { Prisma, CommerceProduct } from '../../generated/prisma/client.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import {
  CommerceCore,
  json,
  match,
  page,
  pageWhere,
  fail,
  currency,
} from './commerce-core.js';
import { commerceLock, resolveEntitlements } from './public/entitlements.js';
export const parse = <R extends CommerceAdminRoute>(route: R, input: unknown) =>
  adminCommerceRoutes[route].schema.parse(input) as CommerceAdminInput<R>;
const bindings = new Set<string>([
  ...sharedFeatureKeys,
  'personal.write',
  'workspace.write',
  'seats',
]);
@Injectable()
export class CatalogService {
  constructor(@Inject(CommerceCore) readonly core: CommerceCore) {}
  async publicCatalog(input: unknown) {
    this.core.privacy.assert();
    const b = publicCommerceRoutes['GET commerce/catalog'].schema.parse(input);
    return this.core.db.client.$transaction(async (tx) => {
      const rows = await tx.commerceProduct.findMany({
        where: {
          ...pageWhere(b),
          visibility: 'PUBLIC',
          r_CommerceVersion_productId: { some: {} },
          pricingPage: true,
          archived: false,
          ...(b.kind ? { eligibility: { array_contains: [b.kind] } } : {}),
        },
        orderBy: { id: 'asc' },
        take: b.limit + 1,
      });
      const values = [];
      for (const product of rows)
        values.push(await this.offer(tx, product, null));
      const policy = await tx.commercePolicy.findUniqueOrThrow({
        where: { id: 'GLOBAL' },
      });
      return json({
        ...page(values, b.limit),
        mode: policy.enforcement ? 'COMMERCIAL' : 'FREE',
      });
    });
  }
  async offer(
    tx: Prisma.TransactionClient,
    product: CommerceProduct,
    customerId: string | null,
  ) {
    const version = await tx.commerceVersion.findFirst({
      where: { productId: product.id },
      orderBy: { version: 'desc' },
      include: {
        r_CommerceAllowance_versionId: { include: { r_featureId: true } },
      },
    });
    const prices = version
      ? await tx.commercePrice.findMany({
          where: {
            versionId: version.id,
            active: true,
            OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])],
          },
          orderBy: { id: 'asc' },
          take: 200,
        })
      : [];
    const features =
      version?.r_CommerceAllowance_versionId
        .filter((a) => !a.r_featureId.archived)
        .map((a) => ({
          key: a.r_featureId.key,
          name: a.r_featureId.name,
          kind: a.r_featureId.kind,
          value: a.value.toString(),
        })) ?? [];
    return { ...product, versionId: version?.id ?? null, features, prices };
  }
  async handle(
    route: CommerceAdminRoute,
    id: string | undefined,
    input: unknown,
    command: AdminCommand,
  ) {
    return this.core.admin(command, async (tx) =>
      json(await this.run(tx, route, id ?? '', input, command)),
    );
  }
  async run(
    tx: Prisma.TransactionClient,
    route: CommerceAdminRoute,
    id: string,
    input: unknown,
    command: AdminCommand,
  ): Promise<unknown> {
    if (route === 'POST commerce/customers') {
      const b = parse(route, input),
        scope = await commerceScope(tx, b.selector);
      await commerceLock(tx, 'scope:' + b.selector);
      const prior = await tx.commerceCustomer.findFirst({
        where: { spaceId: scope.spaceId, scopeId: scope.scopeId },
      });
      if (prior) return prior;
      const row = await tx.commerceCustomer.create({
        data: {
          spaceId: scope.spaceId,
          scopeId: scope.scopeId,
          kind: scope.kind,
        },
      });
      await this.core.event(
        tx,
        row.id,
        'CUSTOMER_REGISTERED',
        b.reason,
        null,
        command,
      );
      return row;
    }
    if (route === 'GET commerce/customers') {
      const b = parse(route, input);
      return page(
        await tx.commerceCustomer.findMany({
          where: pageWhere(b),
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'GET commerce/features') {
      const b = parse(route, input);
      return page(
        await tx.commerceFeature.findMany({
          where: pageWhere(b),
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/features') {
      const b = parse(route, input);
      if (
        b.binding &&
        ((['personal.write', 'workspace.write'].includes(b.binding) &&
          b.kind !== 'BOOLEAN') ||
          (b.binding === 'seats' && b.kind !== 'QUOTA'))
      )
        fail('BINDING_KIND_MISMATCH');
      if (b.binding && !bindings.has(b.binding))
        throw new BadRequestException({ code: 'UNKNOWN_RUNTIME_BINDING' });
      return tx.commerceFeature.create({
        data: { key: b.key, name: b.name, kind: b.kind, binding: b.binding },
      });
    }
    if (route === 'POST commerce/features/:id') {
      const b = parse(route, input),
        f = await tx.commerceFeature.findUniqueOrThrow({ where: { id } });
      match(f.revision, b.revision);
      return tx.commerceFeature.update({
        where: { id, revision: b.revision },
        data: {
          name: b.name,
          enforced: b.enforced,
          archived: b.archived,
          revision: { increment: 1 },
        },
      });
    }
    if (route === 'GET commerce/products') {
      const b = parse(route, input);
      return page(
        await tx.commerceProduct.findMany({
          where: pageWhere(b),
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (
      route === 'POST commerce/products' ||
      route === 'POST commerce/products/:id'
    ) {
      const b =
        route === 'POST commerce/products'
          ? parse(route, input)
          : parse('POST commerce/products/:id', input);
      if (new Set(b.eligibility).size !== b.eligibility.length)
        fail('DUPLICATE_ELIGIBILITY');
      if (b.visibility === 'TARGETED' && !b.targetCustomerIds.length)
        fail('TARGETS_REQUIRED');
      if (b.visibility !== 'TARGETED' && b.targetCustomerIds.length)
        fail('UNEXPECTED_TARGETS');
      let row;
      const data = {
        name: b.name,
        visibility: b.visibility,
        pricingPage: b.pricingPage,
        eligibility: b.eligibility,
      };
      if ('revision' in b) {
        const old = await tx.commerceProduct.findUniqueOrThrow({
          where: { id },
        });
        match(old.revision, b.revision);
        row = await tx.commerceProduct.update({
          where: { id, revision: b.revision },
          data: { ...data, archived: b.archived, revision: { increment: 1 } },
        });
        await tx.commerceTarget.deleteMany({ where: { productId: row.id } });
      } else
        row = await tx.commerceProduct.create({
          data: { ...data, kind: b.kind },
        });
      for (const customerId of new Set(b.targetCustomerIds)) {
        await this.core.customer(tx, customerId);
        await tx.commerceTarget.create({
          data: { productId: row.id, customerId },
        });
      }
      return row;
    }
    if (route === 'GET commerce/products/:id/versions') {
      const b = parse(route, input);
      const rows = await tx.commerceVersion.findMany({
        where: { productId: id, ...pageWhere(b) },
        include: { r_CommerceAllowance_versionId: true },
        orderBy: { id: 'asc' },
        take: b.limit + 1,
      });
      return page(
        rows.map((r) => ({
          ...r,
          allowances: r.r_CommerceAllowance_versionId,
        })),
        b.limit,
      );
    }
    if (route === 'POST commerce/products/:id/publish') {
      const b = parse(route, input);
      await commerceLock(tx, 'product:' + id);
      const product = await tx.commerceProduct.findUniqueOrThrow({
        where: { id },
      });
      match(product.revision, b.revision);
      if (product.archived) fail('PRODUCT_ARCHIVED');
      if (
        new Set(b.allowances.map((a) => a.featureId)).size !==
        b.allowances.length
      )
        fail('DUPLICATE_ALLOWANCE');
      for (const a of b.allowances) {
        const f = await tx.commerceFeature.findUniqueOrThrow({
          where: { id: a.featureId },
        });
        if (
          f.archived ||
          BigInt(a.value) > 9223372036854775807n ||
          (f.kind === 'BOOLEAN' && BigInt(a.value) > 1n)
        )
          fail('INVALID_ALLOWANCE');
      }
      const latest = await tx.commerceVersion.findFirst({
        where: { productId: id },
        orderBy: { version: 'desc' },
      });
      const row = await tx.commerceVersion.create({
        data: {
          productId: product.id,
          version: (latest?.version ?? 0) + 1,
          propagation: b.propagation,
        },
      });
      await tx.commerceAllowance.createMany({
        data: b.allowances.map((a) => ({
          versionId: row.id,
          featureId: a.featureId,
          value: BigInt(a.value),
        })),
      });
      await tx.commerceProduct.update({
        where: { id, revision: b.revision },
        data: { revision: { increment: 1 } },
      });
      if (b.propagation === 'ALL')
        await tx.commerceSubscription.updateMany({
          where: {
            productId: id,
            state: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'GRACE'] },
          },
          data: { versionId: row.id, revision: { increment: 1 } },
        });
      return { ...row, allowances: b.allowances };
    }
    if (route === 'GET commerce/prices') {
      const b = parse(route, input);
      return page(
        await tx.commercePrice.findMany({
          where: {
            ...pageWhere(b),
            ...(b.versionId ? { versionId: b.versionId } : {}),
          },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/prices') {
      const b = parse(route, input);
      currency(b.currency);
      if (b.complimentary && b.amount !== '0')
        fail('COMPLIMENTARY_NOT_PAYMENT');
      if (b.recurring && b.termDays === null) fail('RECURRING_TERM_REQUIRED');
      const version = await tx.commerceVersion.findUniqueOrThrow({
        where: { id: b.versionId },
        include: { r_productId: true },
      });
      if (version.r_productId.archived) fail('PRODUCT_ARCHIVED');
      if (b.customerId) await this.core.customer(tx, b.customerId);
      const { reason: _, ...data } = b;
      return tx.commercePrice.create({ data });
    }
    if (route === 'POST commerce/prices/:id') {
      const b = parse(route, input);
      return tx.commercePrice.update({
        where: { id },
        data: { active: b.active },
      });
    }
    if (route === 'GET commerce/customers/:id/entitlements') {
      await this.core.customer(tx, id!);
      return resolveEntitlements(tx, id!);
    }
    if (route === 'GET commerce/customers/:id/overrides') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      return page(
        await tx.commerceOverride.findMany({
          where: { customerId: id, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/customers/:id/overrides') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      const f = await tx.commerceFeature.findUniqueOrThrow({
        where: { id: b.featureId },
      });
      if (
        f.archived ||
        BigInt(b.value) > 9223372036854775807n ||
        (f.kind === 'BOOLEAN' && BigInt(b.value) > 1n)
      )
        fail('INVALID_OVERRIDE');
      if (
        (b.duration === 'DATE') !== (b.expiresAt !== null) ||
        (b.duration === 'TERM') !== (b.termId !== null)
      )
        fail('INVALID_OVERRIDE_DURATION');
      if (b.expiresAt && new Date(b.expiresAt) <= new Date())
        fail('OVERRIDE_EXPIRED');
      if (
        b.termId &&
        !(await tx.commerceTerm.findFirst({
          where: { id: b.termId, r_subscriptionId: { customerId: id } },
        }))
      )
        fail('FOREIGN_TERM');
      if (b.mode === 'CAP')
        await tx.commerceOverride.updateMany({
          where: {
            customerId: id,
            featureId: b.featureId,
            mode: 'CAP',
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      const row = await tx.commerceOverride.create({
        data: {
          customerId: id!,
          featureId: b.featureId,
          value: BigInt(b.value),
          mode: b.mode,
          duration: b.duration,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          termId: b.termId,
        },
      });
      await this.core.event(
        tx,
        id!,
        'OVERRIDE_GRANTED',
        b.reason,
        null,
        command,
        undefined,
        { overrideId: row.id },
      );
      return row;
    }
    if (route === 'POST commerce/overrides/:id/revoke') {
      const b = parse(route, input),
        old = await tx.commerceOverride.findUniqueOrThrow({ where: { id } });
      await this.core.customer(tx, old.customerId);
      const row = await tx.commerceOverride.update({
        where: { id },
        data: { revokedAt: old.revokedAt ?? new Date() },
      });
      await this.core.event(
        tx,
        row.customerId,
        'OVERRIDE_REVOKED',
        b.reason,
        null,
        command,
        undefined,
        { overrideId: row.id },
      );
      return row;
    }
    if (route === 'POST commerce/customers/:id/financial-grants') {
      const b = parse(route, input),
        c = await this.core.customer(tx, id!);
      if (c.closedAt || !c.spaceId) fail('CUSTOMER_CLOSED');
      await commerceScope(
        tx,
        c.scopeId ?? c.spaceId,
        {
          userId: b.userId,
          requestId: command.requestId,
          correlationId: command.requestId,
        },
        this.core.kernel,
      );
      const row = await tx.commerceFinancialGrant.upsert({
        where: { customerId_userId: { customerId: id!, userId: b.userId } },
        create: {
          customerId: id!,
          userId: b.userId,
          revokedAt: b.grant ? null : new Date(),
        },
        update: { revokedAt: b.grant ? null : new Date() },
      });
      await this.core.event(
        tx,
        id!,
        'FINANCIAL_AUTHORITY_CHANGED',
        b.reason,
        null,
        command,
        undefined,
        { userId: b.userId, grant: b.grant },
      );
      return { id: row.id };
    }
    if (route === 'GET commerce/customers/:id/history') {
      const b = parse(route, input);
      await this.core.customer(tx, id);
      return page(
        await tx.commerceEvent.findMany({
          where: { customerId: id, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'GET commerce/policy')
      return tx.commercePolicy.findUniqueOrThrow({ where: { id: 'GLOBAL' } });
    if (route === 'POST commerce/policy') {
      const b = parse(route, input),
        old = await tx.commercePolicy.findUniqueOrThrow({
          where: { id: 'GLOBAL' },
        });
      match(old.revision, b.revision);
      const { reason: _, acknowledge: __, revision: ___, ...data } = b;
      return tx.commercePolicy.update({
        where: { id: 'GLOBAL', revision: b.revision },
        data: { ...data, revision: { increment: 1 }, updatedAt: new Date() },
      });
    }
    throw new NotFoundException();
  }
}
