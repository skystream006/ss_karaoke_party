import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, getMember, getServerInfo, removeFromQueue } from '../services/api';
import GuestPage from './GuestPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), getMember: jest.fn(), getServerInfo: jest.fn(),
  removeFromQueue: jest.fn(),
}));
let mockPlaylistProps;
jest.mock('../components/Playlist', () => (props) => { mockPlaylistProps = props; return null; });
jest.mock('../components/CustomizationPanel', () => () => null);
jest.mock('../components/SongSearch', () => () => null);
jest.mock('../components/ThemePicker', () => () => null);

let root;
let container;
let handlers;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF' } });
  getQueue.mockResolvedValue({ data: [] });
  getMember.mockResolvedValue({ data: { id: 'member-id', name: 'Alex' } });
  getServerInfo.mockResolvedValue({ data: { ip: '192.168.1.10' } });
  handlers = {};
  io.mockReturnValue({ on: jest.fn((event, handler) => { handlers[event] = handler; }), emit: jest.fn(), disconnect: jest.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderGuest(switchUserButton) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/guest/party-id/member-id']}>
        <Routes>
          <Route path="/guest/:partyId/:memberId" element={<GuestPage switchUserButton={switchUserButton} />} />
        </Routes>
      </MemoryRouter>
    );
  });
}

test.each([false, true])('guest QR dialog opens, shows party links, closes and reopens (locked: %s)', async (isLocked) => {
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF', is_locked: isLocked } });
  await renderGuest();
  const dialog = container.querySelector('dialog');
  dialog.showModal = jest.fn(() => dialog.setAttribute('open', ''));
  dialog.close = jest.fn(() => {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  });
  expect(getServerInfo).not.toHaveBeenCalled();
  const openButton = container.querySelector('button[aria-label="Show party QR code"]');
  await act(async () => { Simulate.click(openButton); });
  expect(dialog.showModal).toHaveBeenCalledTimes(1);
  expect(dialog.querySelector('h2').textContent).toBe('Join "Friday"');
  expect(dialog.querySelector('.join-code-display').textContent).toBe('ABCDEF');
  expect(dialog.querySelector('.url-text').textContent).toBe(`${window.location.origin}/join/ABCDEF`);
  expect(dialog.querySelector('.qr-wrapper svg')).not.toBeNull();
  act(() => { Simulate.click([...dialog.querySelectorAll('button')].find(button => button.textContent === 'IP Address')); });
  expect(dialog.querySelector('.url-text').textContent).toContain('192.168.1.10');
  expect(dialog.querySelector('.url-text').textContent).toContain('/join/ABCDEF');
  act(() => { Simulate.click(dialog.querySelector('[aria-label="Close party QR code"]')); });
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(dialog.querySelector('svg')).toBeNull();
  await act(async () => { Simulate.click(openButton); });
  expect(dialog.showModal).toHaveBeenCalledTimes(2);
  expect(dialog.querySelector('.url-text').textContent).toBe(`${window.location.origin}/join/ABCDEF`);
  act(() => { Simulate.keyDown(dialog, { key: 'Escape' }); });
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(dialog.querySelector('svg')).toBeNull();
});

test('places the Change Alias action immediately after Status', async () => {
  const switchUser = jest.fn();
  await renderGuest(<button type="button" onClick={switchUser}>Change Alias</button>);
  const statusButton = container.querySelector('[aria-label="Toggle connection status"]');
  const switchButton = statusButton.nextElementSibling;
  expect(switchButton.textContent).toBe('Change Alias');
  act(() => { Simulate.click(switchButton); });
  expect(switchUser).toHaveBeenCalledTimes(1);
});

test('does not offer QR sharing when the party cannot be loaded', async () => {
  getParty.mockRejectedValue(new Error('not found'));
  await renderGuest();
  expect(container.querySelector('[aria-label="Show party QR code"]')).toBeNull();
  expect(getServerInfo).not.toHaveBeenCalled();
});

test('kpMedia stays queued when removal fails without undoing another conversion, and can be retried', async () => {
  const first = { id: 'first', source: 'ssmusic', kpMedia: true, video_title: 'First', status: 'queued', position: 1 };
  const second = { id: 'second', source: 'youtube', video_title: 'Second', status: 'queued', position: 2 };
  getQueue.mockResolvedValueOnce({ data: [first, second] });
  let rejectRemoval;
  removeFromQueue.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRemoval = reject; }));
  await renderGuest();
  let removing;
  act(() => { removing = mockPlaylistProps.onRemove(first.id); });
  expect(mockPlaylistProps.queue).toEqual([first, second]);
  const convertedSecond = { ...second, source: 'ssmusic', kpMedia: true, media_path: 'job/video.mp4' };
  act(() => handlers['queue:update']({ action: 'media', queue: [first, convertedSecond] }));
  await act(async () => {
    rejectRemoval({ response: { status: 409, data: { error: 'ssMusic video is busy; try again after it finishes' } } });
    await removing;
  });
  expect(mockPlaylistProps.queue).toEqual([first, convertedSecond]);
  expect(container.textContent).toContain('ssMusic video is busy; try again after it finishes');
  removeFromQueue.mockResolvedValueOnce({ data: { success: true } });
  await act(async () => mockPlaylistProps.onRemove(first.id));
  expect(mockPlaylistProps.queue).toEqual([convertedSecond]);
  expect(container.textContent).not.toContain('ssMusic video is busy');
});