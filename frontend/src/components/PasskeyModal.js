import React, { useState } from 'react';
import { KeyRound, Mic2, Monitor, UserPlus, ArrowLeft, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ClearableInput from './ClearableInput';
import './PasskeyModal.css';

export default function PasskeyModal({ appLogin, onAuthorized, onCancel }) {
  const { login, loginHost, register, loading, error, notice, clearError } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [hostLogin, setHostLogin] = useState(false);
  const [hostKey, setHostKey] = useState('');
  const [name, setName] = useState('');
  const supported = window.isSecureContext !== false && typeof window.PublicKeyCredential !== 'undefined';

  const submit = async (event) => {
    event.preventDefault();
    if (hostLogin) {
      if (await loginHost(hostKey)) setHostKey('');
      return;
    }
    const appArguments = appLogin ? [appLogin] : [];
    const result = registering ? await register(name.trim(), ...appArguments) : await login(...appArguments);
    if (result === 'pending') setRegistering(false);
    else if (appLogin && result?.redirectUrl) onAuthorized(result);
  };

  return (
    <main className="passkey-screen">
      <section className="passkey-panel" aria-labelledby="passkey-title">
        <Mic2 className="passkey-brand" size={40} aria-hidden="true" />
        <h1 id="passkey-title">Karaoke Party</h1>
        <h2>{hostLogin ? 'Login as HOST' : registering ? 'Create an account' : 'Sign in'}{appLogin ? ' for ssKaraoke Player' : ''}</h2>
        {!supported && !hostLogin && <p className="error-msg" role="alert">Passkeys require a supported browser and the configured HTTPS hostname, or localhost.</p>}
        {notice && <p className="passkey-notice" role="status">{notice}</p>}
        <form onSubmit={submit}>
          {hostLogin && <div className="form-group">
            <label htmlFor="host-login-key">HOST_SCREEN_LOGIN_KEY</label>
            <input id="host-login-key" type="password" value={hostKey} required autoFocus autoComplete="current-password"
              onChange={(event) => { setHostKey(event.target.value); clearError(); }} />
          </div>}
          {registering && <div className="form-group">
            <label htmlFor="passkey-name">Account name</label>
            <ClearableInput id="passkey-name" value={name} autoComplete="username" minLength={2} maxLength={60}
              required autoFocus onChange={(event) => { setName(event.target.value); clearError(); }} />
          </div>}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading || (hostLogin ? !hostKey : !supported || (registering && name.trim().length < 2))}>
            <KeyRound size={19} aria-hidden="true" />
            {hostLogin ? loading ? 'Signing in...' : 'Sign in as HOST' : loading ? 'Waiting for passkey...' : registering ? 'Create passkey' : 'Sign in with a passkey'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={loading}
            onClick={() => { if (hostLogin) { setHostLogin(false); setHostKey(''); } else setRegistering(!registering); clearError(); }}>
            {registering || hostLogin ? <ArrowLeft size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}
            {registering || hostLogin ? 'Back to sign in' : 'Create an account'}
          </button>
          {!appLogin && !registering && !hostLogin && <button type="button" className="btn btn-ghost" disabled={loading}
            onClick={() => { setHostLogin(true); clearError(); }}><Monitor size={18} aria-hidden="true" />Login as HOST</button>}
          {appLogin && <button type="button" className="btn btn-ghost" disabled={loading} onClick={onCancel}>
            <X size={18} aria-hidden="true" />Cancel sign-in
          </button>}
        </form>
      </section>
    </main>
  );
}