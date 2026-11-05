import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { SharedLifecycleService } from '../../apps/api/dist/modules/spaces/public/index.js';
import * as c from '../../packages/api-contracts/dist/index.js';
const [command, spaceId, jobId, revision, id, evidence, ...extra] =
  process.argv.slice(2);
if (command !== 'release' || extra.length || !evidence)
  throw new Error(
    'Expected release spaceId jobId revision hold-or-obligation-id evidence-reference',
  );
const uuid = c.ProjectCreateSchema.shape.id;
const input = {
  spaceId: uuid.parse(spaceId),
  jobId: uuid.parse(jobId),
  revision: Number(revision),
  id: uuid.parse(id),
  evidence: evidence.trim(),
};
if (
  !Number.isSafeInteger(input.revision) ||
  input.revision < 1 ||
  input.revision > 2147483646 ||
  !input.evidence ||
  input.evidence.length > 200
)
  throw new Error('Invalid release revision or evidence reference');
const app = await NestFactory.createApplicationContext(
  AppModule.register(parseEnvironment(process.env)),
  { logger: false },
);
try {
  await app
    .get(SharedLifecycleService)
    .release(
      input.spaceId,
      input.jobId,
      input.revision,
      input.id,
      input.evidence,
    );
  process.stdout.write(
    'PASS: revisioned operator release recorded; cleanup remains gated by all other policy and security conditions.\n',
  );
} finally {
  await app.close();
}
