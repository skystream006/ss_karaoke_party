import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getMemberNames, getParties, getPartyByCode, getPartyMembers, searchMembers, getAllParties, getQueue, updateQueueItemSinger } from '../services/api';
import ThemePicker from './ThemePicker';
import PasswordModal from './PasswordModal';
import JoinPage from '../pages/JoinPage';
import SettingsPage from '../pages/SettingsPage';

jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: jest.fn() }));
jest.mock('../services/api', () => ({
  getMemberNames: jest.fn(), getParties: jest.fn(), getPartyByCode: jest.fn(),
  getPartyMembers: jest.fn(), searchMembers: jest.fn(), getAllParties: jest.fn(),
  getQueue: jest.fn(), updateQueueItemSinger: jest.fn(),
}));

let root;
let container;
let setTheme;
let saveDefaultUsername;
const names = Object.freeze([{ name: 'zoe' }, { name: 'Bravo' }, { name: 'alice' }]);
const members = Object.freeze(names.map((member, index) => ({ ...member, id: `member-${index}`, role: 'organizer' })));
const party = { id: 'party-id', name: 'Friday', join_code: 'ABCDEF', is_active: true };
const song = { id: 'song-id', video_title: 'Song', member_id: 'member-0', singer_name: 'zoe', position: 1, status: 'queued' };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  setTheme = jest.fn();
  saveDefaultUsername = jest.fn();
  useTheme.mockReturnValue({
    themeKey: 'third', setTheme,
    themes: {
      third: { label: 'Zulu', swatch: '#000000' },
      first: { label: 'alpha', swatch: '#111111' },
      second: { label: 'Bravo', swatch: '#222222' },
    },
  });
  useAuth.mockReturnValue({
    usernameRequired: true, defaultUsername: '', loading: false, error: '',
    login: jest.fn(), clearError: jest.fn(), saveDefaultUsername,
  });
  getMemberNames.mockResolvedValue({ data: names });
  getParties.mockResolvedValue({ data: [party] });
  getAllParties.mockResolvedValue({ data: [party] });
  getPartyByCode.mockResolvedValue({ data: party });
  getPartyMembers.mockResolvedValue({ data: members });
  searchMembers.mockResolvedValue({ data: members });
  getQueue.mockResolvedValue({ data: [song] });
  updateQueueItemSinger.mockResolvedValue({ data: song });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('theme options are alphabetical by label and retain their selection keys', () => {
  act(() => root.render(<ThemePicker />));
  act(() => Simulate.click(container.querySelector('[aria-label="Change color theme"]')));
  const options = [...container.querySelectorAll('[role="option"]')];
  expect(options.map(option => option.textContent.replace('✓', ''))).toEqual(['alpha', 'Bravo', 'Zulu']);
  expect(options[2].getAttribute('aria-selected')).toBe('true');
  act(() => Simulate.click(options[0]));
  expect(setTheme).toHaveBeenCalledWith('first');
});

test('default username suggestions sort case-insensitively without mutating the response', async () => {
  await act(async () => root.render(<PasswordModal />));
  expect([...container.querySelectorAll('datalist option')].map(option => option.value)).toEqual(['alice', 'Bravo', 'zoe']);
  expect(names.map(member => member.name)).toEqual(['zoe', 'Bravo', 'alice']);
  act(() => Simulate.change(container.querySelector('input'), { target: { value: 'Bravo' } }));
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(saveDefaultUsername).toHaveBeenCalledWith('Bravo');
});

test('join-name suggestions are alphabetical and still select the displayed name', async () => {
  jest.useFakeTimers();
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/join/ABCDEF']}>
      <Routes><Route path="/join/:joinCode" element={<JoinPage />} /></Routes>
    </MemoryRouter>
  ));
  const input = container.querySelector('.name-autocomplete-wrapper input');
  act(() => Simulate.change(input, { target: { value: 'al' } }));
  await act(async () => jest.advanceTimersByTime(300));
  expect([...container.querySelectorAll('.suggestion-name')].map(option => option.textContent)).toEqual(['alice', 'Bravo', 'zoe']);
  act(() => Simulate.mouseDown(container.querySelector('.name-suggestion-item')));
  expect(input.value).toBe('alice');
  expect(members.map(member => member.name)).toEqual(['zoe', 'Bravo', 'alice']);
});

test('settings roles and singer options are alphabetical while keeping placeholder and member IDs', async () => {
  await act(async () => root.render(<MemoryRouter><SettingsPage /></MemoryRouter>));
  await act(async () => Simulate.click(container.querySelector('[title="Manage members"]')));
  act(() => Simulate.click(container.querySelector('[title="Edit member"]')));
  const roleSelect = container.querySelector('select');
  expect([...roleSelect.options].map(option => option.textContent)).toEqual(['Guest', 'Organizer']);
  expect(roleSelect.value).toBe('organizer');
  act(() => Simulate.click([...container.querySelectorAll('.settings-inline-actions button')].find(button => button.textContent === 'Cancel')));
  act(() => Simulate.click([...container.querySelectorAll('.settings-tab')].find(button => button.textContent.includes('Songs'))));
  act(() => Simulate.click(container.querySelector('[title="Click to change singer"]')));
  const singerSelect = container.querySelector('select');
  expect(singerSelect.options[0].value).toBe('');
  expect([...singerSelect.options].slice(1).map(option => option.textContent)).toEqual(['alice', 'Bravo', 'zoe']);
  expect(singerSelect.value).toBe('member-0');
  act(() => Simulate.change(singerSelect, { target: { value: 'member-2' } }));
  await act(async () => Simulate.click([...container.querySelectorAll('.settings-inline-actions button')].find(button => button.textContent === 'Save')));
  expect(updateQueueItemSinger).toHaveBeenCalledWith('party-id', 'song-id', { singer_name: 'alice', member_id: 'member-2' });
  expect(members.map(member => member.name)).toEqual(['zoe', 'Bravo', 'alice']);
});