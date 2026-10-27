import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';

try {
  parseEnvironment(process.env);
  process.stdout.write('Configuration valid (values withheld).\n');
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Invalid configuration'}\n`,
  );
  process.exitCode = 1;
}
