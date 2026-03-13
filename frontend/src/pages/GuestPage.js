import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, removeFromQueue, reorderQueue, updateQueueItemStatus } from '../services/api';
import Playlist from '../components/Playlist';
import SongSearch from '../components/SongSearch';
import ThemePicker from '../components/ThemePicker';
import './GuestPage.css';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  `${window.location.protocol}//${window.location.hostname}:5000`;

export default function GuestPage() {
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('search');

  const memberName = sessionStorage.getItem('memberName') || 'Guest';
  const memberId = sessionStorage.getItem('memberId');
  const member = { id: memberId, name: memberName };

  const handleRemove = async (itemId) => {
    const previous = queue;
    setQueue((prev) => prev.filter((item) => item.id !== itemId));
    try {
      await removeFromQueue(partyId, itemId);
    } catch {
      setQueue(previous);
      setError('Failed to remove song.');
    }
  };

  const handleSongAdded = useCallback(async () => {
    try {
      const res = await getQueue(partyId);
      setQueue(res.data);
    } catch (err) {
      console.error('Failed to refresh queue after adding song:', err);
      // socket will handle the update if this fails
    }
  }, [partyId]);

  const handlePlay = useCallback(
    async (item) => {
      try {
        await updateQueueItemStatus(partyId, item.id, 'playing');
      } catch {
        setError('Failed to start song.');
      }
    },
    [partyId]
  );

  const handleReorder = async (reordered) => {
    const previous = queue;
    setQueue(reordered);
    try {
      await reorderQueue(partyId, reordered.map((item) => item.id));
    } catch {
      setQueue(previous);
      setError('Failed to reorder queue.');
    }
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ThemePicker />
          <button className="btn-leave" onClick={() => navigate('/')}>Leave</button>
        </div>
      </header>

      {/* Mobile tab switcher */}
      <nav className="mobile-tabs">
        <button
          className={`mobile-tab ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          🔍 Search
        </button>
        <button
          className={`mobile-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          🎵 Queue
          {queue.length > 0 && <span className="badge">{queue.length}</span>}
        </button>
      </nav>

      {/* Content */}
      <main className="guest-main">
        {error && <div className="error-msg">{error}</div>}

        <div className="guest-columns">
          {/* Search section */}
          <div className={`search-section${activeTab !== 'search' ? ' mobile-hidden' : ''}`}>
            <div className="section-heading">Search for songs to add</div>
            <SongSearch
              partyId={partyId}
              member={member}
              onAdded={handleSongAdded}
            />
          </div>

          {/* Queue section */}
          <div className={`queue-section${activeTab !== 'queue' ? ' mobile-hidden' : ''}`}>
            <div className="section-heading">
              🎵 Queue
              {queue.length > 0 && <span className="badge">{queue.length}</span>}
            </div>
            {queue.length === 0 ? (
              <div className="empty-state">
                <span>🎵</span>
                <p>No songs yet!</p>
                <p className="muted">Use the search panel to find and add songs.</p>
              </div>
            ) : (
              <Playlist
                queue={queue}
                onRemove={handleRemove}
                onReorder={handleReorder}
                onPlay={handlePlay}
                isOrganizer={false}
                canReorder={true}
                canRemove={true}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
