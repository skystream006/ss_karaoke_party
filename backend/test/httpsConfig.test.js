const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { passkeyConfig } = require('../lib/passkeys');
const { httpsConfiguration, ensureCertificate, validateCertificate, renderNginx } = require('../../frontend/configure-https.cjs');
const openssl = process.env.HTTPS_TEST_OPENSSL || 'openssl';
const hasOpenSSL = spawnSync(openssl, ['version'], { stdio: 'ignore' }).status === 0;

test('HTTPS_PORT controls the local TLS origin independently of the HTTP port', () => {
  const defaults = httpsConfiguration({});
  assert.equal(defaults.httpPort, 3124);
  assert.equal(defaults.httpsPort, 4124);
  assert.equal(defaults.origin, 'https://localhost:4124');
  assert.equal(httpsConfiguration({ HTTPS_PORT: '8443' }).origin, 'https://localhost:8443');
  assert.equal(httpsConfiguration({ HTTPS_PORT: '443' }).origin, 'https://localhost');
  assert.equal(httpsConfiguration({ HTTPS_PORT: '443', PASSKEY_ORIGIN: 'https://localhost:443' }).origin, 'https://localhost');
  assert.equal(passkeyConfig('https://localhost', { PASSKEY_ORIGIN: 'https://localhost:443' }).origin, 'https://localhost');
  for (const HTTPS_PORT of ['0', '65536', '-1', '443.5', 'abc', '3124']) {
    assert.throws(() => httpsConfiguration({ HTTPS_PORT }));
  }
});

test('an explicit proxy-facing origin is preserved and both hostnames are covered', () => {
  const config = httpsConfiguration({ HTTPS_PORT: '4124', PASSKEY_RP_ID: 'party.example.com',
    PASSKEY_ORIGIN: 'https://party.example.com', PASSKEY_RP_ID_SECONDARY: 'party.lan',
    PASSKEY_ORIGIN_SECONDARY: 'https://party.lan:4124' });
  assert.equal(config.origin, 'https://party.example.com');
  assert.equal(config.commonName, 'party.lan');
  assert.deepEqual(config.names, ['party.example.com', 'party.lan', 'localhost', '127.0.0.1', '::1']);
});

test('TLS configuration rejects unsafe origins, incomplete certificate pairs and directive injection', () => {
  for (const PASSKEY_ORIGIN of ['http://localhost:3124', 'https://party.test/path', 'https://user:secret@party.test',
    'https://party.test;return 200;', 'https://party.test/#fragment']) {
    assert.throws(() => httpsConfiguration({ PASSKEY_ORIGIN }));
  }
  assert.throws(() => httpsConfiguration({ HTTPS_CERT_PATH: '/certs/cert.pem' }));
  assert.throws(() => httpsConfiguration({ PASSKEY_RP_ID_SECONDARY: 'party.lan' }));
  assert.throws(() => httpsConfiguration({ HTTPS_CERT_PATH: '/certs/$secret', HTTPS_KEY_PATH: '/certs/key.pem' }));
  const custom = httpsConfiguration({ HTTPS_CERT_PATH: '/run/karaoke-tls/fullchain.pem', HTTPS_KEY_PATH: '/run/karaoke-tls/privkey.pem' });
  assert.equal(custom.custom, true);
});

test('Nginx redirects to a fixed origin and proxies HTTPS APIs and WebSocket upgrades', () => {
  const config = httpsConfiguration({ HTTPS_PORT: '8443' });
  const template = fs.readFileSync(path.join(__dirname, '../../frontend/nginx.conf'), 'utf8');
  const rendered = renderNginx(template, config);
  assert.match(rendered, /return 308 "https:\/\/localhost:8443\$request_uri";/);
  assert.match(rendered, /listen 443 ssl;/);
  assert.match(rendered, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(rendered, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(rendered, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(rendered, /ssl_certificate "\/var\/lib\/karaoke\/tls\/server-cert.pem";/);
  assert.doesNotMatch(rendered, /__HTTPS_/);
});

test('generated certificates persist, cover configured hosts and rotate when a new hostname is added', { skip: !hasOpenSSL }, (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-tls-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = { keyPath: path.join(directory, 'key.pem'), certPath: path.join(directory, 'cert.pem') };
  const config = { ...httpsConfiguration({ PASSKEY_RP_ID: 'party.test', PASSKEY_ORIGIN: 'https://party.test:4124' }), ...files };
  assert.equal(ensureCertificate(config, { openssl }), 'generated');
  const original = fs.readFileSync(config.certPath, 'utf8');
  const certificate = validateCertificate(config);
  assert.ok(certificate.checkHost('party.test'));
  assert.ok(certificate.checkHost('localhost'));
  assert.ok(certificate.checkIP('127.0.0.1'));
  assert.equal(ensureCertificate(config, { openssl }), 'reused');
  assert.equal(fs.readFileSync(config.certPath, 'utf8'), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(config.keyPath).mode & 0o777, 0o600);
  const changed = { ...httpsConfiguration({ PASSKEY_RP_ID: 'party.test', PASSKEY_ORIGIN: 'https://party.test:4124',
    PASSKEY_RP_ID_SECONDARY: 'party.lan', PASSKEY_ORIGIN_SECONDARY: 'https://party.lan:4124' }), ...files };
  assert.equal(ensureCertificate(changed, { openssl }), 'generated');
  assert.ok(validateCertificate(changed).checkHost('party.lan'));
  assert.notEqual(fs.readFileSync(config.certPath, 'utf8'), original);
});

test('custom certificates are validated without being overwritten', { skip: !hasOpenSSL }, (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-custom-tls-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { ...httpsConfiguration({}), keyPath: path.join(directory, 'key.pem'), certPath: path.join(directory, 'cert.pem') };
  ensureCertificate(config, { openssl });
  const original = fs.readFileSync(config.certPath, 'utf8');
  assert.equal(ensureCertificate({ ...config, custom: true }, { openssl: 'must-not-run' }), 'custom');
  assert.throws(() => ensureCertificate({ ...config, custom: true, originNames: ['other.test'] }, { openssl: 'must-not-run' }), /does not cover/);
  fs.writeFileSync(config.keyPath, 'invalid private key fixture');
  assert.throws(() => ensureCertificate({ ...config, custom: true }, { openssl: 'must-not-run' }));
  assert.equal(fs.readFileSync(config.certPath, 'utf8'), original);
});