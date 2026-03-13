import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getParties, getPartyByCode, joinParty } from '../services/api';
import './JoinPage.css';

export default function JoinPage() {
  const navigate = useNavigate();
  const { joinCode: codeFromUrl } = useParams();

  const [parties, setParties] = useState([]);
  const [loadingParties, setLoadingParties] = useState(true);
  const [selectedParty, setSelectedParty] = useState(null);
  const [joinRole, setJoinRole] = useState('guest');
  const [memberName, setMemberName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [codeInput, setCodeInput] = useState(codeFromUrl || '');

  useEffect(() => {
    fetchParties();
    if (codeFromUrl) {
      handleCodeLookup(codeFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCodeLookup is stable; we only want this effect to run once on mount
  }, []);

  const fetchParties = async () => {
    try {
      const res = await getParties();
      setParties(res.data);
    } catch {
      // ignore
    } finally {
      setLoadingParties(false);
    }
  };

  const handleCodeLookup = async (code) => {
    if (!code.trim()) return;
    try {
      const res = await getPartyByCode(code.trim());
      setSelectedParty(res.data);
      setError('');
    } catch {
      setError('Party not found. Check your code.');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (joinRole !== 'organizer' && !memberName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!selectedParty) {
      setError('Please select a party first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await joinParty(selectedParty.id, { name: memberName.trim(), role: joinRole });
      const member = res.data;
      sessionStorage.setItem('memberName', member.name);
      sessionStorage.setItem('memberId', member.id);
      sessionStorage.setItem('memberRole', member.role);

      if (joinRole === 'organizer') {
        navigate(`/organizer/${selectedParty.id}`);
      } else {
        navigate(`/guest/${selectedParty.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join party.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="join-container">
      <div className="join-header">
        <button className="btn-back" onClick={() => navigate('/')}>← Back</button>
        <h1>🎵 Join a Party</h1>
      </div>

      {!selectedParty ? (
        <div className="join-content">
          {/* Code input */}
          <div className="join-card">
            <h3>Enter Party Code</h3>
            <div className="code-input-row">
              <input
                type="text"
                placeholder="e.g. ABC123"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                maxLength={8}
                className="code-input"
              />
              <button
                className="btn btn-primary"
                onClick={() => handleCodeLookup(codeInput)}
                disabled={!codeInput.trim()}
              >
                Find
              </button>
            </div>
            {error && <p className="error-msg">{error}</p>}
          </div>

          {/* Active parties list */}
          <div className="join-card">
            <h3>Active Parties</h3>
            {loadingParties ? (
              <p className="muted">Loading parties…</p>
            ) : parties.length === 0 ? (
              <p className="muted">No active parties right now.</p>
            ) : (
              <ul className="parties-list">
                {parties.map((party) => (
                  <li
                    key={party.id}
                    className="party-list-item"
                    onClick={() => { setSelectedParty(party); setError(''); }}
                  >
                    <div className="party-info">
                      <span className="party-name">{party.name}</span>
                      <span className="party-code">Code: {party.join_code}</span>
                    </div>
                    <div className="party-join-btns">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedParty(party);
                          setJoinRole('guest');
                          setError('');
                        }}
                      >
                        Guest
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedParty(party);
                          setJoinRole('organizer');
                          setError('');
                        }}
                      >
                        Organizer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="join-content">
          <div className="join-card">
            <div className="selected-party-banner">
              <span>🎉</span>
              <div>
                <strong>{selectedParty.name}</strong>
                <span className="party-code">Code: {selectedParty.join_code}</span>
              </div>
              <button className="btn-icon" onClick={() => setSelectedParty(null)}>✕</button>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleJoin}>
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jordan"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  autoFocus
                  maxLength={60}
                />
              </div>

              <div className="form-group">
                <label>Join as</label>
                <div className="role-tabs">
                  <button
                    type="button"
                    className={`role-tab ${joinRole === 'guest' ? 'active' : ''}`}
                    onClick={() => setJoinRole('guest')}
                  >
                    🎵 Guest
                  </button>
                  <button
                    type="button"
                    className={`role-tab ${joinRole === 'organizer' ? 'active' : ''}`}
                    onClick={() => setJoinRole('organizer')}
                  >
                    🎤 Organizer
                  </button>
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
                {loading ? 'Joining…' : `Join as ${joinRole === 'organizer' ? 'Organizer' : 'Guest'}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
