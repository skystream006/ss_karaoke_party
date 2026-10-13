import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getParties, joinParty, searchMembers, resolvePartyInvitation } from '../services/api';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

import ClearableInput from '../components/ClearableInput';
import './JoinPage.css';

export default function JoinPage({ switchUserButton }) {
  const navigate = useNavigate();
  const { defaultUsername, authLevel } = useAuth();

  const [parties, setParties] = useState([]);
  const [loadingParties, setLoadingParties] = useState(true);
  const [selectedParty, setSelectedParty] = useState(null);
  const [joinRole, setJoinRole] = useState('organizer');
  const [memberName, setMemberName] = useState(defaultUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameInputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    fetchParties();
  }, []);

  // Close suggestions when clicking outside the name input / dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        nameInputRef.current && !nameInputRef.current.contains(e.target) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear debounce timeout on unmount
  useEffect(() => {
    return () => clearTimeout(searchTimeoutRef.current);
  }, []);

  const handleNameChange = useCallback((value) => {
    setMemberName(value);
    clearTimeout(searchTimeoutRef.current);
    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await searchMembers(value.trim());
          setNameSuggestions(res.data);
          setShowSuggestions(res.data.length > 0);
        } catch {
          setNameSuggestions([]);
          setShowSuggestions(false);
        }
      }, 300);
    } else {
      setNameSuggestions([]);
      setShowSuggestions(false);
    }
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

  const filteredParties = useMemo(() => {
    const query = nameFilter.trim().toLowerCase();
    return query ? parties.filter(p => p.name.toLowerCase().includes(query)) : parties;
  }, [parties, nameFilter]);

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
      const res = await joinParty(selectedParty.id, { name: memberName.trim() || defaultUsername, role: joinRole });
      const member = res.data;
      sessionStorage.setItem('memberName', member.name);
      sessionStorage.setItem('memberId', member.id);
      sessionStorage.setItem('memberRole', member.role);

      if (joinRole === 'organizer') {
        navigate(`/organizer/${selectedParty.id}/${member.id}`);
      } else {
        navigate(`/guest/${selectedParty.id}/${member.id}`);
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
        {switchUserButton}
      </div>

      {!selectedParty ? (
        <div className="join-content">
          {/* Active parties list */}
          <div className="join-card">
            <h3>Active Parties</h3>
            <div className="name-filter-row">
              <ClearableInput
                type="text"
                placeholder="Find party by name…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="code-input"
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            {loadingParties ? (
              <p className="muted">Loading parties…</p>
            ) : filteredParties.length === 0 ? (
              <p className="muted">{nameFilter.trim() ? 'No parties match your search.' : 'No active parties right now.'}</p>
            ) : (
              <ul className="parties-list">
                {filteredParties.map((party) => (
                  <li
                    key={party.id}
                    className="party-list-item"
                    onClick={() => { setSelectedParty(party); setError(''); }}
                  >
                    <div className="party-info">
                      <span className="party-name">{party.name}</span>
                    </div>
                    <div className="party-join-btns">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedParty(party);
                          setJoinRole('organizer');
                          setError('');
                        }}
                      >
                        Join
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
              </div>
              <button className="btn-icon" onClick={() => setSelectedParty(null)}>✕</button>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleJoin}>
              {joinRole !== 'organizer' && <div className="form-group">
                <label>Your Name</label>
                <div className="name-autocomplete-wrapper">
                  <ClearableInput
                    ref={nameInputRef}
                    type="text"
                    placeholder="e.g. Jordan"
                    value={memberName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setShowSuggestions(false)}
                    maxLength={60}
                    autoComplete="off"
                  />
                  {showSuggestions && (
                    <ul className="name-suggestions" ref={suggestionsRef} role="listbox">
                      {nameSuggestions.slice().sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })).map((suggestion) => (
                        <li
                          key={suggestion.id}
                          role="option"
                          aria-selected={false}
                          className="name-suggestion-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setMemberName(suggestion.name);
                            setShowSuggestions(false);
                          }}
                        >
                          <span className="suggestion-name">{suggestion.name}</span>
                          <span className="suggestion-meta">
                            <span className="suggestion-party">{suggestion.party_name}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>}

              <div className="form-group">
                <label>Join as</label>
                <div className="role-tabs">
                  {authLevel !== 'hostscreen' && <button
                    type="button"
                    className={`role-tab ${joinRole === 'guest' ? 'active' : ''}`}
                    onClick={() => setJoinRole('guest')}
                  >
                    🎵 Guest
                  </button>}
                  <button
                    type="button"
                    className={`role-tab ${joinRole === 'organizer' ? 'active' : ''}`}
                    onClick={() => setJoinRole('organizer')}
                  >
                    🎤 Organizer
                  </button>
                </div>
              </div>

              <button type="submit" className="btn btn-join btn-large" disabled={loading}>
                {loading ? 'Joining…' : `Join as ${joinRole === 'organizer' ? 'Organizer' : 'Guest'}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function InvitationJoinPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();
  const invitation = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  const [details, setDetails] = useState(null);
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setDetails(null);
    setError('');
    if (!/^[A-Za-z0-9_-]{43}$/.test(invitation)) {
      setError('This join link is no longer valid. Scan a current host QR code.');
      setChecking(false);
      return;
    }
    setChecking(true);
    resolvePartyInvitation(invitation)
      .then(({ data }) => { if (active) setDetails(data); })
      .catch((failure) => { if (active) setError(failure.response?.data?.error || 'Unable to check invitation.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [invitation]);

  const join = async (event) => {
    event.preventDefault();
    if (!details || !name.trim()) return;
    setJoining(true);
    setError('');
    try {
      const { data } = await joinParty(details.party.id, { name: name.trim(), invitation });
      acceptInvitation(data);
      sessionStorage.setItem('memberName', data.member.name);
      sessionStorage.setItem('memberId', data.member.id);
      sessionStorage.setItem('memberRole', 'guest');
      navigate(`/guest/${data.partyId}/${data.memberId}`, { replace: true });
    } catch (failure) {
      setError(failure.response?.data?.error || 'Unable to join. Ask your host for a new QR code.');
    } finally {
      setJoining(false);
    }
  };

  return <main className="passkey-screen">
    <section className="passkey-panel" aria-labelledby="invitation-title">
      <h1 id="invitation-title">{details?.party.name || 'Party invitation'}</h1>
      {checking && <p role="status">Checking invitation...</p>}
      {error && <p className="error-msg" role="alert">{error}</p>}
      {details && <>
        <h2>Host: {details.host}</h2>
        <form onSubmit={join}>
          <div className="form-group">
            <label htmlFor="guest-name">Your name</label>
            <ClearableInput id="guest-name" value={name} maxLength={60} required autoComplete="nickname"
              onChange={(event) => setName(event.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={joining || !name.trim()}>{joining ? 'Joining...' : 'Join party'}</button>
        </form>
      </>}
      <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}><ArrowLeft size={18} aria-hidden="true" /> Back</button>
    </section>
  </main>;
}
