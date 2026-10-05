const axios = require('axios');
const { readFileSync } = require('node:fs');
const https = require('node:https');
const { parseMediaPath } = require('./ssmusicMedia');

class SsmusicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function upstreamError(status) {
  const messages = {
    403: 'ssMusic access denied',
    404: 'ssMusic media not found',
    416: 'Requested media range is not available',
    429: 'ssMusic is busy; please try again later',
  };
  return new SsmusicError(messages[status] ? status : 502,
    messages[status] || 'ssMusic server request failed');
}

function createSsmusicClient({
  serverUrl = process.env.SSMUSIC_SERVER_URL,
  apiKey = process.env.SSMUSIC_API_KEY,
  caFile = process.env.SSMUSIC_CA_CERT_FILE,
} = {}) {
  let baseUrl;
  let httpsAgent;
  try {
    const parsed = new URL(serverUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
        || parsed.search || parsed.hash) throw new Error('Invalid server URL');
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/`;
    baseUrl = parsed.href;
  } catch {
    baseUrl = null;
  }

  async function request(endpoint, { signal, method = 'GET', params, headers = {}, stream = false } = {}) {
    if (!baseUrl || !apiKey) throw new SsmusicError(503, 'ssMusic server is not configured');
    if (caFile && !httpsAgent) {
      try {
        httpsAgent = new https.Agent({ ca: readFileSync(caFile), rejectUnauthorized: true });
      } catch {
        throw new SsmusicError(503, 'ssMusic CA certificate could not be loaded');
      }
    }
    try {
      const response = await axios.request({
        url: `${baseUrl}${endpoint}`,
        method,
        params,
        httpsAgent,
        headers: { ...headers, 'X-API-Key': apiKey, 'Accept-Encoding': 'identity' },
        maxRedirects: 0,
        proxy: false,
        timeout: 15000,
        maxContentLength: 4 * 1024 * 1024,
        responseType: stream ? 'stream' : 'json',
        decompress: false,
        validateStatus: () => true,
        signal,
      });
      if (response.status < 200 || response.status >= 300) {
        if (stream) response.data.destroy();
        const error = upstreamError(response.status);
        error.upstreamStatus = response.status;
        if (response.status === 416) error.contentRange = response.headers['content-range'];
        throw error;
      }
      return response;
    } catch (err) {
      if (err instanceof SsmusicError) throw err;
      if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(err.code)) {
        throw new SsmusicError(502, 'ssMusic HTTPS certificate is not trusted. Configure SSMUSIC_CA_CERT_FILE with its trusted CA or self-signed certificate.');
      }
      if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        throw new SsmusicError(502, 'ssMusic HTTPS certificate does not match SSMUSIC_SERVER_URL. Use a hostname or IP listed in the certificate.');
      }
      throw new SsmusicError(err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ? 504 : 502,
        err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
          ? 'ssMusic server timed out' : 'ssMusic server request failed');
    }
  }

  function mediaEndpoint(kind, mediaPath) {
    if (!['stream', 'lyrics', 'artwork'].includes(kind)) throw new SsmusicError(400, 'Invalid media operation');
    const media = parseMediaPath(mediaPath);
    if (!media) throw new SsmusicError(400, 'Invalid media path');
    return `api/jobs/${media.jobId}/${kind}/${media.encodedName}`;
  }

  return { request, mediaEndpoint };
}

module.exports = { createSsmusicClient, SsmusicError };
