import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Plus, RefreshCw, Settings, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getPasskeys, removePasskey, getAuthUsers, updateAuthUser } from '../services/api';
import './AccountPage.css';

export default function AccountPage({ switchUserButton }) {
  const navigate = useNavigate();
  const { user, authLevel, addPasskey, loading: authenticating } = useAuth();
  const [passkeys, setPasskeys] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = authLevel === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [keys, accounts] = await Promise.all([getPasskeys(), isAdmin ? getAuthUsers() : Promise.resolve({ data: [] })]);
      setPasskeys(keys.data);
      setUsers(accounts.data);
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to load account settings.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (await addPasskey()) await load();
  };

  const remove = async (credential) => {
    if (!window.confirm('Remove this passkey from your account?')) return;
    setBusy(true);
    setError('');
    try {
      await removePasskey(credential.id);
      setPasskeys((current) => current.filter((entry) => entry.id !== credential.id));
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to remove passkey.');
    } finally {
      setBusy(false);
    }
  };

  const update = async (account, changes) => {
    if (!window.confirm(`Change access for ${account.name}? Their sessions and host invitations will be revoked.`)) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await updateAuthUser(account.id, changes);
      setUsers((current) => current.map((entry) => entry.id === data.id ? data : entry));
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to update account access.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || loading || authenticating;
  const date = (value) => value ? new Date(value).toLocaleString() : 'Never';

  return <main className="account-page">
    <header className="account-header">
      <button className="btn btn-ghost" onClick={() => navigate('/')}><ArrowLeft size={18} aria-hidden="true" /> Back</button>
      <h1>{user?.name || 'Account'}</h1>
      <div className="account-actions">
        {isAdmin && <button className="btn btn-ghost" onClick={() => navigate('/settings')}><Settings size={18} aria-hidden="true" /> Parties</button>}
        {switchUserButton}
      </div>
    </header>
    {error && <p className="error-msg" role="alert">{error}</p>}
    {loading && <p role="status">Loading accounts...</p>}
    <section className="account-section" aria-labelledby="passkeys-heading">
      <div className="account-section-heading">
        <h2 id="passkeys-heading"><KeyRound size={20} aria-hidden="true" /> Passkeys</h2>
        <div className="account-actions">
          <button className="btn btn-primary" onClick={add} disabled={disabled}><Plus size={18} aria-hidden="true" /> Add passkey</button>
          <button className="account-icon-button" onClick={load} disabled={disabled} title="Refresh account settings" aria-label="Refresh account settings">
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {!loading && passkeys.length === 0 && <p className="muted">No passkeys found.</p>}
      <ul className="account-key-list">
        {passkeys.map((credential) => <li key={credential.id}>
          <div className="account-key-identity">
            <strong>{credential.rp_id}</strong>
            <code title={credential.id}>{credential.id.slice(0, 18)}</code>
            <span>{credential.transports.join(', ') || 'Authenticator'}</span>
          </div>
          <dl className="account-key-dates">
            <div><dt>Created</dt><dd>{date(credential.created_at)}</dd></div>
            <div><dt>Last used</dt><dd>{date(credential.last_used_at)}</dd></div>
          </dl>
          <button className="account-icon-button" onClick={() => remove(credential)} disabled={disabled || passkeys.length < 2}
            title={passkeys.length < 2 ? 'Keep at least one passkey' : 'Remove passkey'} aria-label={`Remove passkey ${credential.id}`}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
    </section>
    {isAdmin && <section className="account-section" aria-labelledby="accounts-heading">
      <div className="account-section-heading"><h2 id="accounts-heading"><Users size={20} aria-hidden="true" /> Accounts</h2></div>
      <div className="account-user-list">
        {users.map((account) => <div key={account.id} className="account-user-row">
          <strong>{account.name}</strong>
          <label>Role
            <select aria-label={`Role for ${account.name}`} value={account.role} disabled={disabled || account.id === user?.id}
              onChange={(event) => update(account, { role: event.target.value })}>
              <option value="member">Host</option><option value="admin">Admin</option>
            </select>
          </label>
          <label>Access
            <select aria-label={`Access for ${account.name}`} value={account.status} disabled={disabled || account.id === user?.id}
              onChange={(event) => update(account, { status: event.target.value })}>
              <option value="pending">Pending approval</option><option value="approved">Approved</option><option value="revoked">Revoked</option>
            </select>
          </label>
        </div>)}
      </div>
    </section>}
  </main>;
}