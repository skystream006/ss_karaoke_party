import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import axios from 'axios';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { AuthProvider, useAuth } from './AuthContext';
import api from '../services/api';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn(),
  create: jest.fn(() => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } })) }));
jest.mock('@simplewebauthn/browser', () => ({ startAuthentication: jest.fn(), startRegistration: jest.fn() }));

const rejectApiResponse = api.interceptors.response.use.mock.calls[0][1];

let root;
let auth;

function Consumer() {
  auth = useAuth();
  return null;
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  jest.clearAllMocks();
  root = createRoot(document.createElement('div'));
  act(() => root.render(<AuthProvider><Consumer /></AuthProvider>));
});

afterEach(() => act(() => root.unmount()));

test('sign-in verifies a passkey and reload validates the stored session with the server', async () => {
  const session = { token: 'token', level: 'member', user: { id: 'account', name: 'Alex', role: 'member' } };
  const options = { challenge: 'challenge' };
  startAuthentication.mockResolvedValue({ id: 'credential' });
  axios.post.mockResolvedValueOnce({ data: { requestId: 'request', options } }).mockResolvedValueOnce({ data: session });
  await act(async () => { expect(await auth.login()).toBe(true); });
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
  expect(axios.post).toHaveBeenLastCalledWith('/api/auth/login/verify', { requestId: 'request', response: { id: 'credential' } }, { headers: {} });
  expect(auth.authLevel).toBe('member');
  expect(auth.defaultUsername).toBe('Alex');
  axios.get.mockResolvedValue({ data: session });
  await act(async () => root.render(<AuthProvider key="reload"><Consumer /></AuthProvider>));
  expect(axios.get).toHaveBeenCalledWith('/api/auth/me', { headers: { Authorization: 'Bearer token' } });
  expect(auth.user.id).toBe('account');
});

test('pending registration stores no login token and displays its approval status', async () => {
  startRegistration.mockResolvedValue({ id: 'credential' });
  axios.post.mockResolvedValueOnce({ data: { requestId: 'request', options: {} } })
    .mockResolvedValueOnce({ data: { pending: true, message: 'Awaiting approval.' } });
  await act(async () => { expect(await auth.register('Alex')).toBe('pending'); });
  expect(auth.authLevel).toBe('none');
  expect(sessionStorage.getItem('authToken')).toBeNull();
  expect(auth.notice).toBe('Awaiting approval.');
});

test('a verified QR join retains guest party and member scope and sign-out revokes the server session', async () => {
  act(() => auth.acceptInvitation({ token: 'guest-token', level: 'guest', partyId: 'party', memberId: 'guest' }));
  expect(auth.authLevel).toBe('guest');
  expect(auth.partyId).toBe('party');
  expect(auth.memberId).toBe('guest');
  axios.post.mockResolvedValue({});
  await act(async () => { expect(await auth.logout()).toBe(true); });
  expect(axios.post).toHaveBeenCalledWith('/api/auth/logout', {}, { headers: { Authorization: 'Bearer guest-token' } });
  expect(sessionStorage.getItem('authToken')).toBeNull();
  expect(auth.authLevel).toBe('none');
});

test('failed passkey login does not store a session', async () => {
  axios.post.mockRejectedValue({ response: { data: { error: 'Account is pending approval.' } } });
  await act(async () => { expect(await auth.login()).toBe(false); });
  expect(auth.authLevel).toBe('none');
  expect(auth.error).toBe('Account is pending approval.');
});

test('failed restoration never trusts a locally forged admin role', async () => {
  sessionStorage.setItem('authToken', 'old-token');
  sessionStorage.setItem('authLevel', 'admin');
  axios.get.mockRejectedValue({ response: { status: 401 } });
  await act(async () => root.render(<AuthProvider key="reload"><Consumer /></AuthProvider>));
  expect(auth.authLevel).toBe('none');
  expect(sessionStorage.getItem('authToken')).toBeNull();
  expect(auth.initializing).toBe(false);
});

test('a failed sign-out does not claim the host session was revoked', async () => {
  act(() => auth.acceptInvitation({ token: 'guest-token', level: 'guest', partyId: 'party', memberId: 'guest' }));
  axios.post.mockRejectedValue(new Error('Network unavailable'));
  await act(async () => { expect(await auth.logout()).toBe(false); });
  expect(auth.authToken).toBe('guest-token');
  expect(auth.error).toMatch(/Sign-out failed/);
});

test.each(['resolve', 'reject'])('late session restoration cannot %s over a newly redeemed invitation', async (outcome) => {
  let resolve;
  let reject;
  sessionStorage.setItem('authToken', 'old-account-token');
  axios.get.mockImplementationOnce(() => new Promise((accept, decline) => { resolve = accept; reject = decline; }));
  await act(async () => root.render(<AuthProvider key="reload"><Consumer /></AuthProvider>));
  act(() => auth.acceptInvitation({ token: 'new-guest-token', level: 'guest', partyId: 'party', memberId: 'guest' }));
  await act(async () => {
    if (outcome === 'resolve') resolve({ data: { level: 'admin', user: { id: 'old-account', name: 'Host' } } });
    else reject({ response: { status: 401 } });
  });
  expect(auth.authToken).toBe('new-guest-token');
  expect(auth.authLevel).toBe('guest');
  expect(auth.initializing).toBe(false);
});

test('only a 401 for the current token clears the active session', async () => {
  act(() => auth.acceptInvitation({ token: 'new-token', level: 'guest', partyId: 'party', memberId: 'guest' }));
  const stale = { response: { status: 401 }, config: { headers: { Authorization: 'Bearer old-token' } } };
  await act(async () => { await expect(rejectApiResponse(stale)).rejects.toBe(stale); });
  expect(auth.authToken).toBe('new-token');
  const current = { response: { status: 401 }, config: { headers: { Authorization: 'Bearer new-token' } } };
  await act(async () => { await expect(rejectApiResponse(current)).rejects.toBe(current); });
  expect(auth.authToken).toBeNull();
  expect(auth.authLevel).toBe('none');
});