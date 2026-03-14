import React, { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API_BASE = process.env.REACT_APP_API_URL || '/api';
const SESSION_TOKEN_KEY = 'authToken';
const SESSION_LEVEL_KEY = 'authLevel';

export function AuthProvider({ children }) {
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) || null);
  const [authLevel, setAuthLevel] = useState(() => sessionStorage.getItem(SESSION_LEVEL_KEY) || 'none');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const persistAuth = useCallback((token, level) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_LEVEL_KEY, level);
    setAuthToken(token);
    setAuthLevel(level);
  }, []);

  /**
   * Validate a password against the backend and store the resulting token.
   * Returns true on success, false on failure.
   */
  const login = useCallback(async (password) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_BASE}/auth`, { password });
      persistAuth(res.data.token, res.data.level);
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || 'Invalid password';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [persistAuth]);

  /**
   * Obtain a member-level session token automatically for QR-code access.
   * No password required.
   */
  const loginWithQR = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_BASE}/auth/qr-session`);
      persistAuth(res.data.token, res.data.level);
    } catch (err) {
      setError('Failed to establish QR session');
    } finally {
      setLoading(false);
    }
  }, [persistAuth]);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_LEVEL_KEY);
    setAuthToken(null);
    setAuthLevel('none');
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return (
    <AuthContext.Provider value={{ authToken, authLevel, loading, error, login, loginWithQR, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
