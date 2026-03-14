import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import './PasswordGate.css';

const ADMIN_PW = process.env.REACT_APP_ADMIN_PW;
const MEMBER_PW = process.env.REACT_APP_MEMBER_PW;
const SESSION_KEY = 'passwordVerified';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000; // 30 seconds

function isQRCodePath(pathname) {
  // QR codes link to /join/:joinCode (a non-empty join code segment)
  return /^\/join\/[^/]+/.test(pathname);
}

export default function PasswordGate({ children }) {
  const location = useLocation();
  const [verified, setVerified] = useState(
    () => !!sessionStorage.getItem(SESSION_KEY)
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);

  // QR code access bypasses the password gate
  if (isQRCodePath(location.pathname)) {
    return children;
  }

  // Already verified this session
  if (verified) {
    return children;
  }

  // No passwords configured — open access (document in .env.example)
  if (!ADMIN_PW && !MEMBER_PW) {
    return children;
  }

  const now = Date.now();
  const isLocked = lockedUntil !== null && now < lockedUntil;
  const lockSecondsLeft = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLocked) return;

    if (input === ADMIN_PW || input === MEMBER_PW) {
      sessionStorage.setItem(SESSION_KEY, '1');
      setVerified(true);
      setError('');
    } else {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setAttempts(0);
        setError(`Too many failed attempts. Please wait ${LOCKOUT_MS / 1000} seconds.`);
      } else {
        setError(`Incorrect password. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? '' : 's'} remaining.`);
      }
      setInput('');
    }
  };

  return (
    <div className="pg-overlay">
      <div className="pg-notes" aria-hidden="true">
        <span className="pg-note pg-note--1">♪</span>
        <span className="pg-note pg-note--2">♫</span>
        <span className="pg-note pg-note--3">♩</span>
        <span className="pg-note pg-note--4">♬</span>
        <span className="pg-note pg-note--5">♪</span>
      </div>

      <div className="pg-card">
        <div className="pg-icon">🎤</div>
        <h1 className="pg-title">Karaoke Party</h1>
        <p className="pg-subtitle">Enter the password to continue</p>

        <form onSubmit={handleSubmit} className="pg-form">
          {error && <div className="pg-error">{error}</div>}
          {isLocked && (
            <div className="pg-error">
              Too many failed attempts. Please wait {lockSecondsLeft} second{lockSecondsLeft === 1 ? '' : 's'}.
            </div>
          )}
          <div className="pg-field">
            <label htmlFor="pg-password">Password</label>
            <input
              id="pg-password"
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              placeholder="Enter password"
              disabled={isLocked}
            />
          </div>
          <button type="submit" className="pg-btn" disabled={isLocked}>
            Enter 🎉
          </button>
        </form>
      </div>
    </div>
  );
}
