import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

// Keep downloaded browsers in this clone, including on CI. No system Chrome path.
export function browserEnvironment() {
  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: fileURLToPath(new URL('../../node_modules/.cache/ms-playwright', import.meta.url)),
    TMPDIR: fileURLToPath(new URL('../../node_modules/.cache/browser-tmp', import.meta.url)),
  };
}

export async function launchBrowser() {
  const env = browserEnvironment();
  await mkdir(env.TMPDIR, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.TMPDIR = env.TMPDIR;
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}
