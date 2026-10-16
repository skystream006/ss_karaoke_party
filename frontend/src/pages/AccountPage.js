import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Settings, ShieldAlert, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAccountInfo, getHostLoginAttempts, clearHostLoginAttempts, getPasskeys, removePasskey, getAuthUsers, updateAuthUser } from '../services/api';
import './AccountPage.css';

function HostLoginAttempts() {
  const [attempts, setAttempts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (before = null) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const { data } = await getHostLoginAttempts(before);
      setAttempts((current) => before ? [...current, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
      setStatus({ recordCount: data.recordCount, failedCount: data.failedCount,
        recordLimit: data.recordLimit, loginDisabled: data.loginDisabled });
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to load HOST login attempts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clear = async () => {
    if (!window.confirm('Permanently clear all HOST login records and remove the failure-limit lockout? This cannot be undone.')) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await clearHostLoginAttempts();
      setAttempts([]);
      setNextCursor(null);
      setStatus(null);
      await load();
      setNotice('Login records cleared.');
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to clear HOST login records.');
    } finally {
      setLoading(false);
    }
  };

  return <section className="account-section" aria-labelledby="host-login-attempts-heading" aria-busy={loading}>
    <div className="account-section-heading">
      <h2 id="host-login-attempts-heading"><ShieldAlert size={20} aria-hidden="true" /> HOST login attempts</h2>
      <div className="account-actions">
        <button className="account-icon-button" onClick={clear} disabled={loading || !status?.recordCount}
          title="Clear HOST login records" aria-label="Clear HOST login records"><Trash2 size={18} aria-hidden="true" /></button>
        <button className="account-icon-button" onClick={() => load()} disabled={loading}
          title="Refresh HOST login attempts" aria-label="Refresh HOST login attempts"><RefreshCw size={18} aria-hidden="true" /></button>
      </div>
    </div>
    {status && <p className="muted">{status.failedCount?.toLocaleString()} / {status.recordLimit?.toLocaleString()} failed attempts
      {' '}({status.recordCount?.toLocaleString()} total records)</p>}
    {status?.loginDisabled && <p className="error-msg" role="alert">HOST login is disabled until these records are cleared.</p>}
    {error && <p className="error-msg" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading login attempts...</p>}
    {!loading && !error && attempts.length === 0 && <p className="muted">No HOST login attempts recorded.</p>}
    {attempts.length > 0 && <table className="account-login-attempts" aria-label="HOST login attempts">
      <thead><tr><th scope="col">Time</th><th scope="col">IP address</th><th scope="col">Result</th></tr></thead>
      <tbody>{attempts.map((attempt) => <tr key={attempt.id}>
        <td><time dateTime={attempt.occurred_at}>{new Date(attempt.occurred_at).toLocaleString()}</time></td>
        <td><code>{attempt.ip_address || 'Unknown'}</code></td>
        <td>{attempt.outcome === 'success' ? 'Successful' : attempt.outcome === 'rate_limited' ? 'Retry limit reached' : 'Invalid key'}</td>
      </tr>)}</tbody>
    </table>}
    {nextCursor && <div className="account-actions account-login-pagination">
      <button className="btn btn-ghost" onClick={() => load(nextCursor)} disabled={loading}>
        <ChevronDown size={18} aria-hidden="true" /> Load more
      </button>
    </div>}
  </section>;
}

export default function AccountPage({ switchUserButton }) {
  const navigate = useNavigate();
  const { user, authLevel, addPasskey, loading: authenticating } = useAuth();
  const [passkeys, setPasskeys] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const isAdmin = authLevel === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setKeyVisible(false);
    setCopied(false);
    setHostKey(null);
    try {
      const [keys, accounts, info] = await Promise.all([getPasskeys(), isAdmin ? getAuthUsers() : Promise.resolve({ data: [] }), getAccountInfo()]);
      setPasskeys(keys.data);
      setUsers(accounts.data);
      setHostKey(info.data.HOST_SCREEN_LOGIN_KEY);
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
  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(hostKey);
      setCopied(true);
    } catch {
      setError('Unable to copy the HOST key.');
    }
  };
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
    <section className="account-section" aria-labelledby="account-info-heading">
      <div className="account-section-heading"><h2 id="account-info-heading">Account Info</h2></div>
      <dl className="account-info-details">
        <div><dt>Account</dt><dd>{user?.name}</dd></div>
        <div><dt>Role</dt><dd>{authLevel === 'admin' ? 'Admin' : 'Member'}</dd></div>
      </dl>
      <label className="account-host-key-label" htmlFor="account-host-key">HOST_SCREEN_LOGIN_KEY</label>
      {hostKey ? <div className="account-host-key">
        <input id="account-host-key" type={keyVisible ? 'text' : 'password'} value={hostKey} readOnly autoComplete="off" />
        <button className="account-icon-button" onClick={() => setKeyVisible(!keyVisible)}
          title={keyVisible ? 'Hide HOST key' : 'Show HOST key'} aria-label={keyVisible ? 'Hide HOST key' : 'Show HOST key'}>
          {keyVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
        <button className="account-icon-button" onClick={copyKey} title="Copy HOST key" aria-label="Copy HOST key">
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        </button>
      </div> : !loading && <p className="muted">HOST login is not configured.</p>}
      {copied && <p role="status">Key copied.</p>}
    </section>
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
    {isAdmin && <HostLoginAttempts />}
    {isAdmin && <section className="account-section" aria-labelledby="accounts-heading">
      <div className="account-section-heading"><h2 id="accounts-heading"><Users size={20} aria-hidden="true" /> Accounts</h2></div>
      <div className="account-user-list">
        {users.map((account) => <div key={account.id} className="account-user-row">
          <strong>{account.name}</strong>
          <label>Role
            <select aria-label={`Role for ${account.name}`} value={account.role} disabled={disabled || account.id === user?.id || account.role === 'hostscreen'}
              onChange={(event) => update(account, { role: event.target.value })}>
              <option value="member">Host</option><option value="admin">Admin</option>
              {account.role === 'hostscreen' && <option value="hostscreen">HOSTSCREEN</option>}
            </select>
          </label>
          <label>Access
            <select aria-label={`Access for ${account.name}`} value={account.status} disabled={disabled || account.id === user?.id || account.role === 'hostscreen'}
              onChange={(event) => update(account, { status: event.target.value })}>
              <option value="pending">Pending approval</option><option value="approved">Approved</option><option value="revoked">Revoked</option>
            </select>
          </label>
        </div>)}
      </div>
    </section>}
  </main>;
}