import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeMessages } from '../src/commands.js';

const DAY = 24 * 60 * 60 * 1000;

function makeChannel(count, { oldCount = 0 } = {}) {
  /** newest first */
  let store = Array.from({ length: count }, (_, index) => {
    const id = String(count - index);
    const age = oldCount > 0 && index >= count - oldCount ? 15 * DAY : index * 1000;
    return {
      id,
      createdTimestamp: Date.now() - age,
      async delete() {
        store = store.filter((message) => message.id !== id);
      },
    };
  });

  return {
    id: 'channel',
    name: 'test',
    messages: {
      async fetch({ limit, before } = {}) {
        const pool = before
          ? store.filter((message) => Number(message.id) < Number(before))
          : store;
        const page = pool.slice(0, limit);
        return new Map(page.map((message) => [message.id, message]));
      },
    },
    async bulkDelete(messages) {
      const ids = new Set(messages.map((message) => message.id));
      store = store.filter((message) => !ids.has(message.id));
      return { size: ids.size };
    },
    remaining: () => store.length,
  };
}

test('purges up to the requested amount in batches', async () => {
  const channel = makeChannel(250);
  const result = await purgeMessages(channel, 150);

  assert.equal(result.deleted, 150);
  assert.equal(result.skippedOld, 0);
  assert.equal(channel.remaining(), 100);
});

test('stops at the 14-day limit and reports skipped messages', async () => {
  const channel = makeChannel(120, { oldCount: 30 });
  const result = await purgeMessages(channel, 200);

  assert.equal(result.deleted, 90);
  assert.equal(result.skippedOld, 30);
  assert.equal(channel.remaining(), 30);
});

test('handles a single-message purge', async () => {
  const channel = makeChannel(5);
  const result = await purgeMessages(channel, 1);

  assert.equal(result.deleted, 1);
  assert.equal(channel.remaining(), 4);
});

test('handles an empty channel', async () => {
  const channel = makeChannel(0);
  const result = await purgeMessages(channel, 50);

  assert.equal(result.deleted, 0);
  assert.equal(result.skippedOld, 0);
});
