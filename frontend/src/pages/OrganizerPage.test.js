import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, getMember, endParty, deleteParty, lockParty } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import OrganizerPage from './OrganizerPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), getMember: jest.fn(),
  endParty: jest.fn(), deleteParty: jest.fn(), lockParty: jest.fn(),
}));
jest.mock('../components/VideoPlayer', () => {
  const React = require('react');
  return React.forwardRef(() => null);
});
jest.mock('../components/Playlist', () => () => null);
jest.mock('../components/QRCodeModal', () => () => null);
jest.mock('../components/CustomizationPanel', () => () => null);
jest.mock('../components/SongSearch', () => () => null);
jest.mock('../components/ThemePicker', () => () => null);

let root;
let container;
let socket;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  useAuth.mockReturnValue({ authLevel: 'admin' });
  sessionStorage.clear();
  sessionStorage.setItem('memberId', 'member-id');
  sessionStorage.setItem('memberName', 'Alex');
  getParty.mockResolvedValue({
    data: { id: 'party-id', name: 'Friday', join_code: 'ABCDEF', is_active: true },
  });
  getQueue.mockResolvedValue({ data: [] });
  getMember.mockResolvedValue({ data: { id: 'member-id', name: 'Alex' } });
  socket = { on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() };
  io.mockReturnValue(socket);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
});

async function renderOrganizer(signOutAction) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/organizer/party-id/member-id']}>
        <Routes>
          <Route path="/" element={<div>Welcome home</div>} />
          <Route path="/organizer/:partyId/:memberId" element={<OrganizerPage signOutAction={signOutAction} />} />
        </Routes>
      </MemoryRouter>
    );
  });
}

test('places the Home button immediately after the left menu toggle without changing menu behavior', async () => {
  await renderOrganizer();
  const toggle = container.querySelector('button[aria-label="Toggle playlist"]');
  const home = container.querySelector('button[aria-label="Home"]');
  expect(toggle.parentElement.className).toBe('header-left');
  expect(toggle.nextElementSibling).toBe(home);
  expect(home.title).toBe('Home');
  expect(home.type).toBe('button');
  expect(container.textContent).not.toContain('ABCDEF');
  expect(container.querySelector('.sidebar').classList.contains('open')).toBe(true);

  act(() => { Simulate.click(toggle); });
  expect(toggle.textContent).toBe('☰');
  expect(container.querySelector('.sidebar').classList.contains('open')).toBe(false);
  expect(toggle.nextElementSibling).toBe(home);

  act(() => { Simulate.click(toggle); });
  expect(container.querySelector('.sidebar').classList.contains('open')).toBe(true);
});

test.each([true, false])('navigates home without deleting the party or clearing the member when the sidebar is open: %s', async (sidebarOpen) => {
  await renderOrganizer();
  if (!sidebarOpen) {
    act(() => { Simulate.click(container.querySelector('button[aria-label="Toggle playlist"]')); });
  }

  await act(async () => { Simulate.click(container.querySelector('button[aria-label="Home"]')); });

  expect(container.textContent).toBe('Welcome home');
  expect(container.querySelector('.organizer-layout')).toBeNull();
  expect(deleteParty).not.toHaveBeenCalled();
  expect(lockParty).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('memberId')).toBe('member-id');
  expect(sessionStorage.getItem('memberName')).toBe('Alex');
  expect(socket.emit).toHaveBeenCalledWith('leave:party', 'party-id');
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
});

test('groups party controls and sign-out in one three-dot menu', async () => {
  const signOut = jest.fn();
  await renderOrganizer({ label: 'Sign out', run: signOut });
  expect(container.querySelector('[aria-label="Lock party queue"]')).toBeNull();
  expect(container.querySelector('[aria-label="End party"]')).toBeNull();
  expect(container.querySelector('[aria-label="Permanently delete party"]')).toBeNull();
  expect(container.textContent).not.toContain('Sign out');
  const trigger = container.querySelector('[aria-label="Party actions"]');
  expect(trigger).not.toBeNull();
  expect(container.querySelectorAll('.header-right [aria-haspopup="menu"]')).toHaveLength(1);
  act(() => Simulate.click(trigger));
  const menu = document.querySelector('[role="menu"]');
  const actions = [...menu.querySelectorAll('[role="menuitem"]')];
  expect(actions.map(button => button.textContent)).toEqual(['Lock party queue', 'End party', 'Delete party', 'Sign out']);
  act(() => Simulate.click(actions[3]));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test.each([false, true])('party menu toggles the queue lock when initially locked: %s', async (isLocked) => {
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', is_active: true, is_locked: isLocked } });
  lockParty.mockResolvedValue({ data: { is_locked: !isLocked } });
  await renderOrganizer();
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  const label = isLocked ? 'Unlock party queue' : 'Lock party queue';
  await act(async () => Simulate.click(document.querySelector(`[aria-label="${label}"]`)));
  expect(lockParty).toHaveBeenCalledWith('party-id', !isLocked, 'member-id');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  expect(document.querySelector(`[aria-label="${isLocked ? 'Lock party queue' : 'Unlock party queue'}"]`)).not.toBeNull();
});

test.each([
  ['End party', endParty, 'End this party and disconnect invited guests?'],
  ['Permanently delete party', deleteParty, 'Permanently delete this party and all its data? This cannot be undone.'],
])('%s still requires confirmation from the menu', async (label, action, message) => {
  action.mockResolvedValue({ data: { success: true } });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  await renderOrganizer();
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  await act(async () => Simulate.click(document.querySelector(`[aria-label="${label}"]`)));
  expect(confirm).toHaveBeenCalledWith(message);
  expect(action).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  confirm.mockReturnValue(true);
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  await act(async () => Simulate.click(document.querySelector(`[aria-label="${label}"]`)));
  expect(action).toHaveBeenCalledWith('party-id');
  expect(container.textContent).toBe('Welcome home');
  confirm.mockRestore();
});

test('ended parties do not offer the end action in their menu', async () => {
  getParty.mockResolvedValue({ data: { id: 'party-id', name: 'Friday', is_active: false } });
  await renderOrganizer();
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  expect(document.querySelector('[aria-label="End party"]')).toBeNull();
  expect(document.querySelector('[aria-label="Permanently delete party"]')).not.toBeNull();
});

test('non-admin hosts can end their party but do not get permanent deletion controls', async () => {
  useAuth.mockReturnValue({ authLevel: 'member' });
  endParty.mockResolvedValue({ data: { success: true } });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  await renderOrganizer();
  act(() => Simulate.click(container.querySelector('[aria-label="Party actions"]')));
  expect(document.querySelector('[aria-label="Permanently delete party"]')).toBeNull();
  await act(async () => Simulate.click(document.querySelector('[aria-label="End party"]')));
  expect(endParty).toHaveBeenCalledWith('party-id');
  expect(deleteParty).not.toHaveBeenCalled();
  expect(container.textContent).toBe('Welcome home');
  confirm.mockRestore();
});
