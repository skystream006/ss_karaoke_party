import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import axios from 'axios';
import { AuthProvider, useAuth } from './AuthContext';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

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

test('password login requires a username, including after a reload', async () => {
  axios.post.mockResolvedValue({ data: { token: 'token', level: 'member' } });
  await act(async () => { await auth.login('password'); });
  expect(auth.usernameRequired).toBe(true);
  expect(sessionStorage.getItem('usernameRequired')).toBe('true');
  act(() => root.render(<AuthProvider key="reload"><Consumer /></AuthProvider>));
  expect(auth.usernameRequired).toBe(true);
  act(() => { auth.saveDefaultUsername('  Alex  '); });
  expect(auth.defaultUsername).toBe('Alex');
  expect(auth.usernameRequired).toBe(false);
  expect(localStorage.getItem('defaultUsername')).toBe('Alex');
  expect(sessionStorage.getItem('usernameRequired')).toBeNull();
});

test('rejects blank and oversized names without completing username selection', async () => {
  axios.post.mockResolvedValue({ data: { token: 'token', level: 'admin' } });
  await act(async () => { await auth.login('password'); });
  for (const name of ['   ', 'a'.repeat(61)]) {
    act(() => { expect(auth.saveDefaultUsername(name)).toBe(false); });
    expect(auth.usernameRequired).toBe(true);
    expect(localStorage.getItem('defaultUsername')).toBeNull();
  }
});

test('remembers the preference but asks again on the next password login', async () => {
  act(() => { auth.saveDefaultUsername('Alex'); });
  act(() => auth.logout());
  expect(localStorage.getItem('defaultUsername')).toBe('Alex');
  axios.post.mockResolvedValue({ data: { token: 'next-token', level: 'member' } });
  await act(async () => { await auth.login('password'); });
  expect(auth.defaultUsername).toBe('Alex');
  expect(auth.usernameRequired).toBe(true);
});

test('failed password login does not request a username', async () => {
  axios.post.mockRejectedValue({ response: { data: { error: 'Invalid password' } } });
  await act(async () => { expect(await auth.login('wrong')).toBe(false); });
  expect(auth.authLevel).toBe('none');
  expect(auth.usernameRequired).toBe(false);
});

test('QR login does not require username selection', async () => {
  axios.get.mockResolvedValue({ data: { token: 'qr-token', level: 'member' } });
  await act(async () => { await auth.loginWithQR(); });
  expect(auth.authLevel).toBe('member');
  expect(auth.usernameRequired).toBe(false);
});