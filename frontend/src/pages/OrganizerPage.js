import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  getParty,
  getQueue,
  removeFromQueue,
  reorderQueue,
  updateQueueItemStatus,
  endParty,
} from '../services/api';
import VideoPlayer from '../components/VideoPlayer';
import Playlist from '../components/Playlist';
import QRCodeModal from '../components/QRCodeModal';
import CustomizationPanel from '../components/CustomizationPanel';
import './OrganizerPage.css';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : window.location.origin);

export default function OrganizerPage() {
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('playlist'); // 'playlist' | 'settings'
  const [showQR, setShowQR] = useState(false);
  const [settings, setSettings] = useState({ key: 0, tempo: 1.0, vocalLevel: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const memberName = sessionStorage.getItem('memberName') || 'Organizer';

  // Load party data
  useEffect(() => {
    const loadParty = async () => {
      try {
        const [partyRes, queueRes] = await Promise.all([
          getParty(partyId),
          getQueue(partyId),
        ]);
        setParty(partyRes.data);
        setQueue(queueRes.data);

        // Auto-play first queued song
        const playing = queueRes.data.find((i) => i.status === 'playing');
        if (playing) setCurrentVideoId(playing.video_id);
      } catch (err) {
        setError('Failed to load party data.');
      } finally {
        setLoading(false);
      }
    };
    loadParty();
  }, [partyId]);

  // Socket connection
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

  const handleRemove = useCallback(
    async (itemId) => {
      try {
        await removeFromQueue(partyId, itemId);
        // Queue will update via socket
      } catch {
        setError('Failed to remove song.');
      }
    },
    [partyId]
  );

  const handleReorder = useCallback(
    async (reordered) => {
      // Optimistic update
      setQueue(reordered);
      try {
        await reorderQueue(
          partyId,
          reordered.map((item) => ({ id: item.id, position: item.position }))
        );
      } catch {
        setError('Failed to reorder queue.');
        // Reload queue
        const res = await getQueue(partyId);
        setQueue(res.data);
      }
    },
    [partyId]
  );

  const handlePlay = useCallback(
    async (item) => {
      try {
        await updateQueueItemStatus(partyId, item.id, 'playing');
        setCurrentVideoId(item.video_id);
      } catch {
        setError('Failed to start song.');
      }
    },
    [partyId]
  );

  const handleVideoEnded = useCallback(async () => {
    // Find currently playing item
    const playing = queue.find((i) => i.status === 'playing');
    if (playing) {
      await updateQueueItemStatus(partyId, playing.id, 'played');
    }
    // Auto-advance to next
    const next = queue.find((i) => i.status === 'queued' && i.id !== playing?.id);
    if (next) {
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentVideoId(next.video_id);
    } else {
      setCurrentVideoId(null);
    }
  }, [partyId, queue]);

  const handleEndParty = async () => {
    if (!window.confirm('End this party? All guests will be disconnected.')) return;
    try {
      await endParty(partyId);
      navigate('/');
    } catch {
      setError('Failed to end party.');
    }
  };

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
        <p>Party not found.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return (
    <div className={`organizer-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* Header */}
      <header className="organizer-header">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle playlist"
        >
          {sidebarOpen ? '✕' : '☰'}
        </button>
        <div className="header-title">
          <span className="header-icon">🎤</span>
          <h1>{party.name}</h1>
        </div>
        <div className="header-right">
          <span className="member-name-badge">👤 {memberName}</span>
          <button className="btn btn-danger-sm" onClick={handleEndParty}>
            End Party
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* Main content */}
      <main className="organizer-main">
        <VideoPlayer
          videoId={currentVideoId}
          onEnded={handleVideoEnded}
          settings={settings}
        />

        {/* Now playing info */}
        {currentVideoId && queue.find((i) => i.status === 'playing') && (
          <div className="now-playing">
            <span className="np-label">Now Playing</span>
            <span className="np-title">
              {queue.find((i) => i.status === 'playing')?.video_title}
            </span>
            <span className="np-singer">
              🎤 {queue.find((i) => i.status === 'playing')?.singer_name}
            </span>
          </div>
        )}

        <div className="next-up-hint">
          <span>Guests can join at: <strong>{party.join_code}</strong></span>
          <button className="btn btn-sm btn-outline" onClick={() => { setSidebarOpen(true); setShowQR(true); }}>
            Show QR Code
          </button>
        </div>
      </main>

      {/* Slide-out Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setSidebarTab('playlist')}
            >
              🎵 Playlist
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'settings' ? 'active' : ''}`}
              onClick={() => setSidebarTab('settings')}
            >
              🎛️ Settings
            </button>
          </div>
          <button
            className="qr-btn"
            onClick={() => setShowQR(true)}
            title="Show QR code"
          >
            📱 QR Code
          </button>
        </div>

        <div className="sidebar-body">
          {sidebarTab === 'playlist' && (
            <>
              <div className="queue-count">
                {queue.length} song{queue.length !== 1 ? 's' : ''} in queue
              </div>
              <Playlist
                queue={queue}
                onRemove={handleRemove}
                onReorder={handleReorder}
                onPlay={handlePlay}
                isOrganizer={true}
              />
            </>
          )}
          {sidebarTab === 'settings' && (
            <CustomizationPanel settings={settings} onChange={setSettings} />
          )}
        </div>
      </aside>

      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* QR Code Modal */}
      {showQR && <QRCodeModal party={party} onClose={() => setShowQR(false)} />}
    </div>
  );
}
