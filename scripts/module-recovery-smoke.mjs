import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
let moduleFailed = false;
let pageLoads = 0;
page.on('load', () => { pageLoads += 1; });

await page.route((url) => /\/openai-completions-[^/]+\.js$/.test(url.pathname), async (route) => {
  if (!moduleFailed) {
    moduleFailed = true;
    await route.fulfill({ status: 504, body: 'Outdated Optimize Dep' });
  } else await route.continue();
});

await page.route('**/chat/completions', async (route) => {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'text/event-stream' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const chunks = [
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] },
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  await route.fulfill({ status: 200, headers, body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n` });
});

await page.goto('http://127.0.0.1:5173/');
await page.locator('.model-pill').click();
await page.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
await page.locator('#api-key').fill('test-key');
await page.getByRole('button', { name: '保存' }).click();
const reload = page.waitForEvent('load', { timeout: 15000 });
await page.getByRole('button', { name: '测试连接' }).click();
await reload;
await page.getByText('页面资源已更新，请重试刚才的操作。').waitFor({ timeout: 15000 });

await page.locator('.model-pill').click();
await page.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
await page.getByRole('button', { name: '测试连接' }).click();
await page.getByText('连接成功', { exact: false }).waitFor({ timeout: 15000 });

if (!moduleFailed || pageLoads < 2) throw new Error(`Expected a failed import and reload, got ${JSON.stringify({ moduleFailed, pageLoads })}`);
console.log(JSON.stringify({ moduleFailed, pageLoads, connectionRetried: true }));

const chatPage = await browser.newPage();
let chatModuleFailed = false;
await chatPage.route((url) => /\/openai-completions-[^/]+\.js$/.test(url.pathname), async (route) => {
  if (!chatModuleFailed) {
    chatModuleFailed = true;
    await route.fulfill({ status: 504, body: 'Outdated Optimize Dep' });
  } else await route.continue();
});
await chatPage.route('**/chat/completions', async (route) => {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'text/event-stream' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const chunks = [
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { content: 'Recovered chat.' }, finish_reason: null }] },
    { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  await route.fulfill({ status: 200, headers, body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n` });
});
await chatPage.goto('http://127.0.0.1:5173/');
await chatPage.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await chatPage.locator('.model-pill').click();
await chatPage.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
await chatPage.locator('#api-key').fill('test-key');
await chatPage.getByRole('button', { name: '保存' }).click();
await chatPage.locator('.model-row').first().click();
await chatPage.getByRole('button', { name: '关闭', exact: true }).click();
const chatReload = chatPage.waitForEvent('load', { timeout: 15000 });
await chatPage.locator('.composer textarea').fill('Hello');
await chatPage.locator('.composer textarea').press('Enter');
await chatReload;
await chatPage.getByText('页面资源已更新，请重试刚才的操作。').waitFor({ timeout: 15000 });
await chatPage.getByText('浏览器运行时已就绪').waitFor({ timeout: 30000 });
await chatPage.locator('.composer textarea').fill('Hello again');
await chatPage.locator('.composer textarea').press('Enter');
await chatPage.getByText('Recovered chat.').waitFor({ timeout: 15000 });
if (!chatModuleFailed) throw new Error('Expected chat module import to fail once');
console.log(JSON.stringify({ chatModuleFailed, chatRetried: true }));
await browser.close();
