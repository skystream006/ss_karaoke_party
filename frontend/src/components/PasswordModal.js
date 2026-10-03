import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMemberNames } from '../services/api';
import ClearableInput from './ClearableInput';
import './PasswordModal.css';

export default function PasswordModal() {
  const { login, loading, error, clearError, usernameRequired, defaultUsername, saveDefaultUsername } = useAuth();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(defaultUsername);
  const [names, setNames] = useState([]);
  const [loadingNames, setLoadingNames] = useState(false);
  const [namesError, setNamesError] = useState('');

  useEffect(() => {
    if (!usernameRequired) return;
    let cancelled = false;
    setLoadingNames(true);
    setNamesError('');
    getMemberNames()
      .then((res) => {
        if (!cancelled) setNames(res.data);
      })
      .catch(() => {
        if (!cancelled) setNamesError('Could not load usernames. You can still enter a name.');
      })
      .finally(() => {
        if (!cancelled) setLoadingNames(false);
      });
    return () => { cancelled = true; };
  }, [usernameRequired]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (usernameRequired) {
      saveDefaultUsername(username);
      return;
    }
    await login(password);
  };

  const handleChange = (e) => {
    if (usernameRequired) setUsername(e.target.value);
    else setPassword(e.target.value);
    if (error) clearError();
  };

  return (
    <div className="password-modal-overlay">
      <div className="password-modal">
        <div className="password-modal__icon">🎤</div>
        <h1 className="password-modal__title">Karaoke Party</h1>
        <p className="password-modal__subtitle">
          {usernameRequired ? 'Choose your default username' : 'Enter your access password to continue'}
        </p>
        <form className="password-modal__form" onSubmit={handleSubmit}>
          <ClearableInput
            key={usernameRequired ? 'username' : 'password'}
            className={`password-modal__input${error ? ' password-modal__input--error' : ''}`}
            type={usernameRequired ? 'text' : 'password'}
            placeholder={usernameRequired ? 'Username' : 'Password'}
            aria-label={usernameRequired ? 'Default username' : 'Password'}
            value={usernameRequired ? username : password}
            onChange={handleChange}
            list={usernameRequired ? 'default-username-options' : undefined}
            maxLength={usernameRequired ? 60 : undefined}
            required
            autoFocus
            autoComplete="off"
          />
          {usernameRequired && (
            <datalist id="default-username-options">
              {names.map(({ name }) => <option key={name} value={name} />)}
            </datalist>
          )}
          {usernameRequired && loadingNames && <p className="password-modal__subtitle" role="status">Loading usernames...</p>}
          {usernameRequired && namesError && <p className="password-modal__error" role="status">{namesError}</p>}
          {error && <p className="password-modal__error" role="alert">{error}</p>}
          <button
            className="password-modal__btn"
            type="submit"
            disabled={loading || (usernameRequired && !username.trim())}
          >
            {loading ? 'Checking…' : usernameRequired ? 'Continue' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
