const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mediaId } = require('../lib/ssmusicMedia');

let baseUrl;
let server;
const statements = [];
const fakePool = {
  async connect() { return { query: fakePool.query, release() {} }; },
  async query(sql, values) {
    statements.push({ sql, values });
    if (sql.includes('is_locked')) return { rows: [{ is_locked: false }] };
    if (sql.includes('AS next_pos')) return { rows: [{ next_pos: 1 }] };
    if (sql.includes('AS anchor_pos')) return { rows: [{ anchor_pos: 2 }] };
    if (sql.includes('INSERT INTO queue')) {
      return { rows: [{
        id: 'item', video_id: values[3], source: values[7], media_path: values[8], media_type: values[9],
      }] };
    }
    return { rows: [] };
  },
};

before(async () => {
  require.cache[require.resolve('../db/db')] = { exports: fakePool };
  const app = express();
  app.use(express.json());
  app.use('/api/queue', require('../routes/queue'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/queue/party`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

for (const suffix of ['', '/play-next']) {
  test(`queue ${suffix || 'add'} persists legacy YouTube payloads and ssMusic metadata`, async () => {
    for (const media of [
      { video_id: 'abcdefghijk' },
      {
        video_id: mediaId('job/song.mp3'), source: 'ssmusic',
        media_path: 'job/song.mp3', media_type: 'audio',
      },
    ]) {
      const response = await fetch(`${baseUrl}${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ singer_name: 'Guest', video_title: 'Song', ...media }),
      });
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.source, media.source || 'youtube');
      assert.equal(result.media_path, media.media_path || null);
      assert.equal(result.media_type, media.media_type || null);
      const insert = statements.filter(({ sql }) => sql.includes('INSERT INTO queue')).at(-1);
      assert.match(insert.sql, /source, media_path, media_type/);
      assert.equal(insert.values[6], suffix ? 3 : 1);
    }
  });

  test(`queue ${suffix || 'add'} rejects forged ssMusic IDs before opening a transaction`, async () => {
    const previous = statements.length;
    const response = await fetch(`${baseUrl}${suffix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        singer_name: 'Guest', video_title: 'Song', source: 'ssmusic',
        video_id: 'forged', media_path: 'job/song.mp3', media_type: 'audio',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(statements.length, previous);
  });
}

test('queue reads include the persisted source and playback metadata', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const select = statements.at(-1).sql;
  assert.match(select, /q\.source, q\.media_path, q\.media_type/);
});
