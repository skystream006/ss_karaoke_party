import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  getParty,
  getQueue,
  removeFromQueue,
  reorderQueue,
  updateQueueItemStatus,
  endParty,
  deleteParty,
  reactivateParty,
} from '../services/api';
import VideoPlayer from '../components/VideoPlayer';
import Playlist from '../components/Playlist';
import QRCodeModal from '../components/QRCodeModal';
import CustomizationPanel from '../components/CustomizationPanel';
import ThemePicker from '../components/ThemePicker';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('playlist'); // 'playlist' | 'settings'
  const [settings, setSettings] = useState({ key: 0, tempo: 1.0, vocalLevel: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const socketRef = useRef(null);
  const videoPlayerRef = useRef(null);

  const memberName = sessionStorage.getItem('memberName') || 'Organizer';

  // Reset video progress when the playing song changes
  useEffect(() => {
    setVideoCurrentTime(0);
    setVideoDuration(0);
  }, [currentVideoId]);

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
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('join:party', partyId);
    });
    socket.on('queue:update', ({ action, queue: updatedQueue }) => {
      if (updatedQueue) {
        setQueue(updatedQueue);
        if (action === 'status') {
          const playing = updatedQueue.find((i) => i.status === 'playing');
          setCurrentVideoId(playing ? playing.video_id : null);
        }
      }
    });
    // A guest requested a seek – apply it to the local YouTube player
    socket.on('video:seek', ({ seekTime }) => {
      videoPlayerRef.current?.seekTo(seekTime);
    });
    return () => {
      socket.emit('leave:party', partyId);
      socket.disconnect();
      socketRef.current = null;
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

  const handlePause = useCallback(
    async (item) => {
      try {
        await updateQueueItemStatus(partyId, item.id, 'queued');
        setCurrentVideoId(null);
      } catch {
        setError('Failed to pause song.');
      }
    },
    [partyId]
  );

  const handleVideoEnded = useCallback(async () => {
    // Find currently playing item
    const playing = queue.find((i) => i.status === 'playing');
    // Auto-advance to next
    const next = queue.find((i) => i.status === 'queued');
    if (next) {
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentVideoId(next.video_id);
    } else {
      if (playing) {
        await updateQueueItemStatus(partyId, playing.id, 'queued');
      }
      setCurrentVideoId(null);
    }
  }, [partyId, queue]);

  const handleNext = useCallback(async () => {
    try {
      const next = queue.find((i) => i.status === 'queued');
      if (next) {
        await updateQueueItemStatus(partyId, next.id, 'playing');
        setCurrentVideoId(next.video_id);
      } else {
        const playing = queue.find((i) => i.status === 'playing');
        if (playing) {
          await updateQueueItemStatus(partyId, playing.id, 'queued');
        }
        setCurrentVideoId(null);
      }
    } catch {
      setError('Failed to skip to next song.');
    }
  }, [partyId, queue]);

  // Emit playback progress to guests and update local display
  const handleTimeUpdate = useCallback((currentTime, duration) => {
    setVideoCurrentTime(currentTime);
    setVideoDuration(duration);
    socketRef.current?.emit('video:progress', { partyId, currentTime, duration });
  }, [partyId]);

  // Seek the local YouTube player (triggered by the organizer dragging the slider)
  const handleSeek = useCallback((seekTime) => {
    videoPlayerRef.current?.seekTo(seekTime);
  }, []);

  const handleEndParty = async () => {
    if (!window.confirm('End this party? All guests will be disconnected.')) return;
    try {
      await endParty(partyId);
      navigate('/');
    } catch {
      setError('Failed to end party.');
    }
  };

  const handleDeleteParty = async () => {
    const input = window.prompt(
      'This will permanently delete the party and all its data.\nType DELETE to confirm.'
    );
    if (input !== 'DELETE') return;
    try {
      await deleteParty(partyId);
      navigate('/');
    } catch {
      setError('Failed to delete party.');
    }
  };

  const handleReactivateParty = async () => {
    try {
      const res = await reactivateParty(partyId);
      setParty(res.data);
    } catch {
      setError('Failed to reactivate party.');
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
          <ThemePicker />
          <button className="btn btn-danger-sm" onClick={handleEndParty}>
            End Party
          </button>
          <button className="btn btn-delete-sm" onClick={handleDeleteParty} aria-label="Permanently delete party">
            Delete Party
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

      {/* Inactive party banner */}
      {!party.is_active && (
        <div className="inactive-banner">
          <span>⚠️ This party has ended.</span>
          <button className="btn btn-reactivate" onClick={handleReactivateParty}>
            Reactivate Party
          </button>
        </div>
      )}

      {/* Body: sidebar + main content side by side */}
      <div className="organizer-body">
        {/* Slide-out Sidebar (left) */}
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
                  onPause={handlePause}
                  isOrganizer={true}
                  currentTime={videoCurrentTime}
                  duration={videoDuration}
                  onSeek={handleSeek}
                />
              </>
            )}
            {sidebarTab === 'settings' && (
              <CustomizationPanel settings={settings} onChange={setSettings} />
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="organizer-main">
          <div className="main-video-section">
            <VideoPlayer
              ref={videoPlayerRef}
              videoId={currentVideoId}
              onEnded={handleVideoEnded}
              settings={settings}
              onNext={handleNext}
              hasNext={queue.some((i) => i.status === 'queued')}
              onTimeUpdate={handleTimeUpdate}
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
            </div>
          </div>

          <div className="main-qr-section">
            <QRCodeModal party={party} />
          </div>
        </main>
      </div>

    </div>
  );
}
