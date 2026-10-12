import React, { useState } from 'react';
import { KeyRound, Mic2, UserPlus, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ClearableInput from './ClearableInput';
import './PasskeyModal.css';

export default function PasskeyModal() {
  const { login, register, loading, error, notice, clearError } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const supported = window.isSecureContext !== false && typeof window.PublicKeyCredential !== 'undefined';

  const submit = async (event) => {
    event.preventDefault();
    if (registering) {
      const result = await register(name.trim());
      if (result === 'pending') setRegistering(false);
    } else {
      await login();
    }
  };

  return (
    <main className="passkey-screen">
      <section className="passkey-panel" aria-labelledby="passkey-title">
        <Mic2 className="passkey-brand" size={40} aria-hidden="true" />
        <h1 id="passkey-title">Karaoke Party</h1>
        <h2>{registering ? 'Create an account' : 'Sign in'}</h2>
        {!supported && <p className="error-msg" role="alert">Passkeys require a supported browser and the configured HTTPS hostname, or localhost.</p>}
        {notice && <p className="passkey-notice" role="status">{notice}</p>}
        <form onSubmit={submit}>
          {registering && <div className="form-group">
            <label htmlFor="passkey-name">Account name</label>
            <ClearableInput id="passkey-name" value={name} autoComplete="username" minLength={2} maxLength={60}
              required autoFocus onChange={(event) => { setName(event.target.value); clearError(); }} />
          </div>}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading || !supported || (registering && name.trim().length < 2)}>
            <KeyRound size={19} aria-hidden="true" />
            {loading ? 'Waiting for passkey...' : registering ? 'Create passkey' : 'Sign in with a passkey'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={loading}
            onClick={() => { setRegistering(!registering); clearError(); }}>
            {registering ? <ArrowLeft size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}
            {registering ? 'Back to sign in' : 'Create an account'}
          </button>
        </form>
      </section>
    </main>
  );
}