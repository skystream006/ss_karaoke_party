const express = require('express');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createSsmusicClient, SsmusicError } = require('../lib/ssmusicClient');
const {
  parseMediaPath, validMediaPath, mediaType, mediaId, normalizeLyrics, createMediaTickets,
} = require('../lib/ssmusicMedia');

const SEARCH_LIMIT = 20;
const CONTENT_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

function sendError(res, error) {
  if (res.destroyed) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const status = error instanceof SsmusicError ? error.status : 502;
  if (status === 416 && /^bytes \*\/\d+$/.test(error.contentRange || '')) {
    res.setHeader('Content-Range', error.contentRange);
  }
  res.status(status).json({
    error: error instanceof SsmusicError ? error.message : 'ssMusic server request failed',
  });
}

function cancellable(handler) {
  return async (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await handler(req, res, controller.signal);
    } catch (error) {
      sendError(res, error);
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  };
}

function normalizeSong(file) {
  if (!file || typeof file.jobId !== 'string' || typeof file.name !== 'string') return null;
  const mediaPath = `${file.jobId}/${file.name}`;
  const media = parseMediaPath(mediaPath);
  if (!media || media.jobId !== file.jobId || media.name !== file.name) return null;
  const title = typeof file.title === 'string' && file.title.trim()
    ? file.title : path.posix.basename(file.name, path.posix.extname(file.name));
  const channel = typeof file.artist === 'string' && file.artist.trim() ? file.artist
    : typeof file.playlistTitle === 'string' ? file.playlistTitle : 'ssMusic';
  return {
    video_id: mediaId(mediaPath),
    title: title.slice(0, 500),
    channel: channel.slice(0, 500),
    thumbnail: typeof file.artworkUrl === 'string' && file.artworkUrl
      ? `/ssmusic/artwork?path=${encodeURIComponent(mediaPath)}` : null,
    source: 'ssmusic',
    media_path: mediaPath,
    media_type: mediaType(mediaPath),
  };
}

function createSsmusicRoutes({ client = createSsmusicClient(), tickets = createMediaTickets() } = {}) {
  const apiRouter = express.Router();
  const mediaRouter = express.Router();

  apiRouter.get('/search', cancellable(async (req, res, signal) => {
    const q = req.query.q === undefined ? '' : req.query.q;
    const rawOffset = req.query.offset === undefined ? '0' : req.query.offset;
    const noVocalsOnly = req.query.NoVocalsOnly === undefined ? 'false' : req.query.NoVocalsOnly;
    if (typeof q !== 'string' || q.length > 200 || typeof rawOffset !== 'string'
        || !/^(0|[1-9]\d*)$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) {
      throw new SsmusicError(400, 'Invalid search query or offset');
    }
    if (noVocalsOnly !== 'true' && noVocalsOnly !== 'false') {
      throw new SsmusicError(400, 'Invalid NoVocalsOnly filter');
    }
    const offset = Number(rawOffset);
    const page = Math.floor(offset / SEARCH_LIMIT) + 1;
    const loadPage = async (requestedPage) => {
      const { data } = await client.request('api/songs/search', {
        params: { q: q.trim(), page: requestedPage, pageSize: SEARCH_LIMIT, NoVocalsOnly: noVocalsOnly === 'true' },
        signal,
      });
      if (!Array.isArray(data?.files) || !Number.isSafeInteger(data.total) || data.total < 0
          || !Number.isSafeInteger(data.page) || data.page < 1 || data.pageSize !== SEARCH_LIMIT) {
        throw new SsmusicError(502, 'Invalid ssMusic search response');
      }
      return data;
    };
    const first = await loadPage(page);
    // ssMusic clamps pages to the last page, while this API uses absolute offsets.
    let files = first.page === page && offset < first.total ? first.files.slice(offset % SEARCH_LIMIT) : [];
    if (files.length && offset % SEARCH_LIMIT && offset + files.length < first.total) {
      const next = await loadPage(page + 1);
      if (next.page === page + 1) files = files.concat(next.files);
    }
    res.json({
      items: files.slice(0, SEARCH_LIMIT).map(normalizeSong).filter(Boolean),
      total: first.total,
      offset,
      limit: SEARCH_LIMIT,
    });
  }));

  apiRouter.get('/artwork', cancellable(async (req, res, signal) => {
    const mediaPath = req.query.path;
    if (!validMediaPath(mediaPath)) throw new SsmusicError(400, 'Invalid media path');
    const response = await client.request(client.mediaEndpoint('artwork', mediaPath), {
      method: req.method, stream: true, signal,
      params: mediaType(mediaPath) === 'audio' ? { fallback: 1 } : undefined,
    });
    const contentType = response.headers['content-type'] || '';
    const contentEncoding = response.headers['content-encoding'];
    if (!/^image\/(jpeg|png|webp|gif|avif|bmp)(?:;|$)/i.test(contentType)
        || (contentEncoding && contentEncoding !== 'identity')) {
      response.data.destroy();
      throw new SsmusicError(502, 'Invalid ssMusic artwork response');
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      response.data.destroy();
      res.end();
      return;
    }
    response.data.setTimeout?.(30000, () => response.data.destroy(new Error('Artwork stream timed out')));
    await pipeline(response.data, res);
  }));

  apiRouter.get('/playback', cancellable(async (req, res, signal) => {
    const mediaPath = req.query.path;
    if (!validMediaPath(mediaPath)) throw new SsmusicError(400, 'Invalid media path');
    const response = await client.request(client.mediaEndpoint('stream', mediaPath), {
      method: 'HEAD', stream: true, signal,
    });
    response.data.destroy();
    let lyrics = normalizeLyrics(null);
    if (/\.mp3$/i.test(mediaPath)) {
      try {
        const metadata = await client.request(client.mediaEndpoint('lyrics', mediaPath), { signal });
        lyrics = normalizeLyrics(metadata.data);
      } catch (error) {
        const status = error.upstreamStatus || error.status;
        if (signal.aborted || !(error instanceof SsmusicError) || (status !== 429 && status < 500)) throw error;
      }
    }
    res.json({
      stream_path: `/ssmusic/media?ticket=${encodeURIComponent(tickets.issue(mediaPath))}`,
      media_type: mediaType(mediaPath),
      lyrics,
    });
  }));

  mediaRouter.get('/', cancellable(async (req, res, signal) => {
    const mediaPath = tickets.verify(req.query.ticket);
    if (!mediaPath) throw new SsmusicError(401, 'Invalid or expired media ticket');
    const headers = {};
    if (req.headers.range !== undefined) {
      if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) {
        throw new SsmusicError(416, 'Invalid media range');
      }
      headers.Range = req.headers.range;
    }
    if (typeof req.headers['if-range'] === 'string' && req.headers['if-range'].length <= 256) {
      headers['If-Range'] = req.headers['if-range'];
    }
    const response = await client.request(client.mediaEndpoint('stream', mediaPath), {
      method: req.method, headers, stream: true, signal,
    });
    const contentType = response.headers['content-type'] || '';
    const contentEncoding = response.headers['content-encoding'];
    if (!/^(audio\/|video\/|application\/octet-stream(?:;|$))/i.test(contentType)
        || (contentEncoding && contentEncoding !== 'identity')) {
      response.data.destroy();
      throw new SsmusicError(502, 'Invalid ssMusic media response');
    }
    for (const header of CONTENT_HEADERS) {
      if (response.headers[header] !== undefined) res.setHeader(header, response.headers[header]);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.status(response.status);
    if (req.method === 'HEAD') {
      response.data.destroy();
      res.end();
      return;
    }
    response.data.setTimeout?.(30000, () => response.data.destroy(new Error('Media stream timed out')));
    await pipeline(response.data, res);
  }));

  return { apiRouter, mediaRouter };
}

module.exports = { createSsmusicRoutes };
