// The identity composition root adds this nested relation to provider User.create.
// Prisma writes it atomically with User, including inside Better Auth transactions.
export function initialAccountRelations() {
  return { settings: { create: {} } };
}
