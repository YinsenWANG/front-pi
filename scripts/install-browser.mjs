import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { browserEnvironment } from '../tests/support/browser.mjs';

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
const env = browserEnvironment();
await mkdir(env.TMPDIR, { recursive: true });
const result = spawnSync(process.execPath, [cli, 'install', 'chromium', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
