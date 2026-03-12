import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createParty } from '../services/api';
import './WelcomePage.css';

export default function WelcomePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // null | 'create'
  const [partyName, setPartyName] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreateParty = async (e) => {
    e.preventDefault();
    if (!partyName.trim() || !organizerName.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await createParty({ name: partyName.trim(), organizer_name: organizerName.trim() });
      const { party, member } = res.data;
      // Store member info in sessionStorage
      sessionStorage.setItem('memberName', member.name);
      sessionStorage.setItem('memberId', member.id);
      sessionStorage.setItem('memberRole', member.role);
      navigate(`/organizer/${party.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create party. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="welcome-container">
      <div className="welcome-hero">
        <div className="welcome-icon">🎤</div>
        <h1 className="welcome-title">Karaoke Party</h1>
        <p className="welcome-subtitle">Sing together, anywhere!</p>
      </div>

      {!mode && (
        <div className="welcome-actions">
          <button className="btn btn-primary btn-large" onClick={() => setMode('create')}>
            🎉 Start a Party
          </button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/join')}>
            🎵 Join a Party
          </button>
          <button className="btn btn-ghost btn-large" onClick={() => navigate('/settings')}>
            ⚙️ Settings
          </button>
        </div>
      )}

      {mode === 'create' && (
        <div className="welcome-form-card">
          <h2>Start a New Party</h2>
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={handleCreateParty}>
            <div className="form-group">
              <label htmlFor="partyName">Party Name</label>
              <input
                id="partyName"
                type="text"
                placeholder="e.g. Friday Night Karaoke"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                autoFocus
                maxLength={100}
              />
            </div>
            <div className="form-group">
              <label htmlFor="organizerName">Your Name</label>
              <input
                id="organizerName"
                type="text"
                placeholder="e.g. Alex"
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                maxLength={60}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMode(null); setError(''); }}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Creating…' : 'Create Party 🎉'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
