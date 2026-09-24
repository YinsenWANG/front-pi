import assert from 'node:assert/strict';
import { createContextManager } from '../src/context.ts';

const system = { role: 'system', content: 'You are Pi.', timestamp: 1 };
const oldUser = { role: 'user', content: 'Old project context. '.repeat(1600), timestamp: 2 };
const currentUser = { role: 'user', content: 'What should I do next?', timestamp: 3 };
const checkpointUpdates = [];
const statuses = [];
const manager = createContextManager({
  models: {},
  getModel: () => ({ contextWindow: 4000, maxTokens: 512 }),
  onCheckpoint: (checkpoint) => checkpointUpdates.push(checkpoint),
  onStatus: (status) => statuses.push(status),
  summarize: async (_previous, chunk) => {
    assert.match(chunk, /Old project context/);
    return 'The user described an older project. Continue with the latest request.';
  },
});

const first = await manager.transformContext([system, oldUser, currentUser]);
assert.equal(first.length, 3);
assert.equal(first[1].role, 'system');
assert.match(first[1].content, /older project/);
assert.equal(first[2], currentUser);
assert.equal(checkpointUpdates[0].summarizedUntil, 2);
assert.equal(statuses.at(-1).kind, 'compacted');

const nextUser = { role: 'user', content: 'And after that?', timestamp: 4 };
const second = await manager.transformContext([system, oldUser, currentUser, nextUser]);
assert.equal(second.length, 4);
assert.equal(second[2], currentUser);
assert.equal(second[3], nextUser);
assert.equal(checkpointUpdates.length, 1);
console.log('context compaction and subsequent turn: ok');
