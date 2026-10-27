import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function pnpm(args: string[]): number {
  // Invoke the actual pnpm JS entry point through Node, avoiding a Windows shell
  // and preserving paths containing spaces. pnpm sets npm_execpath for scripts.
  const entry = process.env.npm_execpath;
  if (
    !entry ||
    !fs.existsSync(entry) ||
    !/^pnpm\.(?:c?js|mjs)$/.test(path.basename(entry))
  ) {
    process.stderr.write(
      'Run this command through the pinned pnpm package manager.\n',
    );
    return 1;
  }
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}
