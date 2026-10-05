const crypto = require('crypto');
const path = require('path');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mp2', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.wma']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const TICKET_TTL_MS = 4 * 60 * 60 * 1000;

function mediaType(mediaPath) {
  const extension = path.posix.extname(mediaPath).toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

function validMediaPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4096
    && !/[\\:\u0000-\u001f\u007f]/.test(value)
    && !/%[0-9a-f]{2}/i.test(value)
    && Buffer.from(value, 'utf8').toString('utf8') === value
    && /^[A-Za-z0-9_-]+\//.test(value)
    && value.split('/').every((part) => part && part !== '.' && part !== '..')
    && mediaType(value) !== null;
}

function mediaId(mediaPath) {
  return `ssm_${crypto.createHash('sha256').update(mediaPath).digest('base64url')}`;
}

function normalizeLyrics(metadata) {
  const lines = Array.isArray(metadata?.sylt) ? metadata.sylt
    .slice(0, 10000)
    .filter((cue) => Number.isFinite(cue?.time) && cue.time >= 0
      && cue.time <= 4294967.295 && typeof cue.text === 'string')
    .map((cue) => ({ time: Math.round(cue.time * 1000), text: cue.text.slice(0, 100000) }))
    .sort((a, b) => a.time - b.time) : [];
  return { lines, text: typeof metadata?.uslt === 'string' ? metadata.uslt.slice(0, 100000) : '' };
}

function queueMedia(body) {
  const source = body.source === undefined ? 'youtube' : body.source;
  if (source === 'youtube') {
    if (body.media_path != null || body.media_type != null) {
      throw new Error('YouTube songs cannot include ssMusic media fields');
    }
    return { source, media_path: null, media_type: null };
  }
  if (source !== 'ssmusic' || !validMediaPath(body.media_path)) {
    throw new Error('Invalid media source or path');
  }
  if (body.media_type !== mediaType(body.media_path)) {
    throw new Error('Invalid media type');
  }
  if (body.video_id !== mediaId(body.media_path)) {
    throw new Error('Invalid ssMusic song ID');
  }
  return { source, media_path: body.media_path, media_type: body.media_type };
}

function createMediaTickets({ now = Date.now, secret = crypto.randomBytes(32) } = {}) {
  const signature = (value) => crypto.createHmac('sha256', secret)
    .update(`ssmusic-media:v1:${value}`).digest('base64url');

  return {
    issue(mediaPath) {
      if (!validMediaPath(mediaPath)) throw new Error('Invalid media path');
      const payload = Buffer.from(JSON.stringify({
        path: mediaPath,
        expires: now() + TICKET_TTL_MS,
      })).toString('base64url');
      return `${payload}.${signature(payload)}`;
    },
    verify(ticket) {
      if (typeof ticket !== 'string' || ticket.length > 24000) return null;
      const parts = ticket.split('.');
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) return null;
      const expected = Buffer.from(signature(parts[0]));
      const received = Buffer.from(parts[1]);
      if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
      try {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        if (!validMediaPath(payload.path) || !Number.isSafeInteger(payload.expires)
            || payload.expires <= now() || payload.expires > now() + TICKET_TTL_MS) return null;
        return payload.path;
      } catch {
        return null;
      }
    },
  };
}

module.exports = { validMediaPath, mediaType, mediaId, normalizeLyrics, queueMedia, createMediaTickets };
