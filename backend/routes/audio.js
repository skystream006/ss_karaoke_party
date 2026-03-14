const express = require('express');
const router = express.Router();
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const { resolveAuthLevel } = require('../middleware/auth');

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_KEY = 6;
// Original sample rate assumed for the pitch-shift math.
// asetrate changes pitch+tempo; aresample back to SAMPLE_RATE restores tempo.
const SAMPLE_RATE = 44100;

/**
 * GET /api/audio/:videoId?key=N&start=S&t=token
 *
 * Streams a pitch-shifted version of the YouTube video's audio.
 *
 * Query parameters:
 *   key   {integer}  Semitone shift (-6 to +6, non-zero)
 *   start {number}   Start offset in seconds (default 0, used when seeking)
 *   t     {string}   Auth token (same value as the Authorization Bearer token).
 *                    Required because <audio src="..."> cannot set custom headers.
 *
 * Authentication: accepts either the standard Authorization header or the ?t= query
 * parameter so that the URL can be used directly as an <audio> element source.
 */
router.get('/:videoId', (req, res) => {
  // Auth: accept Bearer header or ?t= query param
  const authHeader = req.headers['authorization'];
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const queryToken =
    typeof req.query.t === 'string' && req.query.t.length > 0 ? req.query.t : null;

  if (!resolveAuthLevel(bearerToken || queryToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { videoId } = req.params;
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const key = parseInt(req.query.key, 10);
  if (
    !Number.isInteger(key) ||
    key < -MAX_KEY ||
    key > MAX_KEY ||
    key === 0
  ) {
    return res
      .status(400)
      .json({ error: `key must be a non-zero integer between -${MAX_KEY} and +${MAX_KEY}` });
  }

  const startSec = Math.max(0, parseFloat(req.query.start) || 0);

  // Pitch-shift math: each semitone = multiply frequency by 2^(1/12).
  // asetrate re-labels the sample rate so FFmpeg plays back at a different pitch
  // (also changes tempo). aresample back to the original rate corrects the tempo.
  const pitchFactor = Math.pow(2, key / 12);
  const shiftedRate = Math.round(SAMPLE_RATE * pitchFactor);

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let audioStream;
  try {
    audioStream = ytdl(videoUrl, {
      quality: 'highestaudio',
      filter: 'audioonly',
      ...(startSec > 0 ? { begin: `${startSec}s` } : {}),
    });
  } catch (err) {
    console.error('[audio] ytdl init error:', err.message);
    return res.status(500).json({ error: 'Failed to initialise audio stream' });
  }

  audioStream.on('error', (err) => {
    console.error('[audio] ytdl stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Audio stream error' });
    }
  });

  res.setHeader('Content-Type', 'audio/ogg');
  res.setHeader('Cache-Control', 'no-cache');

  // Build the ffmpeg command and store it so we can kill it on disconnect.
  // Note: .pipe() returns the destination stream, not the FfmpegCommand, so we
  // must store the command before calling pipe().
  const command = ffmpeg(audioStream)
    .audioFilters([`asetrate=${shiftedRate}`, `aresample=${SAMPLE_RATE}`])
    .format('ogg')
    .on('error', (err) => {
      // Ignore "Output stream closed" which fires when the client disconnects
      if (!err.message.includes('Output stream closed')) {
        console.error('[audio] FFmpeg error:', err.message);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Audio processing failed' });
      } else {
        res.end();
      }
    });

  command.pipe(res, { end: true });

  // When the client disconnects, kill the ffmpeg process to free resources
  req.on('close', () => {
    try {
      command.kill('SIGKILL');
    } catch {
      // ignore – command may have already finished
    }
  });
});

module.exports = router;
