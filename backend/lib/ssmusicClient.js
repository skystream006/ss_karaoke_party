const axios = require('axios');
const { validMediaPath } = require('./ssmusicMedia');

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
} = {}) {
  let baseUrl;
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
    try {
      const response = await axios.request({
        url: `${baseUrl}${endpoint}`,
        method,
        params,
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
        if (response.status === 416) error.contentRange = response.headers['content-range'];
        throw error;
      }
      return response;
    } catch (err) {
      if (err instanceof SsmusicError) throw err;
      throw new SsmusicError(err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ? 504 : 502,
        err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
          ? 'ssMusic server timed out' : 'ssMusic server request failed');
    }
  }

  function mediaEndpoint(kind, mediaPath) {
    if (!['stream', 'lyrics'].includes(kind)) throw new SsmusicError(400, 'Invalid media operation');
    if (!validMediaPath(mediaPath)) throw new SsmusicError(400, 'Invalid media path');
    const separator = mediaPath.indexOf('/');
    const jobId = mediaPath.slice(0, separator);
    const name = mediaPath.slice(separator + 1);
    return `api/jobs/${encodeURIComponent(jobId)}/${kind}/${encodeURIComponent(name)}`;
  }

  return { request, mediaEndpoint };
}

module.exports = { createSsmusicClient, SsmusicError };
