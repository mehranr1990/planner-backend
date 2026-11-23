import { randomUUID } from 'node:crypto';
import { AdminProvisionSchema } from '../../packages/api-contracts/src/admin.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { hashPassword } from 'better-auth/crypto';

// Credentials arrive on stdin, never command arguments, source, or logs.
let db: PrismaClient | undefined;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 8192) throw new Error('Provisioning input too large');
  }
  const data = AdminProvisionSchema.parse(JSON.parse(input));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const password = await hashPassword(data.password);
  await db.$transaction(async (tx) => {
    const user = await tx.adminUser.create({
      data: { email: data.email, name: data.name, role: data.role },
    });
    await tx.adminAccount.create({
      data: {
        accountId: user.id,
        userId: user.id,
        providerId: 'credential',
        password,
      },
    });
    await tx.adminAuditEvent.create({
      data: {
        actorAdminId: user.id,
        action: 'OPERATOR_PROVISION',
        outcome: 'SUCCEEDED',
        requestId: randomUUID(),
      },
    });
  });
  process.stdout.write(
    'Admin provisioned; MFA enrollment and a new sign-in are required.\n',
  );
} catch {
  process.stderr.write(
    'Provisioning failed; no credentials or existing accounts were changed.\n',
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
