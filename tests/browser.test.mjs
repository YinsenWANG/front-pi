import assert from 'node:assert/strict';
import { before, after, test as nodeTest } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { launchBrowser } from './support/browser.mjs';
import { startServers } from './support/server.mjs';
import { configureProvider, mockProvider, savedSession, send } from './support/provider.mjs';

let browser;
let servers;
const pages = new WeakMap();
function test(name, options, run) {
  nodeTest(name, options, async (t) => {
    try { await run(t); }
    catch (error) {
      const page = pages.get(t);
      if (page && !page.isClosed()) {
        await mkdir('test-results', { recursive: true });
        await page.screenshot({ path: `test-results/${name.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true }).catch(() => {});
      }
      throw error;
    }
  });
}
const textOf = (content) => typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
before(async () => {
  servers = await startServers();
  browser = await launchBrowser();
}, { timeout: 60_000 });
after(async () => {
  await browser?.close();
  await servers?.close();
});

async function pageFor(t, url = servers.devUrl, { expectedModuleError = false, javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', javaScriptEnabled });
  const page = await context.newPage();
  pages.set(t, page);
  page.setDefaultTimeout(15_000);
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // All external traffic is blocked by default. Provider mocks override this
  // route, so an accidental live request cannot consume credentials or quota.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
    external.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  t.after(async () => {
    try {
      if (errors.length || external.length) {
        await mkdir('test-results', { recursive: true });
        await page.screenshot({ path: `test-results/${t.name.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true });
      }
      assert.deepEqual(external, [], 'unexpected external network request');
      assert.deepEqual(expectedModuleError ? errors.filter((error) => !/Failed to fetch dynamically imported module/.test(error)) : errors, []);
    } finally { await context.close(); }
  });
  return page;
}

async function ready(page) {
  await page.goto(servers.devUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('浏览器运行时已就绪', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__fixtureBoots), 1);
}

for (const mode of ['dev', 'preview']) {
  test(`${mode} serves COOP/COEP and enables browser isolation`, { timeout: 30_000 }, async (t) => {
    const url = mode === 'dev' ? servers.devUrl : servers.previewUrl;
    // Preview checks the real production bundle without substituting WebContainer.
    const page = await pageFor(t, url, { javaScriptEnabled: false });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cross-origin-opener-policy'], 'same-origin');
    assert.equal(response.headers()['cross-origin-embedder-policy'], 'credentialless');
    assert.equal(await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer === 'function'), true);
    // No external WebContainer runtime is needed to verify production headers.
  });
}

test('mock agent connects, streams, executes read_file and restores the transcript', { timeout: 60_000 }, async (t) => {
  const page = await pageFor(t);
  const requests = await mockProvider(page, (payload, count) => {
    if (payload.messages.some((message) => message.content === 'Reply with OK.')) return { content: 'OK' };
    if (count === 2) return { content: 'Browser agent works.' };
    if (count === 3) return { tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] };
    assert.equal(count, 4);
    const tool = payload.messages.find((message) => message.role === 'tool');
    assert.match(tool.content, /# Front Pi Workspace/);
    assert.equal(tool.tool_call_id, 'call_read');
    return { content: 'I read the workspace README.' };
  });
  await ready(page);
  await configureProvider(page, { connection: true });
  await send(page, 'Say hello', 'Browser agent works.');
  await send(page, 'Read README', 'I read the workspace README.');
  assert.match(await page.locator('.tool-result').textContent(), /read_file.*# Front Pi Workspace/s);
  const saved = await savedSession(page);
  assert.ok(saved.messages.some((message) => message.role === 'toolResult' && message.toolCallId === 'call_read'));
  assert.equal(requests.length, 4);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('浏览器运行时已就绪', { exact: true }).waitFor();
  await page.getByText('I read the workspace README.', { exact: true }).waitFor();
  assert.deepEqual((await savedSession(page)).messages, saved.messages);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pi-browser:key:deepseek')), 'front-pi-test-key');
  assert.equal(await page.evaluate(() => localStorage.getItem('pi-browser:key:deepseek')), null);
  assert.equal(requests.length, 4, 'reload must not replay provider requests');
});

test('terminal writes persist in the IndexedDB workspace snapshot after refresh', { timeout: 45_000 }, async (t) => {
  const page = await pageFor(t);
  await ready(page);
  await page.locator('.workspace-tabs').getByRole('button', { name: '终端' }).click();
  for (const [index, command] of ['echo browser-ok', 'echo persisted > note.txt'].entries()) {
    await page.locator('.terminal-command input').fill(command);
    await page.locator('.terminal-command input').press('Enter');
    await page.waitForFunction((count) => (document.querySelector('.terminal-view pre').textContent.match(/\[exit 0\]/g) || []).length === count, index + 1);
  }
  assert.match(await page.locator('.terminal-view pre').textContent(), /browser-ok/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('浏览器运行时已就绪', { exact: true }).waitFor();
  await page.locator('.file-items').getByRole('button', { name: 'note.txt' }).click();
  assert.equal(await page.locator('.file-preview pre').textContent(), 'persisted\n');
  assert.equal(await page.evaluate(() => window.__fixtureBoots), 1, 'a fresh runtime restores persisted bytes');
});

for (const trigger of ['connection', 'chat']) {
  test(`failed provider module recovers once during ${trigger}, then retry succeeds`, { timeout: 60_000 }, async (t) => {
    const page = await pageFor(t, servers.devUrl, { expectedModuleError: true });
    let failures = 0;
    let loads = 0;
    page.on('load', () => loads++);
    await page.route((url) => /\/openai-completions-[^/]+\.js$/.test(url.pathname), async (route) => {
      if (!failures) { failures++; await route.fulfill({ status: 504, body: 'Outdated Optimize Dep' }); }
      else await route.continue();
    });
    const requests = await mockProvider(page, () => ({ content: 'Recovered chat.' }));
    await ready(page);
    await configureProvider(page);
    const reload = page.waitForEvent('load');
    if (trigger === 'connection') {
      await page.locator('.model-pill').click();
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
    } else {
      await page.locator('.composer textarea').fill('Hello before recovery');
      await page.locator('.composer textarea').press('Enter');
    }
    await reload;
    await page.getByText('页面资源已更新，请重试刚才的操作。', { exact: true }).waitFor();
    await page.getByText('浏览器运行时已就绪', { exact: true }).waitFor();
    assert.equal(failures, 1);
    assert.equal(loads, 2);
    assert.equal(requests.length, 0, 'failed import and refresh must not issue a model request');
    assert.ok(await page.evaluate(() => Number(sessionStorage.getItem('pi-browser:module-reload-at'))));
    if (trigger === 'connection') {
      await page.locator('.model-pill').click();
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await page.getByText('连接成功', { exact: false }).waitFor();
    } else await send(page, 'Hello after recovery', 'Recovered chat.');
    assert.equal(requests.length, 1);
    assert.equal(loads, 2);
  });
}

for (const boundary of ['repeated', 'unavailable']) {
  test(`module recovery avoids reload when ${boundary}`, { timeout: 30_000 }, async (t) => {
    const page = await pageFor(t, servers.devUrl, { expectedModuleError: true });
    let loads = 0;
    let failures = 0;
    page.on('load', () => loads++);
    await page.route((url) => /\/openai-completions-[^/]+\.js$/.test(url.pathname), async (route) => {
      failures++;
      await route.fulfill({ status: 504, body: 'Outdated Optimize Dep' });
    });
    const requests = await mockProvider(page, () => { assert.fail('failed module must not call provider'); });
    await ready(page);
    await configureProvider(page);
    if (boundary === 'repeated') await page.evaluate(() => sessionStorage.setItem('pi-browser:module-reload-at', String(Date.now())));
    else await page.route(`${servers.devUrl}/`, async (route) => {
      if (route.request().method() === 'HEAD') await route.fulfill({ status: 503, body: 'Unavailable' });
      else await route.continue();
    });
    await page.locator('.model-pill').click();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText(boundary === 'repeated' ? '页面资源仍无法加载。请强制刷新页面后重试。' : '页面资源无法加载。请确认网站服务仍在运行，然后刷新页面。', { exact: true }).waitFor();
    assert.equal(loads, 1);
    assert.equal(failures, 1);
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('pi-browser:module-recovery-notice')), null);
  });
}

test('context compaction persists a checkpoint, preserves UI history and reuses it after reload', { timeout: 60_000 }, async (t) => {
  const page = await pageFor(t);
  const summaries = [];
  const chats = [];
  await mockProvider(page, (payload) => {
    if (payload.messages.some((message) => String(message.content).includes('You summarize a coding-agent conversation'))) {
      summaries.push(payload);
      return { content: 'Previous project context summarized.' };
    }
    chats.push(payload);
    return { content: ['Old context received.', 'I can continue with the summary.', 'Checkpoint reused.'][chats.length - 1] };
  });
  await ready(page);
  await configureProvider(page);
  async function smallContext() {
    await page.evaluate(async () => {
      const { models } = await import('/src/providers.ts');
      models.getModel('deepseek', 'deepseek-flash').contextWindow = 4000;
    });
  }
  await smallContext();
  const old = 'Old project context. '.repeat(1200).trim();
  await send(page, old, 'Old context received.');
  await send(page, 'Continue using the old context.', 'I can continue with the summary.');
  const saved = await savedSession(page);
  assert.ok(summaries.length > 0);
  assert.equal(saved.summary, 'Previous project context summarized.');
  assert.ok(saved.summarizedUntil > 1);
  assert.ok(saved.messages.some((message) => message.role === 'user' && textOf(message.content) === old));
  assert.ok(chats[1].messages.some((message) => String(message.content).includes(saved.summary)));
  assert.ok(!chats[1].messages.some((message) => textOf(message.content || '') === old));
  const summaryCount = summaries.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('浏览器运行时已就绪', { exact: true }).waitFor();
  await smallContext();
  await send(page, 'What is next?', 'Checkpoint reused.');
  assert.equal(summaries.length, summaryCount);
  assert.ok(chats[2].messages.some((message) => String(message.content).includes(saved.summary)));
  assert.equal((await savedSession(page)).summarizedUntil, saved.summarizedUntil);
  assert.equal(await page.locator('.message-user .message-text').first().textContent(), old.trim());
});
