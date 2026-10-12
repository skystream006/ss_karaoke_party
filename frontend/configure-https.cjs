const path = require('node:path');
const { isIP } = require('node:net');
const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');
const { createSecureContext } = require('node:tls');
const { execFileSync } = require('node:child_process');

function portNumber(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(value);
}

function parseOrigin(value, name) {
  let origin;
  try { origin = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin`); }
  if (origin.protocol !== 'https:' || (origin.origin !== value && `${origin.origin}:443` !== value)
    || origin.username || origin.password) {
    throw new Error(`${name} must be an exact HTTPS origin without a path`);
  }
  return origin;
}

function certificatePath(value, name) {
  if (!path.posix.isAbsolute(value) || /[\x00-\x1f\x7f"$;{}\\]/.test(value)) {
    throw new Error(`${name} must be an absolute container path without Nginx control characters`);
  }
  return value;
}

function httpsConfiguration(environment = process.env) {
  const httpPort = portNumber(environment.PORT || '3124', 'PORT');
  const httpsPort = portNumber(environment.HTTPS_PORT || '4124', 'HTTPS_PORT');
  if (httpPort === httpsPort) throw new Error('PORT and HTTPS_PORT must be different');
  const primary = parseOrigin(environment.PASSKEY_ORIGIN
    || new URL(`https://${environment.PASSKEY_RP_ID || 'localhost'}:${httpsPort}`).origin, 'PASSKEY_ORIGIN');
  const origins = [primary];
  if (Boolean(environment.PASSKEY_ORIGIN_SECONDARY) !== Boolean(environment.PASSKEY_RP_ID_SECONDARY)) {
    throw new Error('Set both secondary passkey settings');
  }
  if (environment.PASSKEY_ORIGIN_SECONDARY) origins.push(parseOrigin(environment.PASSKEY_ORIGIN_SECONDARY, 'PASSKEY_ORIGIN_SECONDARY'));
  const names = [...new Set([
    ...origins.map((origin) => origin.hostname.replace(/^\[|\]$/g, '')),
    environment.PASSKEY_RP_ID, environment.PASSKEY_RP_ID_SECONDARY, 'localhost', '127.0.0.1', '::1',
  ].filter(Boolean))];
  for (const name of names) {
    if (!isIP(name) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(name)) {
      throw new Error('Invalid certificate hostname');
    }
  }
  const commonName = environment.PASSKEY_RP_ID_SECONDARY || environment.PASSKEY_RP_ID || primary.hostname;
  if (commonName.length > 64) throw new Error('Certificate common name must not exceed 64 characters');
  const custom = Boolean(environment.HTTPS_CERT_PATH || environment.HTTPS_KEY_PATH);
  if (Boolean(environment.HTTPS_CERT_PATH) !== Boolean(environment.HTTPS_KEY_PATH)) {
    throw new Error('HTTPS_CERT_PATH and HTTPS_KEY_PATH must be configured together');
  }
  return {
    httpPort, httpsPort, origin: primary.origin, names, commonName, custom,
    originNames: origins.map((origin) => origin.hostname.replace(/^\[|\]$/g, '')),
    certPath: certificatePath(environment.HTTPS_CERT_PATH || '/var/lib/karaoke/tls/server-cert.pem', 'HTTPS_CERT_PATH'),
    keyPath: certificatePath(environment.HTTPS_KEY_PATH || '/var/lib/karaoke/tls/server-key.pem', 'HTTPS_KEY_PATH'),
  };
}

function validateCertificate(config, { renewBefore = 0 } = {}) {
  const cert = fs.readFileSync(config.certPath);
  const key = fs.readFileSync(config.keyPath);
  const certificate = new X509Certificate(cert);
  createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
  if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now() + renewBefore) {
    throw new Error('HTTPS certificate is expired, not yet valid or due for renewal');
  }
  const names = config.custom ? config.originNames : config.names;
  if (!names.every((name) => isIP(name) ? certificate.checkIP(name) : certificate.checkHost(name))) {
    throw new Error('HTTPS certificate does not cover the configured origin hostnames');
  }
  return certificate;
}

function ensureCertificate(config, { openssl = 'openssl' } = {}) {
  if (config.custom) {
    validateCertificate(config);
    return 'custom';
  }
  try {
    validateCertificate(config, { renewBefore: 30 * 24 * 60 * 60 * 1000 });
    return 'reused';
  } catch (error) {
    if (['EACCES', 'EPERM', 'EISDIR', 'EROFS'].includes(error.code)) throw error;
  }
  const directory = path.dirname(config.keyPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(directory, '.new-'));
  const pending = { ...config, keyPath: path.join(temporary, 'key.pem'), certPath: path.join(temporary, 'cert.pem') };
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
      '-subj', `/CN=${config.commonName}`, '-keyout', pending.keyPath, '-out', pending.certPath,
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth',
      '-addext', `subjectAltName=${config.names.map((name) => `${isIP(name) ? 'IP' : 'DNS'}:${name}`).join(',')}`],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    fs.chmodSync(pending.keyPath, 0o600);
    fs.chmodSync(pending.certPath, 0o644);
    validateCertificate(pending);
    fs.renameSync(pending.keyPath, config.keyPath);
    fs.renameSync(pending.certPath, config.certPath);
    return 'generated';
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function renderNginx(template, config) {
  return template.replaceAll('__HTTPS_ORIGIN__', config.origin)
    .replaceAll('__HTTPS_CERT_PATH__', config.certPath)
    .replaceAll('__HTTPS_KEY_PATH__', config.keyPath);
}

if (require.main === module) {
  try {
    const config = httpsConfiguration();
    const certificate = ensureCertificate(config);
    const template = fs.readFileSync('/opt/karaoke/nginx.conf.template', 'utf8');
    fs.writeFileSync('/etc/nginx/conf.d/default.conf', renderNginx(template, config));
    console.log(`HTTPS ready on published port ${config.httpsPort}; HTTP redirects to ${config.origin}`);
    if (certificate === 'generated') console.log('Generated local TLS certificate. Trust the public certificate on each client, or configure a trusted certificate/key pair.');
  } catch (error) {
    console.error(`HTTPS configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { httpsConfiguration, ensureCertificate, validateCertificate, renderNginx };