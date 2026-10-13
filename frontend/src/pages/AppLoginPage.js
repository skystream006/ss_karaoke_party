import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Mic2, Smartphone } from 'lucide-react';
import PasskeyModal from '../components/PasskeyModal';

const APP_REDIRECT_URI = 'com.sskaraoke.player:/oauth/callback';
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default function AppLoginPage() {
  const { search, hash } = useLocation();
  const [redirectUrl, setRedirectUrl] = useState('');
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const parameters = new URLSearchParams(search);
  const request = { redirect_uri: parameters.get('redirect_uri'), code_challenge: parameters.get('code_challenge'),
    code_challenge_method: parameters.get('code_challenge_method'), state: parameters.get('state') };
  const valid = !hash && [...parameters].length === 4 && request.redirect_uri === APP_REDIRECT_URI
    && request.code_challenge_method === 'S256' && SECRET_PATTERN.test(request.code_challenge)
    && SECRET_PATTERN.test(request.state);

  useEffect(() => {
    if (!redirectUrl) return;
    try { window.location.assign(redirectUrl); } catch {}
    const expiry = window.setTimeout(() => {
      setRedirectUrl('');
      setError('App sign-in expired. Start sign-in again from ssKaraoke Player.');
    }, 2 * 60 * 1000);
    return () => window.clearTimeout(expiry);
  }, [redirectUrl]);

  const authorized = (result) => {
    try {
      const callback = new URL(result.redirectUrl);
      const code = callback.searchParams.get('code');
      if (!SECRET_PATTERN.test(code)
        || result.redirectUrl !== `${APP_REDIRECT_URI}?code=${code}&state=${request.state}`) {
        throw new Error('Invalid callback');
      }
      setRedirectUrl(result.redirectUrl);
    } catch {
      setError('App sign-in failed. Start sign-in again from ssKaraoke Player.');
    }
  };

  if (valid && !redirectUrl && !error && !cancelled) {
    return <PasskeyModal appLogin={request} onAuthorized={authorized} onCancel={() => setCancelled(true)} />;
  }

  return (
    <main className="passkey-screen">
      <section className="passkey-panel" aria-labelledby="app-login-title">
        <Mic2 className="passkey-brand" size={40} aria-hidden="true" />
        <h1 id="app-login-title">Karaoke Party</h1>
        <h2>ssKaraoke Player</h2>
        {!valid || error ? <p className="error-msg" role="alert">
          {error || 'Invalid app sign-in request. Start sign-in from ssKaraoke Player.'}
        </p> : <p className="passkey-notice" role="status">{cancelled ? 'App sign-in cancelled.' : 'Sign-in ready.'}</p>}
        <div className="passkey-actions">
          {redirectUrl && <a className="btn btn-primary" href={redirectUrl} rel="noreferrer" referrerPolicy="no-referrer">
            <Smartphone size={19} aria-hidden="true" />Return to app
          </a>}
          <Link className="btn btn-ghost" to="/"><ArrowLeft size={18} aria-hidden="true" />Back to Karaoke Party</Link>
        </div>
      </section>
    </main>
  );
}