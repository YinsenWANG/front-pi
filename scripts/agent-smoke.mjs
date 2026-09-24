import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const requests = [];
const moduleResponses = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.url().includes('openai-completions')) moduleResponses.push({ url: response.url(), status: response.status() });
});
await page.route('**/chat/completions', async (route) => {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'text/event-stream' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const isConnectionTest = (route.request().postData() || '').includes('Reply with OK');
  if (!isConnectionTest) requests.push(route.request().url());
  const response = isConnectionTest
    ? { role: 'assistant', content: 'OK' }
    : requests.length === 2
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
    : { role: 'assistant', content: requests.length === 1 ? 'Browser agent works.' : 'I read the workspace README.' };
  const chunks = [
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: response, finish_reason: null }] },
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: !isConnectionTest && requests.length === 2 ? 'tool_calls' : 'stop' }] },
  ];
  return route.fulfill({ status: 200, headers, body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n` });
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await page.locator('.model-pill').click();
await page.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
await page.locator('#api-key').fill('test-key');
await page.getByRole('button', { name: '保存' }).click();
await page.getByRole('button', { name: '测试连接' }).click();
await page.getByText('连接成功', { exact: false }).waitFor({ timeout: 15000 });
await page.locator('.model-row').first().click();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.locator('.composer textarea').fill('Say hello');
await page.locator('.composer textarea').press('Enter');
await page.getByText('Browser agent works.').waitFor({ timeout: 15000 });
await page.locator('.composer textarea').fill('Read README');
await page.locator('.composer textarea').press('Enter');
await page.getByText('I read the workspace README.').waitFor({ timeout: 15000 });
console.log(JSON.stringify({ requests, moduleResponses, response: await page.getByText('Browser agent works.').textContent(), toolResult: (await page.locator('.tool-result').textContent())?.slice(0, 120), errors }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('I read the workspace README.').waitFor({ timeout: 30000 });
console.log(JSON.stringify({ sessionRestored: await page.getByText('Browser agent works.').count() }));
await browser.close();
