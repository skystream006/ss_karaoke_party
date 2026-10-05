import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { getSSMusicPlayback, getSSMusicStreamUrl } from '../services/api';
import SSMusicPlayer, { activeCueIndex, SyltLyrics } from './SSMusicPlayer';

jest.mock('../services/api', () => ({
  getSSMusicPlayback: jest.fn(), getSSMusicStreamUrl: jest.fn((path) => `/api${path}`),
}));

let root;
let container;
let play;
let pause;
const lyrics = {
  lines: [
    { time: 1000, text: 'Hello world' },
    { time: 3000, text: 'Next line' },
  ],
  text: '',
};
const playback = { stream_path: '/ssmusic/media?ticket=test-only', media_type: 'audio', lyrics };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  jest.useFakeTimers();
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  getSSMusicPlayback.mockResolvedValue({ data: playback });
  getSSMusicStreamUrl.mockImplementation((path) => `/api${path}`);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function renderPlayer(props = {}) {
  await act(async () => root.render(<SSMusicPlayer mediaPath="owner/music/song.mp3" title="My song" {...props} />));
  return container.querySelector('audio, video');
}

test('plays audio with a SYLT screen and private proxy URL', async () => {
  const audio = await renderPlayer();
  expect(audio.tagName).toBe('AUDIO');
  expect(audio.getAttribute('src')).toBe('/api/ssmusic/media?ticket=test-only');
  expect(getSSMusicStreamUrl).toHaveBeenCalledWith(playback.stream_path);
  expect(container.textContent).toContain('My song');
  expect(container.textContent).toContain('Hello world');
  expect(play).toHaveBeenCalled();
});

test('uses video playback instead of lyrics for a video result', async () => {
  getSSMusicPlayback.mockResolvedValueOnce({ data: { ...playback, media_type: 'video' } });
  const video = await renderPlayer({ mediaType: 'video' });
  expect(video.tagName).toBe('VIDEO');
  expect(container.querySelector('.sylt-screen')).toBeNull();
});

test('highlights SYLT cues in milliseconds and tracks backward seeks', async () => {
  const audio = await renderPlayer();
  audio.currentTime = 1.2;
  act(() => Simulate.timeUpdate(audio));
  expect(container.querySelector('.sylt-line.active').textContent).toBe('Hello world');
  audio.currentTime = 3.2;
  act(() => Simulate.seeked(audio));
  expect(container.querySelector('.sylt-line.active').textContent).toBe('Next line');
  audio.currentTime = 0;
  act(() => Simulate.seeked(audio));
  expect(container.querySelector('.sylt-line.active')).toBeNull();
});

test('preserves pause/resume, settings, seek, progress and end controls', async () => {
  const ref = createRef();
  const onTimeUpdate = jest.fn();
  const onEnded = jest.fn();
  const props = { ref, onTimeUpdate, onEnded, settings: { vocalLevel: 65, tempo: 1.25 } };
  const audio = await renderPlayer({ ...props, paused: true });
  expect(play).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalled();
  Object.defineProperty(audio, 'duration', { configurable: true, value: 180 });
  act(() => Simulate.loadedMetadata(audio));
  expect(audio.volume).toBe(0.65);
  expect(audio.playbackRate).toBe(1.25);
  expect(onTimeUpdate).toHaveBeenLastCalledWith(0, 180);
  act(() => ref.current.seekTo(42));
  expect(audio.currentTime).toBe(42);
  expect(onTimeUpdate).toHaveBeenLastCalledWith(42, 180);
  act(() => ref.current.pauseVideo());
  await act(async () => ref.current.playVideo());
  expect(play).toHaveBeenCalled();
  await renderPlayer({ ...props, paused: false });
  expect(getSSMusicPlayback).toHaveBeenCalledTimes(1);
  expect(audio.currentTime).toBe(42);
  act(() => Simulate.ended(audio));
  expect(onEnded).toHaveBeenCalledTimes(1);
});

test('shows plain lyrics or a useful no-lyrics fallback', async () => {
  getSSMusicPlayback.mockResolvedValueOnce({ data: { ...playback, lyrics: { lines: [], text: 'Plain lyrics' } } });
  await renderPlayer();
  expect(container.textContent).toContain('Plain lyrics');
  act(() => root.render(<SyltLyrics currentTime={0} title="No lyrics" />));
  expect(container.textContent).toContain('No synchronized lyrics available');
});

test('offers an explicit play button if autoplay is blocked', async () => {
  play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await renderPlayer();
  const button = container.querySelector('.ssmusic-play-button');
  expect(button.textContent).toBe('Play song');
  await act(async () => Simulate.click(button));
  expect(container.querySelector('.ssmusic-play-button')).toBeNull();
});

test('shows playback request errors', async () => {
  getSSMusicPlayback.mockRejectedValueOnce({ response: { data: { error: 'ssMusic media not found' } } });
  await renderPlayer();
  expect(container.querySelector('[role="alert"]').textContent).toBe('ssMusic media not found');
  expect(container.querySelector('audio')).toBeNull();
});

test('aborts requests and timers on unmount and ignores late playback responses', async () => {
  let resolvePlayback;
  getSSMusicPlayback.mockImplementationOnce(() => new Promise((resolve) => { resolvePlayback = resolve; }));
  await renderPlayer();
  const signal = getSSMusicPlayback.mock.calls[0][1];
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolvePlayback({ data: playback }));
  expect(container.textContent).toBe('');
  await renderPlayer();
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  act(() => root.render(null));
  expect(jest.getTimerCount()).toBe(0);
});

test('treats lyric markup as plain text', () => {
  act(() => root.render(<SyltLyrics lyrics={{ lines: [{ time: 0, text: '<img src=x onerror=alert(1)>' }] }} currentTime={0} />));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
});

test('locates active cues at boundaries, including equal timestamps', () => {
  expect(activeCueIndex([], 500)).toBe(-1);
  expect(activeCueIndex(lyrics.lines, 999)).toBe(-1);
  expect(activeCueIndex(lyrics.lines, 1000)).toBe(0);
  expect(activeCueIndex(lyrics.lines, 9999)).toBe(1);
  expect(activeCueIndex([{ time: 0 }, { time: 0 }], 0)).toBe(1);
});

test('seeks to a clicked lyric line and displays instrumental cues', async () => {
  getSSMusicPlayback.mockResolvedValueOnce({
    data: { ...playback, lyrics: { lines: [{ time: 2000, text: '' }] } },
  });
  const audio = await renderPlayer();
  const line = container.querySelector('.sylt-line');
  expect(line.textContent).toBe('♪');
  act(() => Simulate.click(line));
  expect(audio.currentTime).toBe(2);
});
