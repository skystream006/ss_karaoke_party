import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getParties, getPartyByCode, joinParty, searchMembers, getPartyMembers } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

import ClearableInput from '../components/ClearableInput';
import './JoinPage.css';

export default function JoinPage() {
  const navigate = useNavigate();
  const { joinCode: codeFromUrl } = useParams();
  const { defaultUsername } = useAuth();

  const [parties, setParties] = useState([]);
  const [loadingParties, setLoadingParties] = useState(true);
  const [selectedParty, setSelectedParty] = useState(null);
  const [joinRole, setJoinRole] = useState('guest');
  const [memberName, setMemberName] = useState(defaultUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameFilter, setNameFilter] = useState(codeFromUrl || '');
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [partyMembers, setPartyMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const nameInputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    fetchParties();
    if (codeFromUrl) {
      handleCodeLookup(codeFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCodeLookup is stable; we only want this effect to run once on mount
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

  useEffect(() => {
    if (!selectedParty) {
      setPartyMembers([]);
      setMembersError(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingMembers(true);
      setMembersError(false);
      try {
        const res = await getPartyMembers(selectedParty.id);
        if (!cancelled) setPartyMembers(res.data);
      } catch {
        if (!cancelled) {
          setPartyMembers([]);
          setMembersError(true);
        }
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedParty]);

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

  const handleMemberJoin = async (member) => {
    if (!selectedParty) {
      setError('Please select a party first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await joinParty(selectedParty.id, { name: member.name, role: member.role });
      const joined = res.data;
      sessionStorage.setItem('memberName', joined.name);
      sessionStorage.setItem('memberId', joined.id);
      sessionStorage.setItem('memberRole', joined.role);

      if (joined.role === 'organizer') {
        navigate(`/organizer/${selectedParty.id}/${joined.id}`);
      } else {
        navigate(`/guest/${selectedParty.id}/${joined.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join party.');
    } finally {
      setLoading(false);
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
      const res = await joinParty(selectedParty.id, { name: memberName.trim(), role: joinRole });
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
                <span className="party-code">Code: {selectedParty.join_code}</span>
              </div>
              <button className="btn-icon" onClick={() => setSelectedParty(null)}>✕</button>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="party-members-section">
              <h3>Current Members</h3>
              {loadingMembers ? (
                <p className="muted">Loading members…</p>
              ) : membersError ? (
                <p className="muted">Could not load members.</p>
              ) : partyMembers.length === 0 ? (
                <p className="muted">No members yet — be the first!</p>
              ) : (
                <ul className="party-members-list">
                  {partyMembers.map((m) => (
                    <li key={m.id} className="party-member-item">
                      <div className="member-info">
                        <span className="member-name">{m.name}</span>
                        <span className="member-role">{m.role === 'organizer' ? '👑' : '🎤'}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={loading}
                        onClick={() => handleMemberJoin(m)}
                      >
                        Join
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
                      {nameSuggestions.map((suggestion) => (
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
