import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export type InitialIdentityRelations = () => Pick<
  Prisma.UserCreateInput,
  'settings' | 'spaces'
>;
export const INITIAL_IDENTITY_RELATIONS = Symbol('INITIAL_IDENTITY_RELATIONS');

export function identityClient(
  client: PrismaClient,
  relations: InitialIdentityRelations,
) {
  return client.$extends({
    name: 'atomic-initial-identity-relations',
    query: {
      user: {
        create({ args, query }) {
          return query({ ...args, data: { ...args.data, ...relations() } });
        },
      },
    },
  });
}
