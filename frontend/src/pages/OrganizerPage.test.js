import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, getMember, deleteParty, lockParty } from '../services/api';
import OrganizerPage from './OrganizerPage';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('../services/api', () => ({
  getParty: jest.fn(), getQueue: jest.fn(), getMember: jest.fn(),
  deleteParty: jest.fn(), lockParty: jest.fn(),
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

async function renderOrganizer() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/organizer/party-id/member-id']}>
        <Routes>
          <Route path="/" element={<div>Welcome home</div>} />
          <Route path="/organizer/:partyId/:memberId" element={<OrganizerPage />} />
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
