import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import axios from 'axios';
import App from './App';
import { getMemberNames, getParties, getPartyMembers, createParty, joinParty, getPartyByCode } from './services/api';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('./services/api', () => ({
  getMemberNames: jest.fn(), getParties: jest.fn(), getPartyMembers: jest.fn(),
  createParty: jest.fn(), joinParty: jest.fn(), getPartyByCode: jest.fn(),
}));
jest.mock('./components/ThemePicker', () => () => null);
jest.mock('./pages/OrganizerPage', () => ({ switchUserButton }) => <div>Organizer view{switchUserButton}</div>);
jest.mock('./pages/GuestPage', () => () => <div>Guest view</div>);
jest.mock('./pages/SettingsPage', () => () => <div>Settings view</div>);

let root;
let container;
const party = { id: 'party-id', name: 'Friday', join_code: 'ABCDEF' };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  jest.resetAllMocks();
  window.history.replaceState({}, '', '/');
  getMemberNames.mockResolvedValue({ data: [{ name: 'Alex' }, { name: 'Jordan' }] });
  getParties.mockResolvedValue({ data: [party] });
  getPartyMembers.mockResolvedValue({ data: [] });
  getPartyByCode.mockResolvedValue({ data: party });
  axios.post.mockResolvedValue({ data: { token: 'token', level: 'member' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderApp() {
  await act(async () => { root.render(<App />); });
}

function change(selector, value) {
  act(() => { Simulate.change(container.querySelector(selector), { target: { value } }); });
}

async function submit() {
  await act(async () => { Simulate.submit(container.querySelector('form')); });
}

async function click(label) {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent.includes(label));
  await act(async () => { Simulate.click(button); });
}

async function login() {
  await renderApp();
  change('input[type="password"]', 'password');
  await submit();
}

test('offers existing usernames after password login and uses the selection for creating a party', async () => {
  await login();
  expect(getMemberNames).toHaveBeenCalledTimes(1);
  expect([...container.querySelectorAll('datalist option')].map((option) => option.value)).toEqual(['Alex', 'Jordan']);
  expect(container.querySelector('input[list]').getAttribute('list')).toBe('default-username-options');
  change('input[list]', 'Alex');
  await submit();
  await click('Start a Party');
  expect(container.querySelector('#organizerName').value).toBe('Alex');
  change('#partyName', 'Friday');
  createParty.mockResolvedValue({ data: { party, member: { id: 'member-id', name: 'Alex', role: 'organizer' } } });
  await submit();
  expect(createParty).toHaveBeenCalledWith({ name: 'Friday', organizer_name: 'Alex' });
});

test('accepts a new username and uses it when joining a party', async () => {
  await login();
  change('input[list]', '  New Singer  ');
  await submit();
  await click('Join a Party');
  await click('Join');
  expect(container.querySelector('.name-autocomplete-wrapper input').value).toBe('New Singer');
  joinParty.mockResolvedValue({ data: { id: 'member-id', name: 'New Singer', role: 'guest' } });
  await submit();
  expect(joinParty).toHaveBeenCalledWith('party-id', { name: 'New Singer', role: 'guest' });
});

test('still accepts a name when suggestions cannot be loaded', async () => {
  getMemberNames.mockRejectedValue(new Error('offline'));
  await login();
  expect(container.textContent).toContain('Could not load usernames');
  change('input[list]', 'Taylor');
  await submit();
  expect(localStorage.getItem('defaultUsername')).toBe('Taylor');
  expect(container.textContent).toContain('Start a Party');
});

test('does not request usernames for QR-code access', async () => {
  window.history.replaceState({}, '', '/join/ABCDEF');
  axios.get.mockResolvedValue({ data: { token: 'qr-token', level: 'member' } });
  await renderApp();
  expect(getMemberNames).not.toHaveBeenCalled();
  expect(container.querySelector('.password-modal')).toBeNull();
  expect(container.querySelector('.name-autocomplete-wrapper input').value).toBe('');
});

test('switches users without logging in again and updates both party form defaults', async () => {
  await login();
  change('input[list]', 'Alex');
  await submit();
  await click('Switch user');
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.querySelector('input[list]').value).toBe('Alex');
  expect(container.querySelectorAll('datalist option')).toHaveLength(2);
  change('input[list]', 'Jordan');
  await submit();
  expect(sessionStorage.getItem('authToken')).toBe('token');
  expect(sessionStorage.getItem('authLevel')).toBe('member');
  expect(localStorage.getItem('defaultUsername')).toBe('Jordan');
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(container.querySelector('.user-toolbar')).toBeNull();
  await click('Start a Party');
  expect(container.querySelector('#organizerName').value).toBe('Jordan');
  await click('Back');
  await click('Join a Party');
  await click('Join');
  expect(container.querySelector('.name-autocomplete-wrapper input').value).toBe('Jordan');
});

test('switching from a party clears the local member identity while preserving admin access', async () => {
  sessionStorage.setItem('authToken', 'admin-token');
  sessionStorage.setItem('authLevel', 'admin');
  sessionStorage.setItem('memberName', 'Alex');
  sessionStorage.setItem('memberId', 'old-member');
  sessionStorage.setItem('memberRole', 'organizer');
  localStorage.setItem('defaultUsername', 'Alex');
  window.history.replaceState({}, '', '/organizer/party-id/old-member');
  await renderApp();
  await click('Switch user');
  expect(window.location.pathname).toBe('/');
  expect(container.textContent).not.toContain('Organizer view');
  expect(sessionStorage.getItem('memberId')).toBeNull();
  expect(sessionStorage.getItem('memberName')).toBeNull();
  expect(sessionStorage.getItem('memberRole')).toBeNull();
  change('input[list]', 'New Singer');
  await submit();
  expect(sessionStorage.getItem('authToken')).toBe('admin-token');
  expect(sessionStorage.getItem('authLevel')).toBe('admin');
  expect(axios.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Start a Party');
});

test('QR users can switch names without requesting another session', async () => {
  window.history.replaceState({}, '', '/join/ABCDEF');
  axios.get.mockResolvedValue({ data: { token: 'qr-token', level: 'member' } });
  await renderApp();
  await click('Switch user');
  change('input[list]', 'Taylor');
  await submit();
  expect(localStorage.getItem('defaultUsername')).toBe('Taylor');
  expect(sessionStorage.getItem('authToken')).toBe('qr-token');
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});