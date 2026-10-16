import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';
import { getParty, getQueue, getMember, getServerInfo, removeFromQueue } from '../services/api';
import GuestPage from './GuestPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
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
const invitation = { token: 'a'.repeat(43), expiresAt: '2099-01-01', partyId: 'party-id', memberId: 'member-id' };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  HTMLDialogElement.prototype.showModal = jest.fn(function () { this.open = true; });
  HTMLDialogElement.prototype.close = jest.fn(function () { this.open = false; });
  useAuth.mockReturnValue({ authLevel: 'guest' });
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
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/guest/:partyId/:memberId" element={<GuestPage switchUserButton={switchUserButton} />} />
        </Routes>
      </MemoryRouter>
    );
  });
}

test.each([false, true])('guests without a retained invitation cannot create one (locked: %s)', async (isLocked) => {
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF', is_locked: isLocked } });
  await renderGuest();
  expect(getServerInfo).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Show party QR code"]')).toBeNull();
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.textContent).not.toContain('ABCDEF');
});

test.each([false, true])('guests can open, copy, close and reopen their current QR invitation (locked: %s)', async (isLocked) => {
  useAuth.mockReturnValue({ authLevel: 'guest', partyInvitation: invitation });
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', is_locked: isLocked } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  await renderGuest();
  const show = container.querySelector('[aria-label="Show party QR code"]');
  const dialog = container.querySelector('dialog');
  expect(dialog.open).toBe(false);
  act(() => Simulate.click(show));
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('svg')).not.toBeNull();
  expect(dialog.querySelector('.qr-regenerate')).toBeNull();
  await act(async () => Simulate.click(dialog.querySelector('[aria-label="Copy invitation link"]')));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/join/invite#invite=${invitation.token}`);
  act(() => Simulate.click(dialog.querySelector('[aria-label="Close party QR code"]')));
  expect(dialog.open).toBe(false);
  act(() => Simulate.click(show));
  expect(dialog.open).toBe(true);
  act(() => Simulate.cancel(dialog));
  expect(dialog.open).toBe(false);
  act(() => Simulate.click(show));
  act(() => Simulate.keyDown(dialog, { key: 'Escape' }));
  expect(dialog.open).toBe(false);
});

test.each([{ partyId: 'other-party' }, { memberId: 'other-member' }])('does not share another session membership invitation: %s', async (scope) => {
  useAuth.mockReturnValue({ authLevel: 'guest', partyInvitation: { ...invitation, ...scope } });
  await renderGuest();
  expect(container.querySelector('[aria-label="Show party QR code"]')).toBeNull();
});

test('passkey-signed-in guests can go home without signing out', async () => {
  useAuth.mockReturnValue({ authLevel: 'admin' });
  const switchUser = jest.fn();
  await renderGuest(<button type="button" onClick={switchUser}>Sign out</button>);
  const homeButton = container.querySelector('.guest-header-title [aria-label="Home"]');
  expect(homeButton).not.toBeNull();
  expect(homeButton.nextElementSibling.classList.contains('party-badge')).toBe(true);
  expect(homeButton.nextElementSibling.textContent).toContain('Friday');
  expect(homeButton.classList.contains('home-button')).toBe(true);
  expect(homeButton.title).toBe('Home');
  act(() => { Simulate.click(homeButton); });
  expect(container.textContent).toBe('Home page');
  expect(switchUser).not.toHaveBeenCalled();
});

test.each(['guest', 'none'])('does not show the header Home button for %s sessions', async (authLevel) => {
  useAuth.mockReturnValue({ authLevel });
  await renderGuest();
  expect(container.querySelector('.guest-header [aria-label="Home"]')).toBeNull();
});

test('places the sign-out action immediately after Status', async () => {
  const switchUser = jest.fn();
  await renderGuest(<button type="button" onClick={switchUser}>Sign out</button>);
  const statusButton = container.querySelector('[aria-label="Toggle connection status"]');
  const switchButton = statusButton.nextElementSibling;
  expect(switchButton.textContent).toBe('Sign out');
  act(() => { Simulate.click(switchButton); });
  expect(switchUser).toHaveBeenCalledTimes(1);
});

test('guest socket authentication reads the latest session token on every connection', async () => {
  await renderGuest();
  expect(io.mock.calls[0][0]).toBe(window.location.origin);
  const authenticate = io.mock.calls[0][1].auth;
  const callback = jest.fn();
  sessionStorage.setItem('authToken', 'party-session');
  authenticate(callback);
  expect(callback).toHaveBeenLastCalledWith({ token: 'party-session' });
  sessionStorage.setItem('authToken', 'replacement-session');
  authenticate(callback);
  expect(callback).toHaveBeenLastCalledWith({ token: 'replacement-session' });
  sessionStorage.removeItem('authToken');
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