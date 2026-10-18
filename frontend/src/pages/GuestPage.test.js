import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';
import { getParty, getQueue, getMember, getServerInfo, getCurrentPartyInvitation, createPartyInvitation, removeFromQueue, resetQueue } from '../services/api';
import GuestPage from './GuestPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), getMember: jest.fn(), getServerInfo: jest.fn(),
  removeFromQueue: jest.fn(), resetQueue: jest.fn(),
  getCurrentPartyInvitation: jest.fn(), createPartyInvitation: jest.fn(),
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
  getCurrentPartyInvitation.mockResolvedValue({ data: invitation });
  handlers = {};
  io.mockReturnValue({ on: jest.fn((event, handler) => { handlers[event] = handler; }), emit: jest.fn(), disconnect: jest.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

async function renderGuest(signOutAction, accountInfoAction) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/guest/party-id/member-id']}>
        <Routes>
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/guest/:partyId/:memberId" element={<GuestPage signOutAction={signOutAction} accountInfoAction={accountInfoAction} />} />
        </Routes>
      </MemoryRouter>
    );
  });
}

test.each([false, true])('existing guests can share without a retained invitation (locked: %s)', async (isLocked) => {
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF', is_locked: isLocked } });
  await renderGuest();
  expect(getServerInfo).not.toHaveBeenCalled();
  const show = container.querySelector('[aria-label="Show party QR code"]');
  expect(show).not.toBeNull();
  expect(getCurrentPartyInvitation).not.toHaveBeenCalled();
  await act(async () => Simulate.click(show));
  expect(getCurrentPartyInvitation).toHaveBeenCalledWith('party-id');
  expect(container.querySelector('dialog').open).toBe(true);
  expect(container.querySelector('.qr-wrapper svg')).not.toBeNull();
  expect(createPartyInvitation).not.toHaveBeenCalled();
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
  await act(async () => Simulate.click(show));
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('svg')).not.toBeNull();
  expect(dialog.querySelector('.qr-regenerate')).toBeNull();
  await act(async () => Simulate.click(dialog.querySelector('[aria-label="Copy invitation link"]')));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/join/invite#invite=${invitation.token}`);
  act(() => Simulate.click(dialog.querySelector('[aria-label="Close party QR code"]')));
  expect(dialog.open).toBe(false);
  await act(async () => Simulate.click(show));
  expect(dialog.open).toBe(true);
  act(() => Simulate.cancel(dialog));
  expect(dialog.open).toBe(false);
  await act(async () => Simulate.click(show));
  act(() => Simulate.keyDown(dialog, { key: 'Escape' }));
  expect(dialog.open).toBe(false);
});

test.each([{ partyId: 'other-party' }, { memberId: 'other-member' }])('loads the current party invitation instead of stale browser storage: %s', async (scope) => {
  useAuth.mockReturnValue({ authLevel: 'guest', partyInvitation: { ...invitation, ...scope } });
  await renderGuest();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Show party QR code"]')));
  expect(getCurrentPartyInvitation).toHaveBeenCalledWith('party-id');
  expect(container.querySelector('.url-text').textContent).toContain(invitation.token);
});

test.each(['member', 'admin'])('signed-in %s guest members have a QR sharing button', async (authLevel) => {
  useAuth.mockReturnValue({ authLevel });
  await renderGuest();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Show party QR code"]')));
  expect(getCurrentPartyInvitation).toHaveBeenCalledWith('party-id');
  expect(createPartyInvitation).not.toHaveBeenCalled();
});

test('missing host invitations show an error and can be retried without creating invitations', async () => {
  getCurrentPartyInvitation.mockRejectedValueOnce({ response: { data: { error: 'Ask a host to open their QR code to enable sharing.' } } });
  await renderGuest();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Show party QR code"]')));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Ask a host');
  await act(async () => Simulate.click(container.querySelector('.qr-regenerate')));
  expect(container.querySelector('.qr-wrapper svg')).not.toBeNull();
  expect(container.querySelector('.qr-regenerate')).toBeNull();
  expect(createPartyInvitation).not.toHaveBeenCalled();
});

test('passkey-signed-in guests can go home without signing out', async () => {
  useAuth.mockReturnValue({ authLevel: 'admin' });
  const switchUser = jest.fn();
  await renderGuest({ label: 'Sign out', run: switchUser });
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

test('combines Account Info, Reset All and Sign out in one menu immediately after Status', async () => {
  const switchUser = jest.fn();
  const accountInfo = jest.fn();
  await renderGuest({ label: 'Sign out', run: switchUser }, { label: 'Account Info', run: accountInfo });
  const statusButton = container.querySelector('[aria-label="Toggle connection status"]');
  const switchButton = statusButton.nextElementSibling;
  expect(switchButton.getAttribute('aria-label')).toBe('Account actions');
  expect(container.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(1);
  act(() => { Simulate.click(switchButton); });
  expect([...document.querySelectorAll('[role="menuitem"]')].map(button => button.textContent))
    .toEqual(['Account Info', 'Reset All', 'Sign out']);
  act(() => Simulate.click(document.querySelector('[role="menuitem"][aria-label="Account Info"]')));
  expect(accountInfo).toHaveBeenCalledTimes(1);
  act(() => Simulate.click(switchButton));
  act(() => Simulate.click(document.querySelector('[role="menuitem"][aria-label="Sign out"]')));
  expect(switchUser).toHaveBeenCalledTimes(1);
});

async function selectResetAll() {
  act(() => Simulate.click(container.querySelector('[aria-label="Account actions"]')));
  const reset = document.querySelector('[role="menuitem"][aria-label="Reset All"]');
  await act(async () => reset.click());
  return reset;
}

test.each([false, true])('guest Reset All confirms and updates from the socket (locked: %s)', async (isLocked) => {
  const playing = { id: 'playing', status: 'playing', position: 1 };
  const played = { id: 'played', status: 'played', position: 2 };
  getParty.mockResolvedValueOnce({ data: { id: 'party-id', name: 'Friday', is_locked: isLocked } });
  getQueue.mockResolvedValueOnce({ data: [playing, played] });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  resetQueue.mockResolvedValueOnce({ data: { success: true } });
  await renderGuest();
  await selectResetAll();
  expect(confirm).toHaveBeenCalledWith('Reset all songs (except the currently playing one) back to queued?');
  expect(resetQueue).toHaveBeenCalledWith('party-id');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mockPlaylistProps.queue).toEqual([playing, played]);
  const updatedQueue = [playing, { ...played, status: 'queued' }];
  act(() => handlers['queue:update']({ action: 'status', queue: updatedQueue }));
  expect(mockPlaylistProps.queue).toEqual(updatedQueue);
});

test('guest Reset All does nothing when confirmation is cancelled', async () => {
  getQueue.mockResolvedValueOnce({ data: [{ id: 'played', status: 'played', position: 1 }] });
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  await renderGuest();
  await selectResetAll();
  expect(resetQueue).not.toHaveBeenCalled();
});

test('guest Reset All is disabled for an empty queue', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  await renderGuest();
  const reset = await selectResetAll();
  expect(reset.disabled).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(resetQueue).not.toHaveBeenCalled();
});

test('guest Reset All reports failures without changing the queue and can be retried', async () => {
  const queue = [{ id: 'played', status: 'played', position: 1 }];
  getQueue.mockResolvedValueOnce({ data: queue });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  resetQueue.mockRejectedValueOnce(new Error('Unavailable'));
  await renderGuest();
  await selectResetAll();
  expect(container.textContent).toContain('Failed to reset queue.');
  expect(mockPlaylistProps.queue).toEqual(queue);
  resetQueue.mockResolvedValueOnce({ data: { success: true } });
  await selectResetAll();
  expect(resetQueue).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('Failed to reset queue.');
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