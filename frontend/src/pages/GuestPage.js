import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getParty, getQueue, removeFromQueue, reorderQueue, updateQueueItemStatus } from '../services/api';
import Playlist from '../components/Playlist';
import SongSearch from '../components/SongSearch';
import CustomizationPanel from '../components/CustomizationPanel';
import ThemePicker from '../components/ThemePicker';
import './GuestPage.css';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : window.location.origin.replace(':3000', ':5000'));

export default function GuestPage() {
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ currentTime: 0, duration: 0 });
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [settings, setSettings] = useState({ key: 0, tempo: 1.0, vocalLevel: 100 });

  const socketRef = useRef(null);

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

  const handlePause = useCallback(
    async (item) => {
      try {
        await updateQueueItemStatus(partyId, item.id, 'paused');
      } catch {
        setError('Failed to pause song.');
      }
    },
    [partyId]
  );

  const handleReorder = async (reordered) => {
    const previous = queue;
    setQueue(reordered);
    try {
      await reorderQueue(partyId, reordered.map((item) => ({ id: item.id, position: item.position })));
    } catch {
      setQueue(previous);
      setError('Failed to reorder queue.');
    }
  };

  // Reset video progress when the active song changes (playing or paused)
  const activeVideoId = queue.find((i) => i.status === 'playing' || i.status === 'paused')?.video_id;
  useEffect(() => {
    setVideoProgress({ currentTime: 0, duration: 0 });
  }, [activeVideoId]);

  // Send a seek request to the organizer's player
  const handleSeek = useCallback(
    (seekTime) => {
      socketRef.current?.emit('video:seek', { partyId, seekTime });
    },
    [partyId]
  );

  // Send audio settings change to the organizer's player
  const handleSettingsChange = useCallback(
    (newSettings) => {
      setSettings(newSettings);
      socketRef.current?.emit('audio:settings', { partyId, settings: newSettings });
    },
    [partyId]
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        const [partyRes, queueRes] = await Promise.all([
          getParty(partyId),
          getQueue(partyId),
        ]);
        setParty(partyRes.data);
        setQueue(queueRes.data);
        setIsLocked(partyRes.data.is_locked || false);
        if (partyRes.data.is_locked) {
          setActiveTab('queue');
        }
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
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      setSocketId(socket.id);
      setReconnectAttempts(0);
      socket.emit('join:party', partyId);
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setSocketId(null);
    });
    socket.on('reconnect_attempt', (attempt) => {
      setReconnectAttempts(attempt);
    });
    socket.on('queue:update', ({ queue: updatedQueue }) => {
      if (updatedQueue) {
        setQueue(updatedQueue);
      }
    });
    socket.on('party:lock', ({ is_locked }) => {
      setIsLocked(is_locked);
      if (is_locked) {
        setActiveTab('queue');
      }
    });
    // Receive real-time playback position broadcast by the organizer's player
    socket.on('video:progress', ({ currentTime, duration }) => {
      setVideoProgress({ currentTime, duration });
    });
    return () => {
      socket.emit('leave:party', partyId);
      socket.disconnect();
      socketRef.current = null;
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

  const upcomingCount = queue.filter((i) => i.status !== 'played').length;
  const connectionState = connected ? 'connected' : reconnectAttempts > 0 ? 'reconnecting' : 'disconnected';

  return (
    <div className="guest-layout">
      {/* Header */}
      <header className="guest-header">
        <div className="guest-header-info">
          <span className="party-badge">🎉 {party.name}</span>
          {isLocked && <span className="locked-badge">🔒 Locked</span>}
          <span className="member-badge">👤 {memberName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ThemePicker />
          <button
            className="btn-audio-toggle"
            onClick={() => setAudioPanelOpen((o) => !o)}
            aria-label="Toggle audio settings"
          >
            🎛️ Audio
          </button>
          <button
            className="btn-status-toggle"
            onClick={() => setStatusPanelOpen((o) => !o)}
            aria-label="Toggle connection status"
          >
            <span className={`connection-dot connection-dot--${connectionState}`} />
            Status
          </button>
          <button className="btn-leave" onClick={() => navigate('/')}>Leave</button>
        </div>
      </header>

      {/* Mobile tab switcher */}
      <nav className="mobile-tabs">
        {!isLocked && (
          <button
            className={`mobile-tab ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            🔍 Search
          </button>
        )}
        <button
          className={`mobile-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          🎵 Queue
          {upcomingCount > 0 && <span className="badge">{upcomingCount}</span>}
        </button>
        <button
          className={`mobile-tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          <span className={`connection-dot connection-dot--${connectionState}`} />
          Status
        </button>
      </nav>

      {/* Content */}
      <main className="guest-main">
        {error && <div className="error-msg">{error}</div>}

        <div className="guest-columns">
          {/* Search section */}
          {!isLocked && (
          <div className={`search-section${activeTab !== 'search' ? ' mobile-hidden' : ''}`}>
            <div className="section-heading">Search for songs to add</div>
            <SongSearch
              partyId={partyId}
              member={member}
              onAdded={handleSongAdded}
            />
          </div>
          )}

          {/* Queue section */}
          <div className={`queue-section${activeTab !== 'queue' ? ' mobile-hidden' : ''}`}>
            <div className="section-heading">
              🎵 Queue
              {upcomingCount > 0 && <span className="badge">{upcomingCount}</span>}
            </div>
            {queue.length === 0 ? (
              <div className="empty-state">
                <span>🎵</span>
                <p>No songs yet!</p>
                {!isLocked && <p className="muted">Use the search panel to find and add songs.</p>}
              </div>
            ) : (
              <Playlist
                queue={queue}
                onRemove={handleRemove}
                onReorder={handleReorder}
                onPlay={handlePlay}
                onPause={handlePause}
                isOrganizer={false}
                canReorder={true}
                canRemove={true}
                currentTime={videoProgress.currentTime}
                duration={videoProgress.duration}
                onSeek={handleSeek}
              />
            )}
          </div>
        </div>
      </main>

      {/* Audio settings slideout */}
      {audioPanelOpen && (
        <div
          className="audio-overlay"
          onClick={() => setAudioPanelOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setAudioPanelOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close audio settings"
        />
      )}
      <div className={`audio-panel${audioPanelOpen ? ' open' : ''}`}>
        <div className="audio-panel-header">
          <span className="audio-panel-title">🎛️ Audio Settings</span>
          <button
            className="audio-panel-close"
            onClick={() => setAudioPanelOpen(false)}
            aria-label="Close audio settings"
          >
            ✕
          </button>
        </div>
        <div className="audio-panel-body">
          <CustomizationPanel settings={settings} onChange={handleSettingsChange} />
        </div>
      </div>

      {/* Connection status slideout */}
      {statusPanelOpen && (
        <div
          className="status-overlay"
          onClick={() => setStatusPanelOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setStatusPanelOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close connection status"
        />
      )}
      <div className={`status-panel${statusPanelOpen ? ' open' : ''}`}>
        <div className="status-panel-header">
          <span className="status-panel-title">📶 Connection Status</span>
          <button
            className="status-panel-close"
            onClick={() => setStatusPanelOpen(false)}
            aria-label="Close connection status"
          >
            ✕
          </button>
        </div>
        <div className="status-panel-body">
          <div className="status-card">
            <div className="status-row">
              <span className="status-label">State</span>
              <span className={`status-value connection-status connection-status--${connectionState}`}>
                <span className={`connection-dot connection-dot--${connectionState}`} />
                {connected ? 'Connected' : reconnectAttempts > 0 ? `Reconnecting… (attempt ${reconnectAttempts})` : 'Disconnected'}
              </span>
            </div>
            {socketId && (
              <div className="status-row">
                <span className="status-label">Socket ID</span>
                <span className="status-value status-mono">{socketId}</span>
              </div>
            )}
            <div className="status-row">
              <span className="status-label">Party</span>
              <span className="status-value">{party.name}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Member</span>
              <span className="status-value">{memberName}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
