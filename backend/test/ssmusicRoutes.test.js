const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createSession, requireAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { createSsmusicClient } = require('../lib/ssmusicClient');
const { createMediaTickets, mediaId } = require('../lib/ssmusicMedia');
const { createSsmusicRoutes } = require('../routes/ssmusic');

let upstream;
let backend;
let baseUrl;
let token;
let now = Date.now();
let canceledStream = false;
const outbound = [];
const denied = new Set();
const tickets = createMediaTickets({ now: () => now });
const media = Buffer.from('0123456789abcdef');
const resource = (name) => `job-id/${name}`;
const songPath = resource('Artist/Song #1.mp3');
const catalog = Array.from({ length: 45 }, (_, i) => ({
  jobId: 'job-id',
  name: i === 0 ? 'Artist/Song #1.mp3' : `Song ${i}.mp3`,
  title: `Title ${i}`,
  artist: 'Artist',
  playlistTitle: 'Playlist',
  streamUrl: `/api/jobs/job-id/stream/${encodeURIComponent(i === 0 ? 'Artist/Song #1.mp3' : `Song ${i}.mp3`)}`,
}));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  upstream = http.createServer((req, res) => {
    outbound.push({ method: req.method, url: req.url, headers: req.headers });
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/music/api/songs/search') {
      const pageSize = Number(url.searchParams.get('pageSize'));
      const page = Math.min(Number(url.searchParams.get('page')), Math.ceil(catalog.length / pageSize));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        files: catalog.slice((page - 1) * pageSize, page * pageSize),
        page, pageSize, total: catalog.length, totalPages: Math.ceil(catalog.length / pageSize),
      }));
      return;
    }
    const match = url.pathname.match(/^\/music\/api\/jobs\/job-id\/(stream|lyrics)\/([^/]+)$/);
    if (!match) {
      res.writeHead(404);
      res.end('unexpected upstream request');
      return;
    }
    const name = decodeURIComponent(match[2]);
    if (denied.has(name) || name === 'private.mp3' || name === 'missing.mp3') {
      res.writeHead(name === 'missing.mp3' ? 404 : 403);
      res.end('private upstream details');
      return;
    }
    if (name === 'redirect.mp3') {
      res.writeHead(302, { Location: '/must-not-follow' });
      res.end();
      return;
    }
    if (match[1] === 'lyrics') {
      if (name.startsWith('metadata-')) {
        res.writeHead(Number(name.match(/^metadata-(\d+)\.mp3$/)[1]));
        res.end('private upstream metadata error');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        sylt: name === 'untimed.mp3' ? [] : [{ time: 1.25, text: 'First line' }, { time: 2.5, text: 'Second line' }],
        uslt: name === 'untimed.mp3' ? 'Plain lyrics only' : '',
        artwork: 'discarded',
      }));
      return;
    }
    res.setHeader('Content-Type', name === 'html.mp3' ? 'text/html'
      : name.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg');
    if (name === 'compressed.mp3') res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', '"media-version"');
    res.setHeader('Set-Cookie', 'upstream-session=never-forward');
    if (name === 'large.mp3' && req.method !== 'HEAD') {
      const interval = setInterval(() => res.write(Buffer.alloc(65536, 'x')), 10);
      req.on('close', () => {
        clearInterval(interval);
        canceledStream = true;
      });
      return;
    }
    let start = 0;
    let end = media.length - 1;
    if (req.headers.range) {
      const range = req.headers.range.match(/^bytes=(\d+)-(\d*)$/);
      start = Number(range[1]);
      end = range[2] ? Number(range[2]) : end;
      if (start >= media.length || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${media.length}` });
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${media.length}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    res.end(req.method === 'HEAD' ? undefined : media.subarray(start, end + 1));
  });
  const serverUrl = `${await listen(upstream)}/music`;
  const routes = createSsmusicRoutes({
    client: createSsmusicClient({ serverUrl, apiKey: 'fixture-read-only-key' }), tickets,
  });
  const app = express();
  app.use('/api/ssmusic/media', routes.mediaRouter);
  app.use('/api', generalLimiter, requireAuth);
  app.use('/api/ssmusic', routes.apiRouter);
  backend = http.createServer(app);
  baseUrl = `${await listen(backend)}/api`;
  token = createSession('member');
});

after(async () => {
  backend.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([backend, upstream].map((server) => new Promise((resolve) => server.close(resolve))));
});

function api(path) {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer ' + token } });
}

test('search and playback require bearer authentication before contacting ssMusic', async () => {
  const count = outbound.length;
  for (const route of ['/ssmusic/search?q=song', `/ssmusic/playback?path=${encodeURIComponent(songPath)}`]) {
    assert.equal((await fetch(`${baseUrl}${route}`)).status, 401);
  }
  assert.equal(outbound.length, count);
});

test('search normalizes PR21 results without YouTube filtering or trusting returned media URLs', async () => {
  const response = await api('/ssmusic/search?q=Original%20song&offset=0&karaoke=true');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 45);
  assert.equal(data.offset, 0);
  assert.equal(data.limit, 20);
  assert.equal(data.items.length, 20);
  assert.deepEqual(data.items[0], {
    video_id: mediaId(songPath), title: 'Title 0', channel: 'Artist', thumbnail: null,
    source: 'ssmusic', media_path: songPath, media_type: 'audio',
  });
  const request = outbound.at(-1);
  assert.equal(new URL(request.url, 'http://fixture').searchParams.get('q'), 'Original song');
  assert.equal(request.headers['x-api-key'], 'fixture-read-only-key');
  assert.equal(request.headers.authorization, undefined);
});

test('offset pagination handles non-page-aligned offsets and upstream page clamping', async () => {
  const partial = await (await api('/ssmusic/search?q=song&offset=15')).json();
  assert.equal(partial.items.length, 20);
  assert.equal(partial.items[0].title, 'Title 15');
  assert.equal(partial.items.at(-1).title, 'Title 34');
  const last = await (await api('/ssmusic/search?q=song&offset=40')).json();
  assert.equal(last.items.length, 5);
  const beyond = await (await api('/ssmusic/search?q=song&offset=100')).json();
  assert.deepEqual(beyond.items, []);
});

test('search ignores arbitrary upstream URLs and derives media paths from validated identities', async () => {
  const original = catalog[0].streamUrl;
  try {
    for (const malicious of ['https://untrusted.invalid/song.mp3', resource('another.mp3')]) {
      catalog[0].streamUrl = malicious;
      const response = await api('/ssmusic/search?q=song');
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.items.length, 20);
      assert.equal(data.items[0].media_path, songPath);
      assert.equal(outbound.at(-1).url.startsWith('/music/api/songs/search?'), true);
    }
  } finally {
    catalog[0].streamUrl = original;
  }
});

test('search rejects malformed query parameters without forwarding them upstream', async () => {
  const count = outbound.length;
  for (const query of ['q[]=song', 'q=x&offset=-1', 'q=x&offset=1.5', 'q=x&offset[]=1', `q=${'a'.repeat(201)}`]) {
    assert.equal((await api(`/ssmusic/search?${query}`)).status, 400);
  }
  assert.equal(outbound.length, count);
});

test('playback verifies access with HEAD and returns scoped credentials plus millisecond SYLT', async () => {
  const count = outbound.length;
  const response = await api(`/ssmusic/playback?path=${encodeURIComponent(songPath)}`);
  assert.equal(response.status, 200);
  const playback = await response.json();
  assert.match(playback.stream_path, /^\/ssmusic\/media\?ticket=/);
  assert.equal(playback.media_type, 'audio');
  assert.deepEqual(playback.lyrics, {
    lines: [{ time: 1250, text: 'First line' }, { time: 2500, text: 'Second line' }], text: '',
  });
  assert.equal(JSON.stringify(playback).includes(token), false);
  assert.equal(JSON.stringify(playback).includes('fixture-read-only-key'), false);
  assert.equal(JSON.stringify(playback).includes('artwork'), false);
  assert.equal(outbound[count].method, 'HEAD');
  assert.equal(outbound[count].url, '/music/api/jobs/job-id/stream/Artist%2FSong%20%231.mp3');
  assert.equal(outbound[count + 1].url, '/music/api/jobs/job-id/lyrics/Artist%2FSong%20%231.mp3');
});

test('video and audio without timed lyrics remain playable', async () => {
  const video = await (await api(`/ssmusic/playback?path=${encodeURIComponent(resource('clip.mp4'))}`)).json();
  assert.equal(video.media_type, 'video');
  assert.deepEqual(video.lyrics, { lines: [], text: '' });
  const audio = await (await api(`/ssmusic/playback?path=${encodeURIComponent(resource('untimed.mp3'))}`)).json();
  assert.deepEqual(audio.lyrics, { lines: [], text: 'Plain lyrics only' });
});

test('transient lyrics failures do not prevent playback but access failures remain enforced', async () => {
  for (const status of [429, 500, 503]) {
    const response = await api(`/ssmusic/playback?path=${encodeURIComponent(resource(`metadata-${status}.mp3`))}`);
    assert.equal(response.status, 200);
    const playback = await response.json();
    assert.deepEqual(playback.lyrics, { lines: [], text: '' });
    assert.match(playback.stream_path, /^\/ssmusic\/media\?ticket=/);
  }
  for (const status of [401, 403, 404]) {
    const response = await api(`/ssmusic/playback?path=${encodeURIComponent(resource(`metadata-${status}.mp3`))}`);
    assert.equal(response.status, status === 401 ? 502 : status);
    const body = await response.text();
    assert.equal(body.includes('stream_path'), false);
    assert.equal(body.includes('private upstream metadata error'), false);
  }
});

test('native GET and HEAD stream byte ranges without bearer tokens or upstream cookies', async () => {
  const playback = await (await api(`/ssmusic/playback?path=${encodeURIComponent(songPath)}`)).json();
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${baseUrl}${playback.stream_path}`, {
      method, headers: { Range: 'bytes=5-9', 'If-Range': '"media-version"' },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 5-9/16');
    assert.equal(response.headers.get('content-length'), '5');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), method === 'HEAD' ? '' : '56789');
    assert.equal(outbound.at(-1).headers['if-range'], '"media-version"');
  }
});

test('invalid, tampered and expired media tickets never reach upstream', async () => {
  const count = outbound.length;
  const original = tickets.issue(songPath);
  const [payload, signature] = original.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
  decoded.path = resource('private.mp3');
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  for (const ticket of ['', `${original}x`, forged]) {
    const response = await fetch(`${baseUrl}/ssmusic/media?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(response.status, 401);
  }
  now += 4 * 60 * 60 * 1000;
  assert.equal((await fetch(`${baseUrl}/ssmusic/media?ticket=${original}`)).status, 401);
  now -= 4 * 60 * 60 * 1000;
  assert.equal(outbound.length, count);
});

test('media access is rechecked upstream and 403, 404 and 416 responses stay sanitized', async () => {
  for (const [name, status] of [['private.mp3', 403], ['missing.mp3', 404], ['redirect.mp3', 502]]) {
    const response = await api(`/ssmusic/playback?path=${encodeURIComponent(resource(name))}`);
    assert.equal(response.status, status);
    assert.equal((await response.text()).includes('private upstream details'), false);
  }
  const playback = await (await api(`/ssmusic/playback?path=${encodeURIComponent(songPath)}`)).json();
  denied.add('Artist/Song #1.mp3');
  assert.equal((await fetch(`${baseUrl}${playback.stream_path}`)).status, 403);
  denied.clear();
  const range = await fetch(`${baseUrl}${playback.stream_path}`, { headers: { Range: 'bytes=99-' } });
  assert.equal(range.status, 416);
  assert.equal(range.headers.get('content-range'), 'bytes */16');
  const count = outbound.length;
  const invalid = await fetch(`${baseUrl}${playback.stream_path}`, { headers: { Range: 'bytes=0-1,3-4' } });
  assert.equal(invalid.status, 416);
  assert.equal(outbound.length, count);
  assert.equal(outbound.some(({ url }) => url === '/must-not-follow'), false);
});

test('absolute paths, traversal and generic non-media files cannot obtain tickets', async () => {
  const count = outbound.length;
  for (const path of [
    'https://outside.invalid/a.mp3', '/job/song.mp3', 'job/../song.mp3',
    'job/%2e%2e/song.mp3', 'job/secret.env', 'job\\song.mp3',
    resource('../song.mp3'), resource('%2e%2e/song.mp3'), resource('secret.env'),
    '/api/jobs/job-id/stream/folder/song.mp3', '/api/jobs/job-id/lyrics/song.mp3',
  ]) {
    assert.equal((await api(`/ssmusic/playback?path=${encodeURIComponent(path)}`)).status, 400);
  }
  assert.equal(outbound.length, count);
});

test('media tickets cannot authorize other API endpoints or mutation methods', async () => {
  const count = outbound.length;
  const ticket = tickets.issue(songPath);
  assert.equal((await fetch(`${baseUrl}/ssmusic/search?ticket=${ticket}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/ssmusic/media?ticket=${ticket}`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${baseUrl}/ssmusic/media/extra?ticket=${ticket}`)).status, 401);
  assert.equal(outbound.length, count);
});

test('media proxy rejects HTML and unexpectedly encoded upstream bodies', async () => {
  for (const name of ['html.mp3', 'compressed.mp3']) {
    const response = await fetch(`${baseUrl}/ssmusic/media?ticket=${tickets.issue(resource(name))}`);
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { error: 'Invalid ssMusic media response' });
  }
});

test('streaming starts before the file completes and cancels upstream after browser disconnect', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  try {
    const response = await fetch(`${baseUrl}/ssmusic/media?ticket=${tickets.issue(resource('large.mp3'))}`, {
      signal: controller.signal,
    });
    const chunk = await response.body.getReader().read();
    assert.ok(chunk.value.length > 0);
    assert.equal(chunk.done, false);
    controller.abort();
    for (let i = 0; i < 50 && !canceledStream; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(canceledStream, true);
  } finally {
    controller.abort();
  }
});
