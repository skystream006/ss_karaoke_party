import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './PasswordModal.css';

export default function PasswordModal() {
  const { login, loading, error, clearError } = useAuth();
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    await login(password);
  };

  const handleChange = (e) => {
    setPassword(e.target.value);
    if (error) clearError();
  };

  return (
    <div className="password-modal-overlay">
      <div className="password-modal">
        <div className="password-modal__icon">🎤</div>
        <h1 className="password-modal__title">Karaoke Party</h1>
        <p className="password-modal__subtitle">Enter your access password to continue</p>
        <form className="password-modal__form" onSubmit={handleSubmit}>
          <input
            className={`password-modal__input${error ? ' password-modal__input--error' : ''}`}
            type="password"
            placeholder="Password"
            value={password}
            onChange={handleChange}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="password-modal__error">{error}</p>}
          <button
            className="password-modal__btn"
            type="submit"
            disabled={loading || !password}
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
