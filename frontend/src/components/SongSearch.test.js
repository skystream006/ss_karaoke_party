import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { searchYouTube, searchSSMusic, getSSMusicArtwork, addToQueue, addNextToQueue } from '../services/api';
import SongSearch from './SongSearch';
import Playlist from './Playlist';

jest.mock('../services/api', () => ({
  searchYouTube: jest.fn(), searchSSMusic: jest.fn(), getYouTubeVideoByUrl: jest.fn(),
  addToQueue: jest.fn(), addNextToQueue: jest.fn(),
  getSSMusicArtwork: jest.fn(),
}));

let root;
let container;
const song = {
  video_id: 'ssmusic-song', title: 'Library song', channel: 'Artist',
  source: 'ssmusic', media_path: 'user/playlist/song.mp3', media_type: 'audio',
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  jest.useFakeTimers();
  URL.createObjectURL = jest.fn(() => 'blob:artwork');
  URL.revokeObjectURL = jest.fn();
  getSSMusicArtwork.mockResolvedValue({ data: new Blob(['artwork'], { type: 'image/webp' }) });
  searchYouTube.mockResolvedValue({ data: [{ video_id: 'youtube-song', title: 'YouTube song' }] });
  searchSSMusic.mockResolvedValue({ data: { items: [song], total: 1, offset: 0, limit: 20 } });
  addToQueue.mockResolvedValue({});
  addNextToQueue.mockResolvedValue({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SongSearch partyId="party" member={{ id: 'member', name: 'Singer' }} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

async function search(text = 'song') {
  act(() => Simulate.change(container.querySelector('input[type="text"]'), { target: { value: text } }));
  await act(async () => Simulate.submit(container.querySelector('form')));
}

async function toggleSSMusic(checked = true) {
  const input = [...container.querySelectorAll('label')].find((label) => label.textContent.includes('ssMusic')).querySelector('input');
  await act(async () => Simulate.change(input, { target: { checked } }));
}

test('defaults to YouTube and re-runs the search when ssMusic is selected', async () => {
  await search();
  expect(searchYouTube).toHaveBeenCalledWith('song', false);
  expect(container.textContent).toContain('YouTube song');
  await toggleSSMusic();
  expect(searchSSMusic).toHaveBeenCalledWith('song', 0);
  expect(container.textContent).toContain('Library song');
  expect(container.textContent).not.toContain('YouTube song');
  expect(container.querySelectorAll('input[type="checkbox"]')[1].disabled).toBe(true);
  await toggleSSMusic(false);
  expect(searchYouTube).toHaveBeenCalledTimes(2);
});

test('preserves media identity for both add and play-next', async () => {
  await toggleSSMusic();
  await search();
  await act(async () => Simulate.click(container.querySelector('button[title="Add to queue"]')));
  await act(async () => Simulate.click(container.querySelector('button[title="Play next"]')));
  const expected = {
    member_id: 'member', singer_name: 'Singer', video_id: song.video_id, video_title: song.title,
    source: 'ssmusic', media_path: song.media_path, media_type: 'audio',
  };
  expect(addToQueue).toHaveBeenCalledWith('party', expect.objectContaining(expected));
  expect(addNextToQueue).toHaveBeenCalledWith('party', expect.objectContaining(expected));
});

test('loads the corresponding audio and video thumbnails through the authenticated artwork service', async () => {
  const video = { ...song, video_id: 'ssmusic-video', title: 'Library video', media_path: 'job/clip.mp4', media_type: 'video' };
  searchSSMusic.mockResolvedValue({ data: { items: [song, video], total: 2, offset: 0, limit: 20 } });
  URL.createObjectURL.mockReturnValueOnce('blob:audio').mockReturnValueOnce('blob:video');
  await toggleSSMusic();
  await search();
  expect(getSSMusicArtwork).toHaveBeenCalledWith(song.media_path, expect.any(AbortSignal));
  expect(getSSMusicArtwork).toHaveBeenCalledWith(video.media_path, expect.any(AbortSignal));
  expect([...container.querySelectorAll('img.result-thumb')].map((image) => [image.alt, image.getAttribute('src')]))
    .toEqual([['Library song', 'blob:audio'], ['Library video', 'blob:video']]);
  await toggleSSMusic(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
});

test('queued ssMusic items load artwork even when their saved thumbnail is empty', async () => {
  await act(async () => root.render(<Playlist queue={[{
    ...song, id: 'entry', video_title: song.title, video_thumbnail: null, position: 1,
    singer_name: 'Singer', status: 'pending',
  }]} />));
  expect(container.querySelector('img.playlist-thumb').getAttribute('src')).toBe('blob:artwork');
  expect(getSSMusicArtwork).toHaveBeenCalledWith(song.media_path, expect.any(AbortSignal));
});

test('keeps YouTube thumbnail URLs unchanged without requesting ssMusic artwork', async () => {
  searchYouTube.mockResolvedValue({ data: [{ video_id: 'youtube-song', title: 'YouTube song', thumbnail: 'https://i.ytimg.com/vi/id/default.jpg' }] });
  await search();
  expect(container.querySelector('img.result-thumb').getAttribute('src')).toBe('https://i.ytimg.com/vi/id/default.jpg');
  expect(getSSMusicArtwork).not.toHaveBeenCalled();
});

test('ssMusic items without a media path do not request or render an image', async () => {
  searchSSMusic.mockResolvedValue({ data: { items: [{ ...song, media_path: undefined }], total: 1, offset: 0, limit: 20 } });
  await toggleSSMusic();
  await search();
  expect(container.textContent).toContain(song.title);
  expect(container.querySelector('.result-thumb')).toBeNull();
  expect(getSSMusicArtwork).not.toHaveBeenCalled();
});

test('missing or broken artwork keeps the result usable without a broken image', async () => {
  getSSMusicArtwork.mockRejectedValueOnce(new Error('Artwork unavailable'));
  await toggleSSMusic();
  await search();
  expect(container.querySelector('img.result-thumb')).toBeNull();
  expect(container.querySelector('span.result-thumb')).not.toBeNull();
  expect(container.textContent).toContain(song.title);
  await search();
  act(() => Simulate.error(container.querySelector('img.result-thumb')));
  expect(container.querySelector('img.result-thumb')).toBeNull();
  expect(container.querySelector('button[title="Add to queue"]').disabled).toBe(false);
});

test('cancels pending artwork and ignores late responses after the results change', async () => {
  let resolveArtwork;
  getSSMusicArtwork.mockImplementationOnce(() => new Promise((resolve) => { resolveArtwork = resolve; }));
  await toggleSSMusic();
  await search();
  const signal = getSSMusicArtwork.mock.calls[0][1];
  await toggleSSMusic(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolveArtwork({ data: new Blob(['stale artwork']) }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('loads additional results using the submitted query rather than unsubmitted edits', async () => {
  searchSSMusic.mockResolvedValueOnce({ data: { items: [song], total: 21, offset: 0, limit: 20 } });
  await toggleSSMusic();
  await search();
  act(() => Simulate.change(container.querySelector('input[type="text"]'), { target: { value: 'new draft' } }));
  searchSSMusic.mockResolvedValueOnce({
    data: { items: [{ ...song, video_id: 'second', title: 'Second song' }], total: 21, offset: 20, limit: 20 },
  });
  await act(async () => Simulate.click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Load more')));
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 20);
  expect(container.querySelectorAll('.search-result-item')).toHaveLength(2);
  expect(container.textContent).not.toContain('Load more');
});

test('ignores a stale YouTube response after switching sources', async () => {
  let resolveYouTube;
  searchYouTube.mockImplementationOnce(() => new Promise((resolve) => { resolveYouTube = resolve; }));
  await search();
  await toggleSSMusic();
  await act(async () => resolveYouTube({ data: [{ video_id: 'old', title: 'Stale result' }] }));
  expect(container.textContent).toContain('Library song');
  expect(container.textContent).not.toContain('Stale result');
});

test('clearing the query invalidates an in-flight search', async () => {
  let resolveSearch;
  searchSSMusic.mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve; }));
  await toggleSSMusic();
  await search();
  act(() => Simulate.change(container.querySelector('input[type="text"]'), { target: { value: '' } }));
  await act(async () => resolveSearch({ data: { items: [song], total: 1, limit: 20 } }));
  expect(container.querySelectorAll('.search-result-item')).toHaveLength(0);
});

test('shows server configuration errors without falling back to YouTube', async () => {
  searchSSMusic.mockRejectedValueOnce({ response: { data: { error: 'ssMusic is not configured' } } });
  await toggleSSMusic();
  await search();
  expect(container.textContent).toContain('ssMusic is not configured');
  expect(searchYouTube).not.toHaveBeenCalled();
});
