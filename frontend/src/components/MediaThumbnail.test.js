import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import MediaThumbnail from './MediaThumbnail';
import { getSSMusicArtwork } from '../services/api';

jest.mock('../services/api', () => ({ getSSMusicArtwork: jest.fn() }));

let root;
let container;
let observers;
let session = 0;
let originalObserver;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  sessionStorage.setItem('authToken', `thumbnail-test-${++session}`);
  URL.createObjectURL = jest.fn(() => 'blob:shared-artwork');
  URL.revokeObjectURL = jest.fn();
  getSSMusicArtwork.mockResolvedValue({ data: new Blob(['artwork']) });
  observers = [];
  originalObserver = global.IntersectionObserver;
  global.IntersectionObserver = jest.fn((callback, options) => {
    const observer = { callback, options, observe: jest.fn(), disconnect: jest.fn() };
    observers.push(observer);
    return observer;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.IntersectionObserver = originalObserver;
  sessionStorage.removeItem('authToken');
});

async function show(observer) {
  await act(async () => observer.callback([{ isIntersecting: true }]));
}

test('defers fetching until near the viewport and shares requests and object URLs', async () => {
  act(() => root.render(<>
    <MediaThumbnail source="ssmusic" mediaPath="song.mp3" />
    <MediaThumbnail source="ssmusic" mediaPath="song.mp3" />
  </>));
  expect(getSSMusicArtwork).not.toHaveBeenCalled();
  expect(observers[0].options).toEqual({ rootMargin: '200px' });
  await act(async () => observers.forEach((observer) => observer.callback([{ isIntersecting: true }])));
  expect(getSSMusicArtwork).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll('img')).toHaveLength(2);
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="song.mp3" />));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  act(() => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="song.mp3" />));
  await show(observers[observers.length - 1]);
  expect(getSSMusicArtwork).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
});

test('aborts pending artwork only after the last consumer leaves and ignores late responses', async () => {
  let resolveArtwork;
  getSSMusicArtwork.mockImplementationOnce(() => new Promise((resolve) => { resolveArtwork = resolve; }));
  act(() => root.render(<>
    <MediaThumbnail source="ssmusic" mediaPath="pending.mp3" />
    <MediaThumbnail source="ssmusic" mediaPath="pending.mp3" />
  </>));
  await act(async () => observers.forEach((observer) => observer.callback([{ isIntersecting: true }])));
  const signal = getSSMusicArtwork.mock.calls[0][1];
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="pending.mp3" />));
  expect(signal.aborted).toBe(false);
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolveArtwork({ data: new Blob(['late']) }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('bounds the idle cache and evicts least recently used artwork', async () => {
  for (let index = 0; index < 33; index += 1) {
    act(() => root.render(<MediaThumbnail key={index} source="ssmusic" mediaPath={`song-${index}.mp3`} />));
    await show(observers[observers.length - 1]);
    act(() => root.render(null));
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(33);
  getSSMusicArtwork.mockClear();
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="song-32.mp3" />));
  await show(observers[observers.length - 1]);
  expect(getSSMusicArtwork).not.toHaveBeenCalled();
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="song-0.mp3" />));
  await show(observers[observers.length - 1]);
  expect(getSSMusicArtwork).toHaveBeenCalledTimes(1);
});

test('does not retain oversized idle artwork or share it across sessions', async () => {
  getSSMusicArtwork.mockResolvedValue({ data: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) });
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="large.mp3" />));
  await show(observers[0]);
  act(() => root.render(null));
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="large.mp3" />));
  await show(observers[1]);
  expect(getSSMusicArtwork).toHaveBeenCalledTimes(2);
  sessionStorage.setItem('authToken', 'another-session');
  act(() => root.render(null));
  act(() => root.render(<MediaThumbnail source="ssmusic" mediaPath="large.mp3" />));
  await show(observers[2]);
  expect(getSSMusicArtwork).toHaveBeenCalledTimes(3);
});