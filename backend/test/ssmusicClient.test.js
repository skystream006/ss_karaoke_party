const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSsmusicClient } = require('../lib/ssmusicClient');

let server;
let serverUrl;
const requests = [];

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, key: req.headers['x-api-key'] });
    if (req.url === '/prefix/redirect') {
      res.writeHead(302, { Location: '/leaked-key' });
      res.end();
    } else if (req.url === '/prefix/forbidden') {
      res.writeHead(403);
      res.end('upstream secret configuration');
    } else if (req.url === '/prefix/slow') {
      req.on('close', () => res.destroy());
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}/prefix/`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('upstream requests stay beneath the configured URL path and authenticate with X-API-Key', async () => {
  const client = createSsmusicClient({ serverUrl, apiKey: 'fixture-api-key' });
  const response = await client.request('search', { params: { q: 'two words & Unicode 歌' } });
  assert.deepEqual(response.data, { ok: true });
  assert.equal(requests.at(-1).key, 'fixture-api-key');
  assert.match(requests.at(-1).url, /^\/prefix\/search\?q=/);
  assert.equal(client.mediaEndpoint('stream', 'job/歌手/Song #1.mp3'),
    'api/jobs/job/stream/%E6%AD%8C%E6%89%8B%2FSong%20%231.mp3');
});

test('redirects are not followed and failures never include API keys or upstream bodies', async () => {
  const client = createSsmusicClient({ serverUrl, apiKey: 'fixture-api-key' });
  const count = requests.length;
  await assert.rejects(client.request('redirect'), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.message, 'ssMusic server request failed');
    assert.equal(err.config, undefined);
    return true;
  });
  assert.equal(requests.length, count + 1);
  await assert.rejects(client.request('forbidden'), { status: 403, message: 'ssMusic access denied' });
});

test('invalid or missing server configuration is unavailable without making requests', async () => {
  const count = requests.length;
  const credentialUrl = new URL('https://example.com');
  credentialUrl.username = 'fixture';
  credentialUrl.password = 'fixture';
  for (const url of ['', 'file:///songs', credentialUrl.href, 'https://example.com?key=fixture', 'https://example.com/#fragment']) {
    const client = createSsmusicClient({ serverUrl: url, apiKey: 'fixture-api-key' });
    await assert.rejects(client.request('search'), { status: 503 });
  }
  const missingKey = createSsmusicClient({ serverUrl, apiKey: '' });
  await assert.rejects(missingKey.request('search'), { status: 503 });
  assert.equal(requests.length, count);
});

test('upstream requests can be canceled without disclosing request configuration', async () => {
  const client = createSsmusicClient({ serverUrl, apiKey: 'fixture-api-key' });
  const controller = new AbortController();
  const pending = client.request('slow', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { status: 502, message: 'ssMusic server request failed' });
});
