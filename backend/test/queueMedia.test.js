const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const axios = require('axios');
const { mediaId } = require('../lib/ssmusicMedia');
const { createSsmusicJobs } = require('../lib/ssmusicJobs');
const { SsmusicError } = require('../lib/ssmusicClient');

let baseUrl;
let server;
let conversionItem;
let submitJob;
let removalItem;
let removeJob;
let partyLocked = false;
let checkedOutClients = 0;
const statements = [];
const fakePool = {
  async connect() {
    checkedOutClients += 1;
    return { query: fakePool.query, release() { checkedOutClients -= 1; } };
  },
  async query(sql, values) {
    statements.push({ sql, values });
    if (sql.includes('JOIN parties p')) return { rows: conversionItem ? [{ ...conversionItem }] : [] };
    if (sql.startsWith('SELECT * FROM queue WHERE id')) return { rows: removalItem ? [{ ...removalItem }] : [] };
    if (sql.startsWith('DELETE FROM queue')) { removalItem = null; return { rows: [] }; }
    if (sql.includes('is_locked')) return { rows: [{ is_locked: partyLocked }] };
    if (sql.includes('AS next_pos')) return { rows: [{ next_pos: 1 }] };
    if (sql.includes('AS anchor_pos')) return { rows: [{ anchor_pos: 2 }] };
    if (sql.includes('INSERT INTO queue')) {
      return { rows: [{
        id: 'item', party_id: values[0], member_id: values[1], singer_name: values[2],
        video_id: values[3], video_title: values[4], video_thumbnail: values[5], position: values[6], status: 'queued',
        source: values[7], media_path: values[8], media_type: values[9],
      }] };
    }
    return { rows: [] };
  },
};

before(async () => {
  require.cache[require.resolve('../db/db')] = { exports: fakePool };
  const app = express();
  app.use(express.json());
  app.set('ssmusicJobs', {
    submit: (item) => submitJob(item),
    withPlaylistVideo: (item, operation) => operation(),
    removeReference: (item, client) => removeJob(item, client),
  });
  app.use('/api/queue', require('../routes/queue'));
  app.use('/api/youtube', require('../routes/youtube'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/queue/party`;
});

beforeEach((context) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  context.after(() => {
    if (apiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = apiKey;
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

for (const suffix of ['', '/play-next']) {
  test(`queue ${suffix || 'add'} persists legacy YouTube payloads and ssMusic metadata`, async () => {
    for (const media of [
      { video_id: 'abcdefghijk', video_thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/default.jpg' },
      {
        video_id: mediaId('job/song.mp3'), source: 'ssmusic',
        media_path: 'job/song.mp3', media_type: 'audio',
        video_thumbnail: `/ssmusic/artwork?path=${'a'.repeat(600)}`,
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
      assert.equal(insert.values[5], media.source === 'ssmusic' ? null : media.video_thumbnail);
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
  assert.match(select, /q\.ssmusic_job_id, q\.ssmusic_status, q\.ssmusic_error/);
  assert.match(select, /q\."kpMedia", q\.youtube_video_id/);
});

test('YouTube searches return all results without embedding or category filters', async (context) => {
  process.env.YOUTUBE_API_KEY = 'test-youtube-key';
  const items = ['abcdefghijk', 'restricted1'].map((videoId) => ({
    id: { videoId }, snippet: { title: videoId, channelTitle: 'Channel', thumbnails: {} },
  }));
  const lookup = context.mock.method(axios, 'get', async (url, options) => {
    assert.equal(url, 'https://www.googleapis.com/youtube/v3/search');
    assert.equal(options.params.type, 'video');
    assert.equal(options.params.videoEmbeddable, undefined);
    assert.equal(options.params.videoSyndicated, undefined);
    assert.equal(options.params.videoCategoryId, undefined);
    return { data: { items } };
  });
  for (const karaoke of ['false', 'true']) {
    const url = new URL('/api/youtube/search', baseUrl);
    url.search = new URLSearchParams({ q: 'song', karaoke, videoEmbeddable: 'true' }).toString();
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((item) => item.video_id), ['abcdefghijk', 'restricted1']);
    assert.equal(lookup.mock.calls.at(-1).arguments[1].params.q, karaoke === 'true' ? 'song karaoke' : 'song');
  }
});

for (const suffix of ['', '/play-next']) {
  const payload = { member_id: 'member', singer_name: 'Guest', video_id: 'abcdefghijk', video_title: 'Song' };
  const add = () => fetch(`${baseUrl}${suffix}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  test(`queue ${suffix || 'add'} sends restricted videos to ssMusic after saving the queued item`, async (context) => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    let video;
    context.mock.method(axios, 'get', async (url, options) => {
      assert.equal(checkedOutClients, 0);
      assert.equal(url, 'https://www.googleapis.com/youtube/v3/videos');
      assert.equal(options.params.part, 'status,contentDetails');
      assert.equal(options.params.id, payload.video_id);
      assert.equal(options.timeout, 5000);
      return { data: { items: video ? [video] : [] } };
    });
    let submitted;
    submitJob = async (item) => {
      assert.equal(checkedOutClients, 0);
      assert.equal(statements.at(-1).sql, 'COMMIT');
      submitted = item;
      return { ...item, ssmusic_job_id: 'job', ssmusic_status: 'queued' };
    };
    for (const restricted of [
      { status: { embeddable: false } },
      { status: { embeddable: true, privacyStatus: 'private' } },
      { contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } },
      { contentDetails: { regionRestriction: { blocked: ['US'] } } },
      { contentDetails: { regionRestriction: { allowed: ['US'] } } },
      { contentDetails: { regionRestriction: { allowed: [] } } },
      null,
    ]) {
      video = restricted;
      submitted = null;
      const response = await add();
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(submitted.id, 'item');
      assert.equal(submitted.party_id, 'party');
      assert.equal(submitted.video_id, payload.video_id);
      assert.equal(result.id, submitted.id);
      assert.equal(result.member_id, 'member');
      assert.equal(result.singer_name, 'Guest');
      assert.equal(result.status, 'queued');
      assert.equal(result.position, suffix ? 3 : 1);
      assert.equal(result.ssmusic_status, 'queued');
      assert.equal(result.ssmusic_job_id, 'job');
    }
  });

  test(`queue ${suffix || 'add'} leaves playable YouTube and library media unchanged`, async (context) => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    const lookup = context.mock.method(axios, 'get', async () => ({ data: { items: [{
      status: { embeddable: true, privacyStatus: 'public' }, contentDetails: { regionRestriction: { blocked: [] } },
    }] } }));
    submitJob = async () => assert.fail('Unexpected ssMusic submission');
    const response = await add();
    assert.equal(response.status, 201);
    assert.equal((await response.json()).ssmusic_status, undefined);
    const libraryResponse = await fetch(`${baseUrl}${suffix}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, source: 'ssmusic', video_id: mediaId('job/song.mp3'),
        media_path: 'job/song.mp3', media_type: 'audio' }),
    });
    assert.equal(libraryResponse.status, 201);
    assert.equal((await libraryResponse.json()).source, 'ssmusic');
    assert.equal(lookup.mock.callCount(), 1);
  });

  test(`queue ${suffix || 'add'} keeps a saved item when restriction lookup or processing fails`, async (context) => {
    let lookupFailed = true;
    const lookup = context.mock.method(axios, 'get', async () => {
      if (lookupFailed) throw new Error('YouTube quota exceeded');
      return { data: { items: [{ status: { embeddable: false } }] } };
    });
    submitJob = async () => assert.fail('Unexpected ssMusic submission');
    assert.equal((await add()).status, 201);
    assert.equal(lookup.mock.callCount(), 0);
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    const unchecked = await add();
    assert.equal(unchecked.status, 201);
    assert.equal((await unchecked.json()).ssmusic_status, undefined);
    lookupFailed = false;
    for (const failure of [new SsmusicError(503, 'ssMusic is unavailable'), new Error('private configuration')]) {
      submitJob = async () => { throw failure; };
      const start = statements.length;
      const response = await add();
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.id, 'item');
      assert.equal(result.source, 'youtube');
      assert.equal(result.ssmusic_status, 'error');
      assert.equal(result.ssmusic_error, failure instanceof SsmusicError ? failure.message : 'Failed to send video to ssMusic');
      assert.equal(statements.slice(start).some(({ sql }) => sql === 'ROLLBACK'), false);
    }
  });

  test(`queue ${suffix || 'add'} does not check or submit restricted videos for a locked party`, async (context) => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    partyLocked = true;
    context.after(() => { partyLocked = false; });
    const lookup = context.mock.method(axios, 'get', async () => assert.fail('Unexpected YouTube lookup'));
    submitJob = async () => assert.fail('Unexpected ssMusic submission');
    assert.equal((await add()).status, 423);
    assert.equal(lookup.mock.callCount(), 0);
  });
}

test('queue conversion endpoint returns pending and immediately ready items', async () => {
  conversionItem = { id: 'item', party_id: 'party', source: 'youtube', is_locked: false };
  for (const source of ['youtube', 'ssmusic']) {
    submitJob = async (item) => ({ ...item, source, ssmusic_job_id: 'job' });
    const response = await fetch(`${baseUrl}/item/ssmusic`, { method: 'POST' });
    assert.equal(response.status, source === 'ssmusic' ? 200 : 202);
    const result = await response.json();
    assert.equal(result.id, 'item');
    assert.equal(result.source, source);
    assert.equal(result.ssmusic_job_id, 'job');
    assert.deepEqual(statements.at(-1).values, ['item', 'party']);
  }
});

test('queue conversion rejects missing, locked, and ssMusic items before submitting', async () => {
  submitJob = async () => { assert.fail('Unexpected ssMusic submission'); };
  for (const [item, status] of [[null, 404], [{ source: 'youtube', is_locked: true }, 423], [{ source: 'ssmusic' }, 400]]) {
    conversionItem = item;
    const response = await fetch(`${baseUrl}/item/ssmusic`, { method: 'POST' });
    assert.equal(response.status, status);
  }
});

test('queue conversion returns safe upstream errors without credentials', async () => {
  conversionItem = { id: 'item', party_id: 'party', source: 'youtube', is_locked: false };
  submitJob = async () => { throw new SsmusicError(409, 'ssMusic video is private or unavailable'); };
  const conflict = await fetch(`${baseUrl}/item/ssmusic`, { method: 'POST' });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'ssMusic video is private or unavailable' });
  submitJob = async () => { throw new Error('private connection configuration'); };
  const failure = await fetch(`${baseUrl}/item/ssmusic`, { method: 'POST' });
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: 'Failed to send video to ssMusic' });
});

test('queue deletion releases only kpMedia references before deleting the local row', async () => {
  for (const source of ['youtube', 'ssmusic']) {
    for (const kpMedia of [false, true]) {
      removalItem = { id: 'item', party_id: 'party', source, kpMedia, youtube_video_id: kpMedia ? 'cMoRYP8EDUk' : null };
      let released = false;
      removeJob = async (item, client) => {
        assert.ok(removalItem);
        assert.deepEqual(item, removalItem);
        assert.equal(typeof client.query, 'function');
        released = true;
      };
      const response = await fetch(`${baseUrl}/item`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
      assert.equal(released, kpMedia);
      assert.equal(removalItem, null);
    }
  }
});

test('failed ssMusic removal rolls back and keeps the local row available for retry', async () => {
  for (const status of [403, 409, 502, 503]) {
    removalItem = { id: 'item', party_id: 'party', source: 'ssmusic', kpMedia: true, youtube_video_id: 'cMoRYP8EDUk' };
    removeJob = async () => { throw new SsmusicError(status, 'Removal blocked; try again when the job is idle'); };
    const start = statements.length;
    const response = await fetch(`${baseUrl}/item`, { method: 'DELETE' });
    assert.equal(response.status, status);
    assert.match((await response.json()).error, /Removal blocked/);
    assert.ok(removalItem);
    assert.equal(statements.slice(start).some(({ sql }) => sql.startsWith('DELETE FROM queue')), false);
    assert.equal(statements.at(-1).sql, 'ROLLBACK');
  }
});

test('missing and locked queue rows never release upstream references', async (context) => {
  context.after(() => { partyLocked = false; });
  removeJob = async () => assert.fail('Unexpected reference removal');
  removalItem = null;
  assert.equal((await fetch(`${baseUrl}/item`, { method: 'DELETE' })).status, 404);
  partyLocked = true;
  removalItem = { id: 'item', party_id: 'party', kpMedia: true, youtube_video_id: 'cMoRYP8EDUk' };
  assert.equal((await fetch(`${baseUrl}/item`, { method: 'DELETE' })).status, 423);
  assert.ok(removalItem);
});

function jobFixture(context, request, initialItems) {
  const items = new Map((initialItems || ['first', 'second'].map((id, index) => ({
    id, party_id: 'party', member_id: `member-${id}`, singer_name: `Singer ${id}`, video_title: `Song ${id}`,
    video_id: index ? 'RTcsY6aIoEc' : 'cMoRYP8EDUk', source: 'youtube', media_path: null, media_type: null,
    kpMedia: false, youtube_video_id: null,
    video_thumbnail: 'https://i.ytimg.com/thumbnail.jpg', position: index + 1, status: index ? 'queued' : 'playing',
  }))).map((item) => [item.id, item]));
  const scheduled = [];
  const events = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT')) {
        const selected = [...items.values()].filter((item) => {
          if (sql.includes('WHERE id')) return item.id === values[0] && item.party_id === values[1];
          if (sql.includes('ssmusic_status IN')) {
            return item.source === 'youtube' && ['submitting', 'queued', 'running'].includes(item.ssmusic_status);
          }
          if (sql.includes('"kpMedia" = TRUE')) {
            return item.party_id === values[0] && item.id !== values[1] && item.kpMedia && item.youtube_video_id === values[2];
          }
          return item.party_id === values[0];
        });
        return { rows: selected.map((item) => ({ ...item })) };
      }
      assert.match(sql, /AND source = 'youtube' AND video_id = \$/);
      let item;
      if (sql.includes("SET ssmusic_status = 'submitting'")) {
        item = items.get(values[0]);
        if (item?.source === 'youtube' && item.party_id === values[1] && item.video_id === values[2]) {
          assert.match(sql, /"kpMedia" = TRUE, youtube_video_id = video_id/);
          Object.assign(item, { ssmusic_status: 'submitting', ssmusic_error: null, kpMedia: true, youtube_video_id: item.video_id });
        } else item = null;
      } else if (sql.includes("SET ssmusic_status = 'error'")) {
        item = items.get(values[1]);
        if (item?.source === 'youtube' && item.party_id === values[2] && item.video_id === values[3]) {
          Object.assign(item, { ssmusic_status: 'error', ssmusic_error: values[0] });
        } else item = null;
      } else {
        assert.match(sql, /UPDATE queue SET source = \$1/);
        item = items.get(values[7]);
        if (item?.source === 'youtube' && item.party_id === values[8] && item.video_id === values[9]) {
          Object.assign(item, {
            source: values[0], video_id: values[1], media_path: values[2], media_type: values[3],
            video_thumbnail: values[4], ssmusic_job_id: values[5], ssmusic_status: values[6], ssmusic_error: null,
          });
        } else item = null;
      }
      return { rows: item ? [{ ...item }] : [] };
    },
  };
  const jobs = createSsmusicJobs({ pool, client: { request },
    io: { to: (partyId) => ({ emit: (event, payload) => events.push({ partyId, event, ...payload }) }) },
    schedule: (callback) => { scheduled.push(callback); return {}; }, cancel() {},
  });
  context.after(() => jobs.close());
  return { jobs, items, scheduled, events };
}

function readyJob(jobId, name = 'Party clip.mp4') {
  return { status: 200, data: { jobId, status: 'completed', ready: true, duplicate: true,
    action: 'add', playlistId: 'party', playlistCount: 1,
    statusUrl: `/api/karaoke/jobs/${jobId}`, playUrl: `/api/jobs/${jobId}/stream/${encodeURIComponent(name)}`,
    playerUrl: `/job/${jobId}/player?song=${encodeURIComponent(name)}&play=1` } };
}

test('multiple YouTube jobs finish out of order without losing queue identity, edits, or playback status', async (context) => {
  const requests = [];
  const responses = [];
  const { jobs, items, scheduled, events } = jobFixture(context, (endpoint, options) => {
    requests.push({ endpoint, ...options });
    return new Promise((resolve) => responses.push(resolve));
  });
  const first = jobs.submit(items.get('first'));
  const second = jobs.submit(items.get('second'));
  assert.equal(jobs.submit(items.get('first')), first);
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ endpoint, method, data }) => ({ endpoint, method, data })), [
    { endpoint: 'api/karaoke/jobs', method: 'POST', data: { action: 'add', videoURL: 'https://www.youtube.com/watch?v=cMoRYP8EDUk', playlistId: 'party' } },
    { endpoint: 'api/karaoke/jobs', method: 'POST', data: { action: 'add', videoURL: 'https://www.youtube.com/watch?v=RTcsY6aIoEc', playlistId: 'party' } },
  ]);
  items.get('second').position = 4;
  items.get('second').singer_name = 'Updated singer';
  responses[1](readyJob('second-job'));
  const convertedSecond = await second;
  assert.equal(convertedSecond.source, 'ssmusic');
  assert.equal(convertedSecond.video_id, mediaId('second-job/Party clip.mp4'));
  assert.equal(convertedSecond.media_type, 'video');
  assert.equal(convertedSecond.position, 4);
  assert.equal(convertedSecond.singer_name, 'Updated singer');
  assert.equal(convertedSecond.member_id, 'member-second');
  assert.equal(convertedSecond.status, 'queued');
  assert.equal(convertedSecond.kpMedia, true);
  assert.equal(convertedSecond.youtube_video_id, 'RTcsY6aIoEc');
  assert.equal(items.get('first').source, 'youtube');

  responses[0]({ status: 202, data: { jobId: 'first-job', status: 'queued', ready: false, playUrl: null,
    action: 'add', playlistId: 'party', playlistCount: 1 } });
  assert.equal((await first).source, 'youtube');
  assert.equal(items.get('first').ssmusic_job_id, 'first-job');
  assert.equal(scheduled.length, 1);
  const polling = scheduled.shift()();
  await new Promise(setImmediate);
  assert.equal(requests[2].endpoint, 'api/karaoke/jobs/first-job');
  assert.equal(requests[2].method, 'GET');
  responses[2](readyJob('first-job', 'Karaoke #1.webm'));
  await polling;
  assert.equal(items.get('first').media_path, 'first-job/Karaoke #1.webm');
  assert.equal(items.get('first').status, 'playing');
  assert.equal(items.get('second').media_path, 'second-job/Party clip.mp4');
  assert.equal(scheduled.length, 0);
  assert.ok(events.every(({ partyId, event, action }) => partyId === 'party' && event === 'queue:update' && action === 'media'));
  assert.ok(events.at(-1).queue.every((item) => item.source === 'ssmusic'));
});

test('failed, private, missing-file, and unsafe job responses leave YouTube media untouched and allow retry', async (context) => {
  const failures = [
    { data: { jobId: 'job', status: 'failed', ready: false, playUrl: null } },
    { data: { jobId: 'job', status: 'completed', ready: false, playUrl: null } },
    ...['https://other.example/api/jobs/job/stream/song.mp4', '/api/jobs/other/stream/song.mp4',
      '/api/jobs/job/stream/..%2Fsong.mp4', '/api/jobs/job/stream/song.mp3', '/api/jobs/job/stream/song.mp4?key=secret',
      '/api/jobs/job/stream/%ZZ.mp4'].map((playUrl) => ({ data: { jobId: 'job', status: 'completed', ready: true, playUrl } })),
    new SsmusicError(409, 'ssMusic video is private or unavailable'),
  ];
  for (const response of failures) {
    let retried = false;
    const { jobs, items, scheduled } = jobFixture(context, async () => {
      if (retried) return readyJob('job');
      if (response instanceof Error) throw response;
      return { ...response, data: { action: 'add', playlistId: 'party', playlistCount: 1, ...response.data } };
    });
    await assert.rejects(jobs.submit(items.get('first')), SsmusicError);
    assert.equal(items.get('first').source, 'youtube');
    assert.equal(items.get('first').video_id, 'cMoRYP8EDUk');
    assert.equal(items.get('first').media_path, null);
    assert.equal(items.get('first').ssmusic_status, 'error');
    assert.ok(items.get('first').ssmusic_error);
    assert.equal(scheduled.length, 0);
    retried = true;
    await jobs.submit(items.get('first'));
    assert.equal(items.get('first').source, 'ssmusic');
    assert.equal(items.get('first').ssmusic_error, null);
  }
});

test('completed jobs cannot recreate deleted queue items', async (context) => {
  let respond;
  const { jobs, items, scheduled } = jobFixture(context, () => new Promise((resolve) => { respond = resolve; }));
  const pending = jobs.submit(items.get('first'));
  await new Promise(setImmediate);
  items.delete('first');
  respond(readyJob('first-job'));
  assert.equal(await pending, null);
  assert.equal(items.has('first'), false);
  assert.equal(scheduled.length, 0);
});

test('persisted jobs resume by job ID after restart and reject mismatched polling responses', async (context) => {
  const requests = [];
  const { jobs, items, scheduled } = jobFixture(context, async (endpoint, options) => {
    requests.push({ endpoint, ...options });
    return readyJob(endpoint.endsWith('first-job') ? 'first-job' : 'wrong-job');
  });
  Object.assign(items.get('first'), { ssmusic_job_id: 'first-job', ssmusic_status: 'queued', kpMedia: true, youtube_video_id: 'cMoRYP8EDUk' });
  Object.assign(items.get('second'), { ssmusic_job_id: 'second-job', ssmusic_status: 'running', kpMedia: true, youtube_video_id: 'RTcsY6aIoEc' });
  await jobs.resume();
  assert.deepEqual(requests.map(({ endpoint, method, data }) => ({ endpoint, method, data })), [
    { endpoint: 'api/karaoke/jobs/first-job', method: 'GET', data: undefined },
    { endpoint: 'api/karaoke/jobs/second-job', method: 'GET', data: undefined },
  ]);
  assert.equal(items.get('first').source, 'ssmusic');
  assert.equal(items.get('second').source, 'youtube');
  assert.equal(items.get('second').ssmusic_status, 'error');
  assert.equal(scheduled.length, 0);
});

test('pending jobs from before playlist tracking register a named reference when resumed', async (context) => {
  const requests = [];
  const { jobs, items } = jobFixture(context, async (endpoint, options) => {
    requests.push({ endpoint, ...options });
    return readyJob('first-job');
  });
  Object.assign(items.get('first'), { ssmusic_job_id: 'first-job', ssmusic_status: 'queued' });
  await jobs.resume();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].data, { action: 'add', videoURL: 'https://www.youtube.com/watch?v=cMoRYP8EDUk', playlistId: 'party' });
  assert.equal(items.get('first').kpMedia, true);
});

function removedReference(overrides = {}) {
  return { status: 200, data: { action: 'remove', playlistId: 'party', removed: true,
    videoDeleted: true, playlistCount: 0, ...overrides } };
}

test('kpMedia removal uses its original YouTube URL and accepts idempotent or retained-video success', async (context) => {
  for (const result of [removedReference(), removedReference({ removed: false, videoDeleted: false }),
    removedReference({ videoDeleted: false, playlistCount: 2, retainedReason: 'playlist_references' })]) {
    const requests = [];
    const { jobs, items } = jobFixture(context, async (endpoint, options) => {
      requests.push({ endpoint, ...options });
      return result;
    });
    const item = items.get('first');
    Object.assign(item, { source: 'ssmusic', video_id: 'ssm_converted', kpMedia: true, youtube_video_id: 'cMoRYP8EDUk' });
    await jobs.removeReference(item);
    assert.deepEqual(requests, [{ endpoint: 'api/karaoke/jobs', method: 'POST',
      data: { action: 'remove', videoURL: 'https://www.youtube.com/watch?v=cMoRYP8EDUk', playlistId: 'party' } }]);
  }
});

test('ordinary YouTube and ssMusic rows do not send removal actions', async (context) => {
  const { jobs, items } = jobFixture(context, async () => assert.fail('Unexpected upstream removal'));
  await jobs.removeReference(items.get('first'));
  Object.assign(items.get('second'), { source: 'ssmusic', video_id: 'ssm_library' });
  await jobs.removeReference(items.get('second'));
});

test('concurrent duplicate removals release a party reference only after its last local copy', async (context) => {
  const requests = [];
  const { jobs, items } = jobFixture(context, async (endpoint, options) => {
    requests.push({ endpoint, ...options });
    return removedReference();
  });
  for (const item of items.values()) {
    Object.assign(item, { kpMedia: true, youtube_video_id: 'cMoRYP8EDUk', source: 'ssmusic', video_id: 'ssm_shared' });
  }
  await Promise.all([...items.values()].map(item => jobs.withPlaylistVideo(item, async () => {
    await jobs.removeReference(item);
    items.delete(item.id);
  })));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].data.playlistId, 'party');
  assert.equal(items.size, 0);
});

test('another party copy is left to ssMusic reference counting, not treated as a local duplicate', async (context) => {
  const requests = [];
  const { jobs, items } = jobFixture(context, async (endpoint, options) => {
    requests.push(options.data);
    return removedReference({ videoDeleted: false, playlistCount: 1 });
  });
  for (const item of items.values()) Object.assign(item, { kpMedia: true, youtube_video_id: 'cMoRYP8EDUk' });
  items.get('second').party_id = 'other-party';
  await jobs.removeReference(items.get('first'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].playlistId, 'party');
  assert.equal(items.get('second').party_id, 'other-party');
});

test('removing during an in-flight add waits for registration and uses the retained identity', async (context) => {
  const actions = [];
  let finishAdd;
  const { jobs, items } = jobFixture(context, async (endpoint, options) => {
    actions.push(options.data);
    if (options.data.action === 'remove') return removedReference();
    return new Promise(resolve => { finishAdd = resolve; });
  });
  const candidate = { ...items.get('first') };
  const adding = jobs.submit(candidate);
  const removing = jobs.withPlaylistVideo(candidate, async () => {
    await jobs.removeReference(items.get('first'));
    items.delete('first');
  });
  await new Promise(setImmediate);
  assert.deepEqual(actions.map(item => item.action), ['add']);
  finishAdd(readyJob('first-job'));
  await Promise.all([adding, removing]);
  assert.deepEqual(actions, [
    { action: 'add', videoURL: 'https://www.youtube.com/watch?v=cMoRYP8EDUk', playlistId: 'party' },
    { action: 'remove', videoURL: 'https://www.youtube.com/watch?v=cMoRYP8EDUk', playlistId: 'party' },
  ]);
  assert.equal(items.has('first'), false);
});

test('busy, inaccessible, and invalid removal responses fail without changing the tracked row', async (context) => {
  for (const response of [new SsmusicError(409, 'Conflict'), new SsmusicError(403, 'ssMusic access denied'),
    removedReference({ playlistId: 'wrong-party' }), removedReference({ action: 'add' }),
    removedReference({ playlistCount: -1 })]) {
    const { jobs, items } = jobFixture(context, async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    Object.assign(items.get('first'), { kpMedia: true, youtube_video_id: 'cMoRYP8EDUk', ssmusic_status: 'running' });
    const previous = { ...items.get('first') };
    await assert.rejects(jobs.removeReference(previous), SsmusicError);
    assert.deepEqual(items.get('first'), previous);
  }
});
