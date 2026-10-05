import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, updateQueueItemStatus } from '../services/api';
import OrganizerPage from './OrganizerPage';

let mockPlayerProps;
const mockControls = { playVideo: jest.fn(), pauseVideo: jest.fn(), seekTo: jest.fn() };
jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), updateQueueItemStatus: jest.fn(),
}));
jest.mock('../components/VideoPlayer', () => {
  const React = require('react');
  return React.forwardRef((props, ref) => {
    mockPlayerProps = props;
    React.useImperativeHandle(ref, () => mockControls);
    return null;
  });
});
jest.mock('../components/Playlist', () => () => null);
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
