import assert from 'node:assert/strict';

// Intercept at the network boundary: the real Pi SDK, streaming parser and Agent
// loop still run. No production provider, key proxy, or runtime switch is added.
export async function mockProvider(page, respond) {
  const requests = [];
  await page.route('https://api.deepseek.com/**', async (route) => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'text/event-stream' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    assert.match(new URL(request.url()).pathname, /\/chat\/completions$/);
    assert.equal(request.method(), 'POST');
    assert.equal(request.headers().authorization, 'Bearer front-pi-test-key');
    const payload = request.postDataJSON();
    requests.push(payload);
    const delta = await respond(payload, requests.length);
    const chunk = (value, finish_reason) => ({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: payload.model,
      choices: [{ index: 0, delta: value, finish_reason }] });
    const chunks = [chunk({ role: 'assistant', ...delta }, null), chunk({}, delta.tool_calls ? 'tool_calls' : 'stop')];
    await route.fulfill({ status: 200, headers, body: `${chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('')}data: [DONE]\n\n` });
  });
  return requests;
}

export async function configureProvider(page, { connection = false } = {}) {
  await page.locator('.model-pill').click();
  await page.locator('.provider-row').filter({ hasText: 'DeepSeek' }).click();
  await page.locator('#api-key').fill('front-pi-test-key');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '已保存', exact: true }).waitFor();
  await page.locator('.model-row').first().click();
  if (connection) {
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('连接成功', { exact: false }).waitFor();
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}

export async function send(page, prompt, reply) {
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  await page.locator('.composer textarea').fill(prompt);
  await page.locator('.composer textarea').press('Enter');
  if (reply) await page.locator('.message-text').getByText(reply, { exact: true }).waitFor();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
}

export async function savedSession(page) {
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pi-browser:sessions:v1') || '[]')[0]?.messages.length);
  return page.evaluate(() => JSON.parse(localStorage.getItem('pi-browser:sessions:v1'))[0]);
}
