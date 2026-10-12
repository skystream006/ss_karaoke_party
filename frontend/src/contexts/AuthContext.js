import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

const AuthContext = createContext(null);

const API_BASE = process.env.REACT_APP_API_URL || '/api';
const SESSION_TOKEN_KEY = 'authToken';
const SESSION_LEVEL_KEY = 'authLevel';
const DEFAULT_USERNAME_KEY = 'defaultUsername';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(() => Boolean(sessionStorage.getItem(SESSION_TOKEN_KEY)));
  const [defaultUsername, setDefaultUsername] = useState(() => localStorage.getItem(DEFAULT_USERNAME_KEY) || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const clearSession = useCallback(() => {
    for (const key of [SESSION_TOKEN_KEY, SESSION_LEVEL_KEY, 'usernameRequired', 'memberName', 'memberId', 'memberRole']) {
      sessionStorage.removeItem(key);
    }
    setSession(null);
  }, []);

  const persistSession = useCallback((value) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, value.token);
    sessionStorage.setItem(SESSION_LEVEL_KEY, value.level);
    setSession(value);
    if (value.user?.name) {
      localStorage.setItem(DEFAULT_USERNAME_KEY, value.user.name);
      setDefaultUsername(value.user.name);
    }
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (!token) return;
    let active = true;
    const current = () => active && sessionStorage.getItem(SESSION_TOKEN_KEY) === token;
    axios.get(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => { if (current()) persistSession({ ...data, token }); })
      .catch(() => { if (current()) clearSession(); })
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [clearSession, persistSession]);

  useEffect(() => {
    const expired = () => { clearSession(); setError('Your session ended. Sign in or scan a current host invitation.'); };
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, [clearSession]);

  const ceremony = useCallback(async (kind, name) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const headers = kind === 'passkeys' ? { Authorization: `Bearer ${session?.token}` } : {};
      const { data } = await axios.post(`${API_BASE}/auth/${kind}/options`, name ? { name } : {}, { headers });
      const response = kind === 'login'
        ? await startAuthentication({ optionsJSON: data.options })
        : await startRegistration({ optionsJSON: data.options });
      const result = await axios.post(`${API_BASE}/auth/${kind}/verify`, { requestId: data.requestId, response }, { headers });
      if (result.data.token) persistSession(result.data);
      if (result.data.pending) {
        setNotice(result.data.message);
        return 'pending';
      }
      return true;
    } catch (err) {
      setError(err.response?.data?.error || (err.name === 'NotAllowedError'
        ? 'Passkey request was cancelled or timed out.' : 'Passkey request failed. Use the configured HTTPS hostname or localhost.'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [persistSession, session?.token]);

  const login = useCallback(() => ceremony('login'), [ceremony]);
  const register = useCallback((name) => ceremony('register', name), [ceremony]);
  const addPasskey = useCallback(() => ceremony('passkeys'), [ceremony]);

  const acceptInvitation = useCallback((result) => {
    if (!result.token || result.level !== 'guest' || !result.partyId || !result.memberId) {
      throw new Error('Invalid party session.');
    }
    setError('');
    setNotice('');
    setInitializing(false);
    persistSession(result);
  }, [persistSession]);

  const logout = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (session?.token) await axios.post(`${API_BASE}/auth/logout`, {}, { headers: { Authorization: `Bearer ${session.token}` } });
    } catch (err) {
      if (err.response?.status !== 401) {
        setError('Sign-out failed. Retry to revoke this session and its invitations.');
        return false;
      }
    } finally {
      setLoading(false);
    }
    clearSession();
    setNotice('');
    return true;
  }, [clearSession, session?.token]);

  const clearError = useCallback(() => setError(''), []);

  return (
    <AuthContext.Provider value={{ authToken: session?.token || null, authLevel: session?.level || 'none',
      user: session?.user, partyId: session?.partyId, memberId: session?.memberId,
      defaultUsername, initializing, loading, error, notice, login, register, addPasskey, acceptInvitation, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
