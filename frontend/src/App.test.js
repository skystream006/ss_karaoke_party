import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import axios from 'axios';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import App from './App';
import QRCodeModal from './components/QRCodeModal';
import { getParties, createParty, joinParty, resolvePartyInvitation, createPartyInvitation, getPasskeys, getAuthUsers, updateAuthUser } from './services/api';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('@simplewebauthn/browser', () => ({ startAuthentication: jest.fn(), startRegistration: jest.fn() }));
jest.mock('./services/api', () => ({
  getParties: jest.fn(), createParty: jest.fn(), joinParty: jest.fn(), resolvePartyInvitation: jest.fn(), createPartyInvitation: jest.fn(),
  getPasskeys: jest.fn(), getAuthUsers: jest.fn(), updateAuthUser: jest.fn(), removePasskey: jest.fn(),
}));
jest.mock('./components/ThemePicker', () => () => null);
jest.mock('./pages/OrganizerPage', () => ({ switchUserButton }) => <div>Organizer view{switchUserButton}</div>);
jest.mock('./pages/GuestPage', () => () => <div>Guest view</div>);
jest.mock('./pages/SettingsPage', () => () => <div>Settings view</div>);

let root;
let container;
const party = { id: 'party-id', name: 'Friday', join_code: 'ABCDEF' };
const session = { token: 'token', level: 'member', user: { id: 'account', name: 'Alex', role: 'member' } };
const invitation = 'a'.repeat(43);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  jest.resetAllMocks();
  window.PublicKeyCredential = function PublicKeyCredential() {};
  window.history.replaceState({}, '', '/');
  getParties.mockResolvedValue({ data: [party] });
  resolvePartyInvitation.mockResolvedValue({ data: { party, host: 'Alex', expiresAt: '2099-01-01' } });
  startAuthentication.mockResolvedValue({ id: 'credential' });
  startRegistration.mockResolvedValue({ id: 'credential' });
  axios.post.mockImplementation(async (url) => ({ data: url.endsWith('/options') ? { requestId: 'request', options: {} } : session }));
  axios.get.mockResolvedValue({ data: session });
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
  await submit();
}

test('passkey login uses the verified account name when creating a party', async () => {
  await renderApp();
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.textContent).toContain('Sign in with a passkey');
  await submit();
  expect(startAuthentication).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls.map(([url]) => url)).toEqual(['/api/auth/login/options', '/api/auth/login/verify']);
  await click('Start a Party');
  expect(container.querySelector('#organizerName').value).toBe('Alex');
  change('#partyName', 'Friday');
  createParty.mockResolvedValue({ data: { party, member: { id: 'member-id', name: 'Alex', role: 'organizer' } } });
  await submit();
  expect(createParty).toHaveBeenCalledWith({ name: 'Friday', organizer_name: 'Alex' });
});

test('account holders join with their own identity without selecting another member', async () => {
  await login();
  await click('Join a Party');
  await click('Join');
  expect(container.textContent).not.toContain('Current Members');
  joinParty.mockResolvedValue({ data: { id: 'member-id', name: 'Alex', role: 'organizer' } });
  await submit();
  expect(joinParty).toHaveBeenCalledWith('party-id', { name: 'Alex', role: 'organizer' });
});

test('registration displays pending approval without signing the user in', async () => {
  axios.post.mockImplementation(async (url) => ({ data: url.endsWith('/options') ? { requestId: 'request', options: {} }
    : { pending: true, message: 'Awaiting administrator approval.' } }));
  await renderApp();
  await click('Create an account');
  change('#passkey-name', 'Jordan');
  await submit();
  expect(startRegistration).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Awaiting administrator approval.');
  expect(container.textContent).toContain('Sign in with a passkey');
  expect(sessionStorage.getItem('authToken')).toBeNull();
});

test('QR invitation checks only the secret and accepts a scoped guest response', async () => {
  window.history.replaceState({}, '', `/join/invite#invite=${invitation}`);
  await renderApp();
  expect(resolvePartyInvitation).toHaveBeenCalledWith(invitation);
  expect(getParties).not.toHaveBeenCalled();
  expect(axios.get).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Host: Alex');
  expect(container.textContent).not.toContain('Join as');
  change('#guest-name', 'Taylor');
  joinParty.mockResolvedValue({ data: { token: 'guest-token', level: 'guest', partyId: party.id, memberId: 'guest-id',
    member: { id: 'guest-id', name: 'Taylor', role: 'guest' } } });
  await submit();
  expect(joinParty).toHaveBeenCalledWith(party.id, { name: 'Taylor', invitation });
  expect(sessionStorage.getItem('authLevel')).toBe('guest');
  expect(window.location.pathname).toBe('/guest/party-id/guest-id');
  expect(window.location.hash).toBe('');
  expect(container.textContent).toContain('Guest view');
});

test('legacy join codes cannot auto-authenticate', async () => {
  window.history.replaceState({}, '', '/join/ABCDEF');
  await renderApp();
  expect(container.textContent).toContain('This join link is no longer valid.');
  expect(resolvePartyInvitation).not.toHaveBeenCalled();
  expect(axios.get).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('authToken')).toBeNull();
});

test.each(['/', '/join', '/settings', '/account', '/organizer/party-id/host', '/guest/other-party/other-member'])(
  'QR guests cannot escape their assigned party through %s', async (pathname) => {
    sessionStorage.setItem('authToken', 'guest-token');
    sessionStorage.setItem('authLevel', 'admin');
    axios.get.mockResolvedValue({ data: { level: 'guest', partyId: 'party-id', memberId: 'guest-id' } });
    window.history.replaceState({}, '', pathname);
    await renderApp();
    expect(window.location.pathname).toBe('/guest/party-id/guest-id');
    expect(container.textContent).toContain('Guest view');
    expect(getParties).not.toHaveBeenCalled();
  }
);

test('a revoked or expired invitation cannot be joined', async () => {
  window.history.replaceState({}, '', `/join/invite#invite=${invitation}`);
  resolvePartyInvitation.mockRejectedValue({ response: { data: { error: 'Invalid or expired host invitation.' } } });
  await renderApp();
  expect(container.textContent).toContain('Invalid or expired host invitation.');
  expect(container.querySelector('form')).toBeNull();
  expect(sessionStorage.getItem('authToken')).toBeNull();
});

test('sign-out revokes the host session and removes the local member identity', async () => {
  sessionStorage.setItem('authToken', 'token');
  sessionStorage.setItem('memberName', 'Alex');
  sessionStorage.setItem('memberId', 'old-member');
  sessionStorage.setItem('memberRole', 'organizer');
  window.history.replaceState({}, '', '/organizer/party-id/old-member');
  await renderApp();
  await click('Sign out');
  expect(axios.post).toHaveBeenCalledWith('/api/auth/logout', {}, { headers: { Authorization: 'Bearer token' } });
  expect(window.location.pathname).toBe('/');
  expect(container.textContent).toContain('Sign in with a passkey');
  expect(sessionStorage.getItem('memberId')).toBeNull();
  expect(sessionStorage.getItem('memberName')).toBeNull();
  expect(sessionStorage.getItem('memberRole')).toBeNull();
  expect(sessionStorage.getItem('authToken')).toBeNull();
});

test('QR rendering issues one invitation in StrictMode and rotates only after confirmation', async () => {
  createPartyInvitation.mockResolvedValueOnce({ data: { id: 'invite-one', token: invitation, expiresAt: '2099-01-01' } })
    .mockResolvedValueOnce({ data: { id: 'invite-two', token: 'b'.repeat(43), expiresAt: '2099-01-01' } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => root.render(<React.StrictMode><QRCodeModal party={party} /></React.StrictMode>));
  expect(createPartyInvitation).toHaveBeenCalledTimes(1);
  expect(createPartyInvitation).toHaveBeenCalledWith(party.id);
  expect(container.querySelector('.url-text').textContent).toBe(`${window.location.origin}/join/invite#invite=${invitation}`);
  expect(container.textContent).not.toContain(party.join_code);
  await act(async () => Simulate.click(container.querySelector('[aria-label="Copy invitation link"]')));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/join/invite#invite=${invitation}`);
  await click('New QR code');
  expect(createPartyInvitation).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  await click('New QR code');
  expect(createPartyInvitation).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.url-text').textContent).toContain('b'.repeat(43));
  confirm.mockRestore();
});

test.each(['member', 'admin'])('account settings protect the last passkey and restrict approval controls for %s', async (level) => {
  sessionStorage.setItem('authToken', 'token');
  axios.get.mockResolvedValue({ data: { ...session, level, user: { ...session.user, role: level } } });
  getPasskeys.mockResolvedValue({ data: [{ id: 'credential', rp_id: 'localhost', transports: ['internal'], created_at: '2026-10-01' }] });
  getAuthUsers.mockResolvedValue({ data: [{ id: 'pending', name: 'Jordan', role: 'member', status: 'pending' }] });
  window.history.replaceState({}, '', '/account');
  await renderApp();
  expect(container.querySelector('[aria-label="Remove passkey credential"]').disabled).toBe(true);
  const access = container.querySelector('[aria-label="Access for Jordan"]');
  if (level === 'admin') {
    expect(getAuthUsers).toHaveBeenCalledTimes(1);
    expect(access.value).toBe('pending');
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    updateAuthUser.mockResolvedValue({ data: { id: 'pending', name: 'Jordan', role: 'member', status: 'approved' } });
    await act(async () => Simulate.change(access, { target: { value: 'approved' } }));
    expect(updateAuthUser).toHaveBeenCalledWith('pending', { status: 'approved' });
    expect(access.value).toBe('approved');
    confirm.mockRestore();
  } else {
    expect(access).toBeNull();
    expect(getAuthUsers).not.toHaveBeenCalled();
  }
});