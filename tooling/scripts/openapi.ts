import fs from 'node:fs';
import { createOpenApiDocument } from '../../packages/api-contracts/dist/openapi.js';

const file = 'docs/api/openapi.json';
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
