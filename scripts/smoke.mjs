import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await page.screenshot({ path: '/private/tmp/front-pi-smoke.png', fullPage: true });
console.log(JSON.stringify({ title: await page.title(), heading: await page.locator('h1').textContent(), isolated: await page.evaluate(() => crossOriginIsolated), status: await page.locator('.runtime-card strong').textContent(), errors }));
await page.getByRole('button', { name: /OpenAI/ }).first().click();
console.log(JSON.stringify({ dialog: await page.getByRole('dialog').count(), providers: await page.locator('.provider-row').count(), models: await page.locator('.model-row').count() }));
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.locator('.workspace-tabs').getByRole('button', { name: '终端' }).click();
await page.locator('.terminal-command input').fill('echo browser-ok');
await page.locator('.terminal-command input').press('Enter');
await page.waitForFunction(() => document.querySelector('.terminal-view pre')?.textContent?.includes('[exit 0]'), { timeout: 15000 });
console.log(JSON.stringify({ terminal: (await page.locator('.terminal-view pre').textContent())?.slice(-120) }));
await page.locator('.terminal-command input').fill('echo persisted > note.txt');
await page.locator('.terminal-command input').press('Enter');
await page.waitForFunction(() => ((document.querySelector('.terminal-view pre')?.textContent?.match(/\[exit 0\]/g)) || []).length >= 2);
await page.waitForTimeout(1200);
console.log(JSON.stringify({ beforeReloadTerminal: (await page.locator('.terminal-view pre').textContent())?.slice(-180) }));
await page.locator('.workspace-tabs').getByRole('button', { name: '文件' }).click();
console.log(JSON.stringify({ beforeReloadFiles: await page.locator('.file-items').textContent() }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
console.log(JSON.stringify({ restored: await page.locator('.file-items').getByText('note.txt').count(), afterReloadFiles: await page.locator('.file-items').textContent(), errors }));
await browser.close();
