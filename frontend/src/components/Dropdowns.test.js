import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getMemberNames, getParties, getPartyByCode, getPartyMembers, searchMembers, getAllParties, getQueue, updateQueueItemSinger } from '../services/api';
import ThemePicker from './ThemePicker';
import PasswordModal from './PasswordModal';
import Playlist from './Playlist';
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

test.each([true, false])('playlist titles appear above details and controls (organizer: %s)', (isOrganizer) => {
  act(() => root.render(<Playlist queue={[{ ...song, video_thumbnail: '/thumbnail.jpg' }]}
    isOrganizer={isOrganizer} onPlay={jest.fn()} />));
  const item = container.querySelector('.playlist-item');
  const title = item.querySelector('.playlist-title');
  const row = item.querySelector('.playlist-item-row');
  expect(item.firstElementChild).toBe(title);
  expect(title.textContent).toBe(song.video_title);
  expect(title.nextElementSibling).toBe(row);
  expect(row.querySelector('.playlist-singer').textContent).toContain(song.singer_name);
  expect(row.querySelector('.playlist-thumb')).not.toBeNull();
  expect(row.querySelector('button[aria-label="Play now"]')).not.toBeNull();
});

test('playlist playback stays inline while secondary actions remain in the three-dot menu', () => {
  const onPlay = jest.fn();
  const onPause = jest.fn();
  const onRemove = jest.fn();
  const onSendToSSMusic = jest.fn();
  const renderPlaylist = (status = 'queued') => act(() => root.render(
    <Playlist queue={[{ ...song, status }]} isOrganizer onPlay={onPlay} onPause={onPause}
      onRemove={onRemove} onSendToSSMusic={onSendToSSMusic} />
  ));
  const openMenu = () => act(() => Simulate.click(container.querySelector('[aria-haspopup="menu"]')));
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')];
  renderPlaylist();
  expect(container.querySelectorAll('.playlist-actions button')).toHaveLength(2);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  const play = container.querySelector('button[aria-label="Play now"]');
  expect(play.title).toBe('Play now');
  expect(play.type).toBe('button');
  expect(play.nextElementSibling.getAttribute('aria-haspopup')).toBe('menu');
  act(() => Simulate.click(play));
  expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: song.id, status: 'queued' }));
  openMenu();
  expect(menuItems().map(button => button.textContent)).toEqual(['Send to ssMusic', 'Remove']);
  expect(document.activeElement).toBe(menuItems()[0]);
  act(() => Simulate.click(menuItems()[0]));
  expect(onSendToSSMusic).toHaveBeenCalledWith(expect.objectContaining({ id: song.id }));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  openMenu();
  act(() => Simulate.click(menuItems()[1]));
  expect(onRemove).toHaveBeenCalledWith(song.id);
  renderPlaylist('playing');
  act(() => Simulate.click(container.querySelector('button[aria-label="Pause"]')));
  expect(onPause).toHaveBeenCalledWith(expect.objectContaining({ id: song.id, status: 'playing' }));
  openMenu();
  expect(menuItems().map(button => button.textContent)).toEqual(['Send to ssMusic', 'Remove']);
  act(() => Simulate.keyDown(document.querySelector('[role="menu"]'), { key: 'Escape' }));
  renderPlaylist('paused');
  act(() => Simulate.click(container.querySelector('button[aria-label="Resume"]')));
  expect(onPlay).toHaveBeenLastCalledWith(expect.objectContaining({ id: song.id, status: 'paused' }));
  openMenu();
  expect(menuItems().map(button => button.textContent)).toEqual(['Send to ssMusic', 'Remove']);
});

test.each([
  ['queued', 'Play now'],
  ['playing', 'Pause'],
  ['paused', 'Resume'],
  ['played', 'Play now'],
])('playlist %s playback works without any menu actions', (status, label) => {
  const onPlay = jest.fn();
  const onPause = jest.fn();
  const item = { ...song, source: 'ssmusic', status };
  act(() => root.render(<Playlist queue={[item]} onPlay={onPlay} onPause={onPause}
    onSendToSSMusic={jest.fn()} />));
  expect(container.querySelectorAll('.playlist-actions button')).toHaveLength(1);
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  act(() => Simulate.click(container.querySelector(`button[aria-label="${label}"]`)));
  expect(status === 'playing' ? onPause : onPlay).toHaveBeenCalledWith(item);
  expect(status === 'playing' ? onPlay : onPause).not.toHaveBeenCalled();
});

test.each(['queued', 'playing', 'paused', 'played'])('playlist %s playback requires its callback', (status) => {
  const playbackProps = status === 'playing' ? { onPlay: jest.fn() } : { onPause: jest.fn() };
  act(() => root.render(<Playlist queue={[{ ...song, status }]} {...playbackProps}
    isOrganizer canRemove={false} onRemove={jest.fn()} />));
  expect(container.querySelector('.playlist-actions')).toBeNull();
});

test('playlist closes an open menu when conversion leaves only inline playback', () => {
  const onPlay = jest.fn();
  const onSendToSSMusic = jest.fn();
  const renderPlaylist = (item) => act(() => root.render(
    <Playlist queue={[item]} onPlay={onPlay} onSendToSSMusic={onSendToSSMusic} />
  ));
  renderPlaylist(song);
  act(() => Simulate.click(container.querySelector('[aria-haspopup="menu"]')));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  const converted = { ...song, source: 'ssmusic' };
  renderPlaylist(converted);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  act(() => Simulate.click(container.querySelector('button[aria-label="Play now"]')));
  expect(onPlay).toHaveBeenCalledWith(converted);
});

test('playlist sends only YouTube items and disables only the item already being sent', () => {
  const onSendToSSMusic = jest.fn();
  const queue = [song, { ...song, id: 'second', video_title: 'Second', position: 2 },
    { ...song, id: 'ssmusic', video_title: 'Library', source: 'ssmusic', position: 3 }];
  act(() => root.render(<Playlist queue={queue} onPlay={jest.fn()} onSendToSSMusic={onSendToSSMusic}
    ssmusicState={{ [song.id]: { pending: true } }} />));
  const triggers = container.querySelectorAll('[aria-haspopup="menu"]');
  expect(triggers).toHaveLength(2);
  act(() => Simulate.click(triggers[0]));
  expect(document.querySelector('[role="menuitem"]').disabled).toBe(true);
  expect(container.querySelector('[role="status"]').textContent).toBe('Video is processing, come back when done');
  act(() => Simulate.click(triggers[1]));
  const send = document.querySelector('[role="menuitem"]');
  expect(send.disabled).toBe(false);
  act(() => Simulate.click(send));
  expect(onSendToSSMusic).toHaveBeenCalledWith(queue[1]);
  const libraryRow = container.querySelectorAll('.playlist-item')[2];
  expect(libraryRow.querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(libraryRow.querySelector('button[aria-label="Play now"]')).not.toBeNull();
});

test('playlist menus support keyboard navigation, Escape focus return, and outside dismissal', () => {
  act(() => root.render(<Playlist queue={[song]} isOrganizer onPlay={jest.fn()} onRemove={jest.fn()}
    onSendToSSMusic={jest.fn()} />));
  const trigger = container.querySelector('[aria-haspopup="menu"]');
  act(() => Simulate.keyDown(trigger, { key: 'ArrowDown' }));
  const menu = document.querySelector('[role="menu"]');
  const buttons = menu.querySelectorAll('button');
  expect(document.activeElement).toBe(buttons[0]);
  act(() => Simulate.keyDown(menu, { key: 'ArrowDown' }));
  expect(document.activeElement).toBe(buttons[1]);
  act(() => Simulate.keyDown(menu, { key: 'Escape' }));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  act(() => Simulate.click(trigger));
  act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('read-only playlist rows have no menu and persisted job errors remain visible', () => {
  act(() => root.render(<Playlist queue={[{ ...song, ssmusic_status: 'error', ssmusic_error: 'ssMusic job failed' }]} />));
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(container.querySelector('.playlist-playback-button')).toBeNull();
  expect(container.querySelector('[role="alert"]').textContent).toBe('ssMusic job failed');
});

test('converted rows are marked kpMedia while regular library rows remain ssMusic', () => {
  act(() => root.render(<Playlist queue={[
    { ...song, source: 'ssmusic', kpMedia: true },
    { ...song, id: 'library', source: 'ssmusic', position: 2 },
  ]} onSendToSSMusic={jest.fn()} />));
  expect([...container.querySelectorAll('.playlist-media-status')].map(element => element.textContent)).toEqual(['kpMedia', 'ssMusic']);
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
});