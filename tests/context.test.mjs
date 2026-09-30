import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextManager } from '../src/context.ts';

const system = { role: 'system', content: 'You are Pi.', timestamp: 1 };
const oldUser = { role: 'user', content: 'Old project context. '.repeat(1600), timestamp: 2 };
const currentUser = { role: 'user', content: 'What should I do next?', timestamp: 3 };

function setup(overrides = {}) {
  const checkpoints = [];
  const statuses = [];
  const manager = createContextManager({
    models: {},
    getModel: () => ({ contextWindow: 4000, maxTokens: 512 }),
    onCheckpoint: (value) => checkpoints.push(value),
    onStatus: (value) => statuses.push(value),
    summarize: async (_previous, chunk) => { assert.match(chunk, /Old project context/); return 'The older project was described.'; },
    ...overrides,
  });
  return { manager, checkpoints, statuses };
}

test('compacts older context, preserves latest turn and reuses the checkpoint', async () => {
  const { manager, checkpoints, statuses } = setup();
  const messages = [system, oldUser, currentUser];
  const original = structuredClone(messages);
  const first = await manager.transformContext(messages);
  assert.equal(first.length, 3);
  assert.equal(first[0], system);
  assert.equal(first[1].role, 'system');
  assert.match(first[1].content, /older project/);
  assert.equal(first[2], currentUser);
  assert.equal(checkpoints[0].summarizedUntil, 2);
  assert.equal(statuses.at(-1).kind, 'compacted');
  assert.deepEqual(messages, original, 'UI transcript must remain intact');
  const nextUser = { role: 'user', content: 'And after that?', timestamp: 4 };
  const second = await manager.transformContext([...messages, nextUser]);
  assert.deepEqual(second.slice(2), [currentUser, nextUser]);
  assert.equal(checkpoints.length, 1);

  const restored = setup({ checkpoint: manager.getCheckpoint(), summarize: async () => { assert.fail('restored context should not need another summary'); } });
  assert.deepEqual((await restored.manager.transformContext([...messages, nextUser])).slice(2), [currentUser, nextUser]);
  assert.equal(restored.statuses.at(-1).kind, 'ready');
});

test('an oversized single turn stays intact and reports the unsafe boundary', async () => {
  const { manager, checkpoints, statuses } = setup();
  const messages = [system, oldUser];
  assert.deepEqual(await manager.transformContext(messages), messages);
  assert.equal(checkpoints.length, 0);
  assert.equal(statuses.at(-1).kind, 'error');
  assert.match(statuses.at(-1).message, /无法安全压缩/);
});

test('summary failure or cancellation does not publish a partial checkpoint', async () => {
  for (const cancelled of [false, true]) {
    let calls = 0;
    const { manager, checkpoints, statuses } = setup({ summarize: async () => { calls++; throw new Error('fixture summary failed'); } });
    const messages = [system, oldUser, currentUser];
    const signal = cancelled ? AbortSignal.abort() : undefined;
    assert.deepEqual(await manager.transformContext(messages, signal), messages);
    assert.equal(calls, cancelled ? 0 : 1);
    assert.equal(checkpoints.length, 0);
    assert.deepEqual(manager.getCheckpoint(), { summary: '', summarizedUntil: 1 });
    assert.equal(statuses.at(-1).kind, 'error');
  }
});
