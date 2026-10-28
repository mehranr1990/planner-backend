import fs from 'node:fs';
import { createOpenApiDocument } from '../../packages/api-contracts/dist/openapi.js';
import { assertApiCompatible } from '../compatibility/openapi-compatibility.ts';

const file = 'docs/api/openapi.json';
for (const batch of ['p0-02', 'p0-03', 'p0-04', 'p1-01'])
  assertApiCompatible(
    createOpenApiDocument(),
    JSON.parse(
      fs.readFileSync(
        `tooling/compatibility/${batch}-api-signatures.json`,
        'utf8',
      ),
    ) as Record<string, string>,
  );
const generated = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
if (process.argv.includes('--write')) {
  fs.mkdirSync('docs/api', { recursive: true });
  fs.writeFileSync(file, generated);
} else if (
  !fs.existsSync(file) ||
  fs.readFileSync(file, 'utf8') !== generated
) {
  process.stderr.write(
    'OpenAPI differs from its reviewed snapshot. Run pnpm openapi:generate and review API compatibility.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write('OpenAPI matches reviewed snapshot.\n');
}
