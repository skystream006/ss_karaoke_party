import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, getMember, getServerInfo } from '../services/api';
import GuestPage from './GuestPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), getMember: jest.fn(), getServerInfo: jest.fn(),
}));
jest.mock('../components/Playlist', () => () => null);
jest.mock('../components/CustomizationPanel', () => () => null);
jest.mock('../components/SongSearch', () => () => null);
jest.mock('../components/ThemePicker', () => () => null);

let root;
let container;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF' } });
  getQueue.mockResolvedValue({ data: [] });
  getMember.mockResolvedValue({ data: { id: 'member-id', name: 'Alex' } });
  getServerInfo.mockResolvedValue({ data: { ip: '192.168.1.10' } });
  io.mockReturnValue({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
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

test('places the switch user action immediately after Status', async () => {
  const switchUser = jest.fn();
  await renderGuest(<button type="button" onClick={switchUser}>Switch user</button>);
  const statusButton = container.querySelector('[aria-label="Toggle connection status"]');
  const switchButton = statusButton.nextElementSibling;
  expect(switchButton.textContent).toBe('Switch user');
  act(() => { Simulate.click(switchButton); });
  expect(switchUser).toHaveBeenCalledTimes(1);
});

test('does not offer QR sharing when the party cannot be loaded', async () => {
  getParty.mockRejectedValue(new Error('not found'));
  await renderGuest();
  expect(container.querySelector('[aria-label="Show party QR code"]')).toBeNull();
  expect(getServerInfo).not.toHaveBeenCalled();
});