const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validMediaPath, mediaType, mediaId, normalizeLyrics, queueMedia, createMediaTickets,
} = require('../lib/ssmusicMedia');

test('ssMusic IDs are stable, path-specific and fit the existing video_id column', () => {
  const id = mediaId('歌手/Song #1.mp3');
  assert.equal(id, mediaId('歌手/Song #1.mp3'));
  assert.notEqual(id, mediaId('another/Song #1.mp3'));
  assert.ok(id.length <= 50);
});

test('media paths accept nested songs and reject URLs, traversal and non-media files', () => {
  for (const value of ['job/Song.mp3', 'job/歌手/Song #1.mp3', 'job/100% Song.mp3', 'Videos/Clip.MP4']) {
    assert.equal(validMediaPath(value), true, value);
  }
  for (const value of [
    '', null, ['song.mp3'], 'song.mp3', '/song.mp3', '//host/song.mp3', 'https://host/song.mp3',
    'C:\\music\\song.mp3', '../song.mp3', 'artist/../song.mp3', 'artist/./song.mp3',
    'artist//song.mp3', '%2e%2e/song.mp3', '%252e%252e/song.mp3', 'artist%2fsong.mp3',
    'song.mp3\u0000', 'job/\ud800.mp3', 'secret.env', 'song.html', 'folder/',
  ]) {
    assert.equal(validMediaPath(value), false, String(value));
  }
  assert.equal(mediaType('song.flac'), 'audio');
  assert.equal(mediaType('song.webm'), 'video');
});

test('upstream SYLT timestamps are converted from seconds to sorted milliseconds', () => {
  assert.deepEqual(normalizeLyrics({
    sylt: [
      { time: 2.5, text: 'Second' }, { time: 1, text: 'First' },
      { time: -1, text: 'Invalid' }, { time: '3', text: 'Invalid' }, null,
    ],
    uslt: 'Plain lyrics',
  }), {
    lines: [{ time: 1000, text: 'First' }, { time: 2500, text: 'Second' }], text: 'Plain lyrics',
  });
  assert.deepEqual(normalizeLyrics(null), { lines: [], text: '' });
});

test('queue defaults to YouTube and strictly validates ssMusic identity and metadata', () => {
  assert.deepEqual(queueMedia({ video_id: 'abcdefghijk' }), {
    source: 'youtube', media_path: null, media_type: null,
  });
  const song = {
    source: 'ssmusic', media_path: 'artist/song.mp3', media_type: 'audio',
    video_id: mediaId('artist/song.mp3'),
  };
  assert.deepEqual(queueMedia(song), {
    source: song.source, media_path: song.media_path, media_type: song.media_type,
  });
  for (const body of [
    { ...song, source: 'other' }, { ...song, media_type: 'video' },
    { ...song, media_path: '../song.mp3' }, { ...song, video_id: 'forged-id' },
    { ...song, source: 'youtube' }, { source: null }, { media_path: 'song.mp3' },
  ]) {
    assert.throws(() => queueMedia(body));
  }
});

test('tickets are scoped, signed, expire and contain no API or session credentials', () => {
  let now = 1000;
  const tickets = createMediaTickets({ now: () => now });
  const token = tickets.issue('artist/song.mp3');
  assert.equal(tickets.verify(token), 'artist/song.mp3');
  const [payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.deepEqual(Object.keys(decoded).sort(), ['expires', 'path']);
  decoded.path = 'artist/another.mp3';
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  assert.equal(tickets.verify(forged), null);
  assert.equal(tickets.verify(`${token}.extra`), null);
  assert.equal(tickets.verify(null), null);
  assert.equal(tickets.verify([token]), null);
  assert.equal(createMediaTickets().verify(token), null);
  now += 4 * 60 * 60 * 1000;
  assert.equal(tickets.verify(token), null);
});
