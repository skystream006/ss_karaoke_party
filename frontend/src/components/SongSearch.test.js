import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { searchYouTube, searchSSMusic, addToQueue, addNextToQueue } from '../services/api';
import SongSearch from './SongSearch';

jest.mock('../services/api', () => ({
  searchYouTube: jest.fn(), searchSSMusic: jest.fn(), getYouTubeVideoByUrl: jest.fn(),
  addToQueue: jest.fn(), addNextToQueue: jest.fn(),
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
