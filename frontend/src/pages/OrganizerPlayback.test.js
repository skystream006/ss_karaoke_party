import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, updateQueueItemStatus, sendQueueItemToSSMusic, removeFromQueue } from '../services/api';
import OrganizerPage from './OrganizerPage';

let mockPlayerProps;
let mockPlaylistProps;
const mockControls = { playVideo: jest.fn(), pauseVideo: jest.fn(), seekTo: jest.fn() };
jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ authLevel: 'admin' }) }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), updateQueueItemStatus: jest.fn(), sendQueueItemToSSMusic: jest.fn(),
  removeFromQueue: jest.fn(),
}));
jest.mock('../components/VideoPlayer', () => {
  const React = require('react');
  return React.forwardRef((props, ref) => {
    mockPlayerProps = props;
    React.useImperativeHandle(ref, () => mockControls);
    return null;
  });
});
jest.mock('../components/Playlist', () => (props) => { mockPlaylistProps = props; return null; });
jest.mock('../components/QRCodeModal', () => () => null);
jest.mock('../components/CustomizationPanel', () => () => null);
jest.mock('../components/SongSearch', () => () => null);
jest.mock('../components/ThemePicker', () => () => null);

let root;
let container;
let handlers;
let socket;
const audio = {
  id: 'audio-entry', video_id: 'audio-id', source: 'ssmusic', media_path: 'owner/list/song.mp3',
  media_type: 'audio', video_title: 'Audio song', status: 'playing', position: 1,
};
const youtube = { id: 'youtube-entry', video_id: 'youtube-id', video_title: 'YouTube song', status: 'queued', position: 2 };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  handlers = {};
  socket = {
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    emit: jest.fn(), disconnect: jest.fn(),
  };
  io.mockReturnValue(socket);
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Party', join_code: 'ABCDEF', is_active: true } });
  getQueue.mockResolvedValue({ data: [audio, youtube] });
  updateQueueItemStatus.mockResolvedValue({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPage() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organizer/party-id']}>
      <Routes><Route path="/organizer/:partyId" element={<OrganizerPage />} /></Routes>
    </MemoryRouter>
  ));
}

test('restores ssMusic source metadata and a paused entry on reload', async () => {
  getQueue.mockResolvedValueOnce({ data: [{ ...audio, status: 'paused' }, youtube] });
  await renderPage();
  expect(mockPlayerProps).toMatchObject({
    videoId: audio.video_id, playbackKey: audio.id, mediaPath: audio.media_path,
    mediaType: 'audio', paused: true, title: audio.video_title,
  });
});

test('guest pause and resume preserve the same media identity', async () => {
  await renderPage();
  act(() => handlers['queue:update']({ action: 'status', queue: [{ ...audio, status: 'paused' }, youtube] }));
  expect(mockPlayerProps.playbackKey).toBe(audio.id);
  expect(mockPlayerProps.paused).toBe(true);
  expect(mockControls.pauseVideo).toHaveBeenCalled();
  act(() => handlers['queue:update']({ action: 'status', queue: [audio, youtube] }));
  expect(mockPlayerProps.paused).toBe(false);
  expect(mockControls.playVideo).toHaveBeenCalled();
});

test('auto-advances from ssMusic to YouTube and navigates back', async () => {
  await renderPage();
  await act(async () => mockPlayerProps.onEnded());
  expect(updateQueueItemStatus).toHaveBeenLastCalledWith('party-id', youtube.id, 'playing');
  expect(mockPlayerProps.videoId).toBe(youtube.video_id);
  expect(mockPlayerProps.mediaPath).toBeNull();
  act(() => handlers['queue:update']({ action: 'status', queue: [{ ...audio, status: 'played' }, { ...youtube, status: 'playing' }] }));
  await act(async () => mockPlayerProps.onPrev());
  expect(mockPlayerProps.mediaPath).toBe(audio.media_path);
  expect(updateQueueItemStatus).toHaveBeenLastCalledWith('party-id', audio.id, 'playing');
});

test('stops the player when the last song ends', async () => {
  getQueue.mockResolvedValueOnce({ data: [audio] });
  await renderPage();
  await act(async () => mockPlayerProps.onEnded());
  expect(updateQueueItemStatus).toHaveBeenCalledWith('party-id', audio.id, 'played');
  expect(mockPlayerProps.videoId).toBeNull();
  expect(mockPlayerProps.mediaPath).toBeNull();
});

test.each(['onEnded', 'onNext'])('%s skips processing, failed and missing-media songs to the next ready position', async (action) => {
  const blocked = ['submitting', 'queued', 'running', 'error'].map((ssmusic_status, index) => ({
    ...youtube, id: `blocked-${index}`, position: index + 2, ssmusic_status,
  }));
  const missingMedia = { ...youtube, id: 'missing-media', position: 6, source: 'ssmusic', media_path: null };
  const failed = { ...youtube, id: 'failed', position: 7, ssmusic_error: 'Conversion failed' };
  const ready = { ...youtube, id: 'ready', position: 8, source: 'ssmusic', ssmusic_status: 'completed',
    media_path: 'ready/clip.mp4', media_type: 'video' };
  const later = { ...youtube, id: 'later', position: 9 };
  const queue = [later, ...blocked, audio, failed, ready, missingMedia];
  getQueue.mockResolvedValueOnce({ data: queue });
  await renderPage();
  await act(async () => mockPlayerProps[action]());
  expect(updateQueueItemStatus).toHaveBeenCalledTimes(1);
  expect(updateQueueItemStatus).toHaveBeenCalledWith('party-id', ready.id, 'playing');
  expect(mockPlayerProps.mediaPath).toBe(ready.media_path);
  expect(mockPlaylistProps.queue).toEqual(queue);
});

test.each(['onEnded', 'onNext'])('%s stops when all remaining songs are unavailable', async (action) => {
  getQueue.mockResolvedValueOnce({ data: [audio, { ...youtube, ssmusic_status: 'running' },
    { ...youtube, id: 'failed', position: 3, ssmusic_status: 'error' }] });
  await renderPage();
  await act(async () => mockPlayerProps[action]());
  expect(updateQueueItemStatus).toHaveBeenCalledTimes(1);
  expect(updateQueueItemStatus).toHaveBeenCalledWith('party-id', audio.id, 'played');
  expect(mockPlayerProps.videoId).toBeNull();
});

test.each(['onEnded', 'onNext'])('%s skips an in-flight submission and its local failure', async (action) => {
  const later = { ...youtube, id: 'later', position: 3 };
  getQueue.mockResolvedValueOnce({ data: [audio, youtube, later] });
  let rejectRequest;
  sendQueueItemToSSMusic.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRequest = reject; }));
  await renderPage();
  let request;
  act(() => { request = mockPlaylistProps.onSendToSSMusic(youtube); });
  await act(async () => mockPlayerProps[action]());
  expect(updateQueueItemStatus).toHaveBeenLastCalledWith('party-id', later.id, 'playing');
  await act(async () => {
    rejectRequest(new Error('ssMusic is unavailable'));
    await request;
  });
  await act(async () => mockPlayerProps[action]());
  expect(updateQueueItemStatus).toHaveBeenLastCalledWith('party-id', later.id, 'playing');
  expect(updateQueueItemStatus).toHaveBeenCalledTimes(2);
});

test('routes guest seek, settings and progress through the shared controls', async () => {
  await renderPage();
  act(() => {
    handlers['video:seek']({ seekTime: 22 });
    handlers['audio:settings']({ settings: { tempo: 1.5, vocalLevel: 70, key: 0 } });
    mockPlayerProps.onTimeUpdate(22, 100);
  });
  expect(mockControls.seekTo).toHaveBeenCalledWith(22);
  expect(mockPlayerProps.settings).toMatchObject({ tempo: 1.5, vocalLevel: 70 });
  expect(socket.emit).toHaveBeenCalledWith('video:progress', { partyId: 'party-id', currentTime: 22, duration: 100 });
});

test('media updates switch a playing or paused YouTube item to ssMusic without changing its queue identity', async () => {
  getQueue.mockResolvedValueOnce({ data: [{ ...youtube, source: 'youtube', status: 'paused' }] });
  await renderPage();
  const converted = { ...youtube, status: 'paused', source: 'ssmusic', video_id: 'ssm_video',
    media_path: 'video-job/Party clip.mp4', media_type: 'video' };
  act(() => handlers['queue:update']({ action: 'media', queue: [converted] }));
  expect(mockPlayerProps).toMatchObject({
    videoId: 'ssm_video', playbackKey: youtube.id, mediaPath: converted.media_path, mediaType: 'video', paused: true,
  });
});

test('multiple sends stay independent and late HTTP responses cannot undo completed socket conversions', async () => {
  const first = { ...youtube, source: 'youtube', status: 'playing' };
  const second = { ...youtube, id: 'second', video_id: 'second-video', source: 'youtube', position: 3 };
  getQueue.mockResolvedValueOnce({ data: [first, second] });
  const responses = [];
  sendQueueItemToSSMusic.mockImplementation(() => new Promise((resolve) => responses.push(resolve)));
  await renderPage();
  let firstRequest;
  let secondRequest;
  act(() => {
    firstRequest = mockPlaylistProps.onSendToSSMusic(first);
    secondRequest = mockPlaylistProps.onSendToSSMusic(second);
    mockPlaylistProps.onSendToSSMusic(first);
  });
  expect(sendQueueItemToSSMusic).toHaveBeenCalledTimes(2);
  expect(sendQueueItemToSSMusic).toHaveBeenNthCalledWith(1, 'party-id', first.id, expect.any(AbortSignal));
  expect(mockPlaylistProps.ssmusicState[first.id].pending).toBe(true);
  expect(mockPlaylistProps.ssmusicState[second.id].pending).toBe(true);
  const convertedSecond = { ...second, source: 'ssmusic', video_id: 'ssm_second',
    media_path: 'second-job/clip.mp4', media_type: 'video', ssmusic_status: 'completed', kpMedia: true, youtube_video_id: 'RTcsY6aIoEc' };
  await act(async () => { responses[1]({ data: convertedSecond }); await secondRequest; });
  expect(mockPlaylistProps.queue.find(item => item.id === first.id).source).toBe('youtube');
  expect(mockPlaylistProps.queue.find(item => item.id === second.id).source).toBe('ssmusic');
  expect(mockPlaylistProps.queue.find(item => item.id === second.id).kpMedia).toBe(true);
  expect(mockPlaylistProps.queue.find(item => item.id === second.id).youtube_video_id).toBe('RTcsY6aIoEc');
  expect(mockPlaylistProps.ssmusicState[first.id].pending).toBe(true);
  expect(mockPlaylistProps.ssmusicState[second.id].pending).toBe(false);
  const convertedFirst = { ...first, source: 'ssmusic', video_id: 'ssm_first',
    media_path: 'first-job/clip.mp4', media_type: 'video', ssmusic_status: 'completed', singer_name: 'Updated singer' };
  act(() => handlers['queue:update']({ action: 'media', queue: [convertedFirst, convertedSecond] }));
  await act(async () => { responses[0]({ data: { ...first, ssmusic_status: 'queued' } }); await firstRequest; });
  expect(mockPlaylistProps.queue).toEqual([convertedFirst, convertedSecond]);
  expect(mockPlayerProps.mediaPath).toBe(convertedFirst.media_path);
});

test('conversion errors are isolated per item and failed sends can be retried', async () => {
  const first = { ...youtube, source: 'youtube' };
  const second = { ...youtube, id: 'second', video_id: 'second-video', source: 'youtube', position: 3 };
  getQueue.mockResolvedValueOnce({ data: [first, second] });
  sendQueueItemToSSMusic.mockRejectedValueOnce({ response: { data: { error: 'ssMusic is unavailable' } } });
  await renderPage();
  await act(async () => mockPlaylistProps.onSendToSSMusic(first));
  expect(mockPlaylistProps.ssmusicState[first.id]).toEqual({ pending: false, error: 'ssMusic is unavailable' });
  expect(mockPlaylistProps.queue[0].source).toBe('youtube');
  expect(mockPlaylistProps.ssmusicState[second.id]).toBeUndefined();
  sendQueueItemToSSMusic.mockResolvedValueOnce({ data: { ...first, ssmusic_job_id: 'job', ssmusic_status: 'queued', ssmusic_error: null } });
  await act(async () => mockPlaylistProps.onSendToSSMusic(mockPlaylistProps.queue[0]));
  expect(mockPlaylistProps.ssmusicState[first.id]).toEqual({ pending: false, error: '' });
  expect(mockPlaylistProps.queue[0].ssmusic_status).toBe('queued');
});

test('late conversion responses do not restore deleted items and pending requests abort on unmount', async () => {
  let resolveRequest;
  sendQueueItemToSSMusic.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
  await renderPage();
  let pending;
  act(() => { pending = mockPlaylistProps.onSendToSSMusic(youtube); });
  act(() => handlers['queue:update']({ action: 'remove', queue: [audio] }));
  await act(async () => {
    resolveRequest({ data: { ...youtube, source: 'ssmusic', video_id: 'converted' } });
    await pending;
  });
  expect(mockPlaylistProps.queue).toEqual([audio]);
  act(() => { mockPlaylistProps.onSendToSSMusic(youtube); });
  const signal = sendQueueItemToSSMusic.mock.calls.at(-1)[2];
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolveRequest({ data: { ...youtube, source: 'youtube' } }));
});

test('reconnecting refreshes jobs completed offline and locked parties cannot submit', async () => {
  getParty.mockResolvedValueOnce({ data: { id: 'party-id', name: 'Party', join_code: 'ABCDEF', is_active: true, is_locked: true } });
  await renderPage();
  expect(mockPlaylistProps.onSendToSSMusic).toBeUndefined();
  const converted = { ...youtube, source: 'ssmusic', media_path: 'job/clip.mp4', media_type: 'video' };
  getQueue.mockResolvedValueOnce({ data: [audio, converted] });
  await act(async () => { handlers.connect(); handlers.connect(); });
  expect(mockPlaylistProps.queue[1].source).toBe('ssmusic');
});

test('organizer keeps media on a refused removal and stops it only after successful removal', async () => {
  await renderPage();
  removeFromQueue.mockRejectedValueOnce({ response: { data: { error: 'ssMusic could not remove this video yet' } } });
  await act(async () => mockPlaylistProps.onRemove(audio.id));
  expect(mockPlaylistProps.queue).toEqual([audio, youtube]);
  expect(mockPlayerProps.videoId).toBe(audio.video_id);
  expect(container.textContent).toContain('ssMusic could not remove this video yet');
  removeFromQueue.mockResolvedValueOnce({ data: { success: true } });
  await act(async () => mockPlaylistProps.onRemove(audio.id));
  expect(mockPlaylistProps.queue).toEqual([youtube]);
  expect(mockPlayerProps.videoId).toBeNull();
});

test('removing the active item from another client stops its player', async () => {
  await renderPage();
  act(() => handlers['queue:update']({ action: 'remove', queue: [youtube] }));
  expect(mockPlayerProps.videoId).toBeNull();
  expect(mockPlaylistProps.queue).toEqual([youtube]);
});

test('a playback restriction sends only the active queue entry and tracks processing through conversion', async () => {
  const active = { ...youtube, source: 'youtube', status: 'playing' };
  const duplicate = { ...active, id: 'duplicate-entry', status: 'queued', position: 3 };
  getQueue.mockResolvedValueOnce({ data: [active, duplicate] });
  let resolveRequest;
  sendQueueItemToSSMusic.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
  await renderPage();
  let pending;
  act(() => {
    pending = mockPlayerProps.onRestricted({ videoId: active.video_id, playbackKey: active.id });
    mockPlayerProps.onRestricted({ videoId: active.video_id, playbackKey: active.id });
  });
  expect(sendQueueItemToSSMusic).toHaveBeenCalledTimes(1);
  expect(sendQueueItemToSSMusic).toHaveBeenCalledWith('party-id', active.id, expect.any(AbortSignal));
  expect(mockPlayerProps.processing).toBe(true);
  expect(mockPlaylistProps.queue[1]).toEqual(duplicate);

  await act(async () => {
    resolveRequest({ data: { ...active, ssmusic_job_id: 'job', ssmusic_status: 'queued' } });
    await pending;
  });
  await act(async () => mockPlayerProps.onRestricted({ videoId: active.video_id, playbackKey: active.id }));
  expect(sendQueueItemToSSMusic).toHaveBeenCalledTimes(1);
  expect(mockPlayerProps.processing).toBe(true);

  const converted = { ...active, source: 'ssmusic', video_id: 'ssm_clip', media_path: 'job/clip.mp4',
    media_type: 'video', ssmusic_status: 'completed', ssmusic_error: null };
  act(() => handlers['queue:update']({ action: 'media', queue: [converted, duplicate] }));
  expect(mockPlayerProps.processing).toBe(false);
  expect(mockPlayerProps.mediaPath).toBe(converted.media_path);
  expect(mockPlayerProps.playbackKey).toBe(active.id);
});

test('ignores restriction callbacks for another queue entry or an outdated video', async () => {
  const active = { ...youtube, source: 'youtube', status: 'playing' };
  const duplicate = { ...active, id: 'duplicate-entry', status: 'queued', position: 3 };
  getQueue.mockResolvedValueOnce({ data: [active, duplicate] });
  await renderPage();
  await act(async () => {
    await mockPlayerProps.onRestricted({ videoId: active.video_id, playbackKey: duplicate.id });
    await mockPlayerProps.onRestricted({ videoId: 'old-video', playbackKey: active.id });
  });
  expect(sendQueueItemToSSMusic).not.toHaveBeenCalled();
});

test('a failed automatic submission keeps the queued video and exposes the error', async () => {
  const active = { ...youtube, source: 'youtube', status: 'playing' };
  getQueue.mockResolvedValueOnce({ data: [active] });
  sendQueueItemToSSMusic.mockRejectedValueOnce({ response: { data: { error: 'ssMusic is unavailable' } } });
  await renderPage();
  await act(async () => mockPlayerProps.onRestricted({ videoId: active.video_id, playbackKey: active.id }));
  expect(mockPlayerProps.processing).toBe(false);
  expect(mockPlayerProps.processingError).toBe('ssMusic is unavailable');
  expect(mockPlaylistProps.queue[0]).toMatchObject({ ...active, ssmusic_status: 'error' });
  expect(updateQueueItemStatus).not.toHaveBeenCalled();
});
