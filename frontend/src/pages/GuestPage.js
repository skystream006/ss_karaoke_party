import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue } from '../services/api';
import Playlist from '../components/Playlist';
import SongSearch from '../components/SongSearch';
import './GuestPage.css';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : window.location.origin);

export default function GuestPage() {
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [queue, setQueue] = useState([]);
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' | 'search'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const memberName = sessionStorage.getItem('memberName') || 'Guest';
  const memberId = sessionStorage.getItem('memberId');
  const member = { id: memberId, name: memberName };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [partyRes, queueRes] = await Promise.all([
          getParty(partyId),
          getQueue(partyId),
        ]);
        setParty(partyRes.data);
        setQueue(queueRes.data);
      } catch {
        setError('Failed to load party. It may have ended.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [partyId]);

  // Socket for real-time updates
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('join:party', partyId);
    });
    socket.on('queue:update', ({ queue: updatedQueue }) => {
      if (updatedQueue) {
        setQueue(updatedQueue);
      }
    });
    return () => {
      socket.emit('leave:party', partyId);
      socket.disconnect();
    };
  }, [partyId]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading party…</p>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="error-screen">
        <p>{error || 'Party not found.'}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return (
    <div className="guest-layout">
      {/* Header */}
      <header className="guest-header">
        <div className="guest-header-info">
          <span className="party-badge">🎉 {party.name}</span>
          <span className="member-badge">👤 {memberName}</span>
        </div>
        <button className="btn-leave" onClick={() => navigate('/')}>Leave</button>
      </header>

      {/* Tab bar */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          🎵 Queue
          {queue.length > 0 && <span className="badge">{queue.length}</span>}
        </button>
        <button
          className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          🔍 Search Songs
        </button>
      </div>

      {/* Content */}
      <main className="guest-main">
        {error && <div className="error-msg">{error}</div>}

        {activeTab === 'queue' && (
          <div className="queue-section">
            {queue.length === 0 ? (
              <div className="empty-state">
                <span>🎵</span>
                <p>No songs yet!</p>
                <p className="muted">Search for songs to add to the queue.</p>
                <button className="btn btn-primary" onClick={() => setActiveTab('search')}>
                  Search Songs
                </button>
              </div>
            ) : (
              <>
                <div className="section-heading">
                  {queue.length} song{queue.length !== 1 ? 's' : ''} in queue
                </div>
                <Playlist
                  queue={queue}
                  onRemove={() => {}}
                  onReorder={() => {}}
                  isOrganizer={false}
                />
              </>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="search-section">
            <div className="section-heading">Search for songs to add</div>
            <SongSearch
              partyId={partyId}
              member={member}
              onAdded={() => setActiveTab('queue')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
