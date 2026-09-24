import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let chatRequests = 0;
let summaryRequests = 0;
page.on('pageerror', (error) => { throw error; });
await page.route('**/chat/completions', async (route) => {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'text/event-stream' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const payload = route.request().postData() || '';
  const isSummary = payload.includes('You summarize a coding-agent conversation');
  const text = isSummary ? 'Previous project context summarized.' : ++chatRequests === 1 ? 'Old context received.' : 'I can continue with the summary.';
  if (isSummary) summaryRequests++;
  const chunks = [
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  await route.fulfill({ status: 200, headers, body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n` });
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await page.locator('.model-pill').click();
await page.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
await page.locator('#api-key').fill('test-key');
await page.getByRole('button', { name: '保存' }).click();
await page.locator('.model-row').first().click();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.evaluate(async () => {
  const { models } = await import('/src/providers.ts');
  const model = models.getModel('deepseek', 'deepseek-flash');
  if (!model) throw new Error('DeepSeek model missing');
  model.contextWindow = 4000;
});
await page.locator('.composer textarea').fill('Old project context. '.repeat(1200));
await page.locator('.composer textarea').press('Enter');
await page.getByText('Old context received.').waitFor({ timeout: 15000 });
await page.locator('.composer textarea').fill('Continue using the old context.');
await page.locator('.composer textarea').press('Enter');
await page.getByText('I can continue with the summary.').waitFor({ timeout: 30000 });
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pi-browser:sessions:v1') || '[]'));
assert.ok(summaryRequests > 0, 'summary provider calls should occur');
assert.match(saved[0].summary, /summarized/);
assert.ok(saved[0].summarizedUntil > 1);
console.log(JSON.stringify({ chatRequests, summaryRequests, checkpoint: saved[0].summarizedUntil }));
await browser.close();
