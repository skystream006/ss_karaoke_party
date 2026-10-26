import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { searchYouTube, searchSSMusic, getYouTubeVideoByUrl, getSSMusicArtwork, addToQueue, addNextToQueue } from '../services/api';
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
let artworkSession = 0;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  jest.useFakeTimers();
  sessionStorage.setItem('authToken', `artwork-test-${++artworkSession}`);
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
  sessionStorage.removeItem('authToken');
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
  expect(searchSSMusic).toHaveBeenCalledWith('song', 0, true);
  expect(container.textContent).toContain('Library song');
  expect(container.textContent).not.toContain('YouTube song');
  expect([...container.querySelectorAll('label')].find(label => label.textContent.includes('Karaoke versions')).querySelector('input').disabled).toBe(true);
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
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 20, true);
  expect(container.querySelectorAll('.search-result-item')).toHaveLength(2);
  expect(container.textContent).not.toContain('Load more');
});

test('shows the default-checked no-vocals filter only for ssMusic and restarts pagination when toggled', async () => {
  const filter = () => [...container.querySelectorAll('label')]
    .find(label => label.textContent.includes('No vocals only'))?.querySelector('input');
  expect(filter()).toBeUndefined();
  await toggleSSMusic();
  expect(filter().checked).toBe(true);
  expect(filter().closest('.ssmusic-search-filters').textContent).toContain('ssMusic Search');
  await search();
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 0, true);
  searchSSMusic.mockResolvedValueOnce({ data: { items: [song], total: 21, offset: 0, limit: 20 } });
  await act(async () => Simulate.change(filter(), { target: { checked: false } }));
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 0, false);
  searchSSMusic.mockResolvedValueOnce({
    data: { items: [{ ...song, video_id: 'second' }], total: 21, offset: 20, limit: 20 },
  });
  await act(async () => Simulate.click([...container.querySelectorAll('button')].find(button => button.textContent === 'Load more')));
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 20, false);
  await act(async () => Simulate.change(filter(), { target: { checked: true } }));
  expect(searchSSMusic).toHaveBeenLastCalledWith('song', 0, true);
  expect(container.querySelectorAll('.search-result-item')).toHaveLength(1);
  await toggleSSMusic(false);
  expect(filter()).toBeUndefined();
  expect(searchYouTube).toHaveBeenLastCalledWith('song', false);
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

async function findYouTubeVideo(tab) {
  if (tab === 'url') {
    getYouTubeVideoByUrl.mockResolvedValue({ data: { video_id: 'youtube-song', title: 'YouTube song' } });
    act(() => Simulate.click([...container.querySelectorAll('.search-tab')].find(button => button.textContent.includes('YouTube URL'))));
  }
  await search(tab === 'url' ? 'https://youtu.be/abcdefghijk' : 'song');
}

test.each([
  ['search', 'Add to queue'], ['search', 'Play next'], ['url', 'Add to queue'], ['url', 'Play next'],
])('shows add-time processing feedback for %s / %s', async (tab, action) => {
  const onAdded = jest.fn();
  act(() => root.render(<SongSearch partyId="party" member={{ id: 'member', name: 'Singer' }} onAdded={onAdded} />));
  const request = action === 'Add to queue' ? addToQueue : addNextToQueue;
  request.mockResolvedValue({ data: { id: 'entry', source: 'youtube', ssmusic_status: 'queued' } });
  await findYouTubeVideo(tab);
  await act(async () => Simulate.click(container.querySelector(`button[title="${action}"]`)));
  expect(container.querySelector('[role="status"]').textContent).toBe('Video is processing, come back when done');
  expect(onAdded).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(5000));
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test.each([
  ['search', 'Add to queue'], ['search', 'Play next'], ['url', 'Add to queue'], ['url', 'Play next'],
])('keeps a successful addition distinct from a processing failure for %s / %s', async (tab, action) => {
  const onAdded = jest.fn();
  act(() => root.render(<SongSearch partyId="party" onAdded={onAdded} />));
  const request = action === 'Add to queue' ? addToQueue : addNextToQueue;
  request.mockResolvedValue({ data: { id: 'entry', source: 'youtube', ssmusic_status: 'error', ssmusic_error: 'ssMusic is unavailable' } });
  await findYouTubeVideo(tab);
  await act(async () => Simulate.click(container.querySelector(`button[title="${action}"]`)));
  expect(container.textContent).toContain('Song added, but processing failed: ssMusic is unavailable');
  expect(container.textContent).not.toContain('Failed to add song');
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('playlist processing feedback lasts until conversion completes', async () => {
  const item = { id: 'entry', video_id: 'youtube-song', source: 'youtube', video_title: 'YouTube song',
    position: 1, singer_name: 'Singer', status: 'queued' };
  for (const ssmusic_status of ['submitting', 'queued', 'running']) {
    act(() => root.render(<Playlist queue={[{ ...item, ssmusic_status }]} />));
    expect(container.querySelector('[role="status"]').textContent).toBe('Video is processing, come back when done');
  }
  await act(async () => root.render(<Playlist queue={[{ ...item, ...song, ssmusic_status: 'completed' }]} />));
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('.playlist-media-status').textContent).toBe('ssMusic');
});

test.each(['submitting', 'queued', 'running', 'request'])('disables only the processing item actions during %s and restores them afterward', async (processingState) => {
  const item = { id: 'entry', video_id: 'youtube-song', source: 'youtube', video_title: 'YouTube song',
    position: 1, singer_name: 'Singer', status: 'queued' };
  const onPlay = jest.fn();
  const onRemove = jest.fn();
  const onSendToSSMusic = jest.fn();
  const renderQueue = (updates = {}, ssmusicState = {}) => root.render(<Playlist
    queue={[{ ...item, ...updates }, { ...item, id: 'other', position: 2 }]}
    onPlay={onPlay} onRemove={onRemove} onSendToSSMusic={onSendToSSMusic}
    isOrganizer ssmusicState={ssmusicState} />);

  act(() => renderQueue());
  act(() => container.querySelector('.actions-menu-trigger').click());
  expect(document.querySelector('[role="menu"]')).not.toBeNull();

  act(() => renderQueue(
    { ssmusic_status: processingState === 'request' ? undefined : processingState },
    processingState === 'request' ? { entry: { pending: true } } : {},
  ));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  const [processingItem, otherItem] = container.querySelectorAll('.playlist-item');
  expect([...processingItem.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  expect([...otherItem.querySelectorAll('button')].every(button => !button.disabled)).toBe(true);
  act(() => processingItem.querySelector('.playlist-playback-button').click());
  act(() => processingItem.querySelector('.actions-menu-trigger').click());
  expect(onPlay).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
  expect(onSendToSSMusic).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();

  for (const ssmusic_status of ['completed', 'error']) {
    await act(async () => renderQueue({ ssmusic_status }));
    expect([...processingItem.querySelectorAll('button')].every(button => !button.disabled)).toBe(true);
    act(() => processingItem.querySelector('.actions-menu-trigger').click());
    expect([...document.querySelectorAll('[role="menuitem"]')].every(button => !button.disabled)).toBe(true);
    act(() => Simulate.keyDown(document.querySelector('[role="menu"]'), { key: 'Escape' }));
  }
});
