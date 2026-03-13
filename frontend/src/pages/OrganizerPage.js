import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  getParty,
  getQueue,
  removeFromQueue,
  reorderQueue,
  updateQueueItemStatus,
  resetQueue,
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
  const currentVideoIdRef = useRef(null);

  const memberName = sessionStorage.getItem('memberName') || 'Organizer';

  // Keep currentVideoIdRef in sync so callbacks can read it without stale closures
  useEffect(() => {
    currentVideoIdRef.current = currentVideoId;
  }, [currentVideoId]);

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
          const paused = updatedQueue.find((i) => i.status === 'paused');
          const active = playing || paused;
          setCurrentVideoId(active ? active.video_id : null);
          // Handle player state changes triggered by another client (e.g. a guest)
          if (paused) {
            videoPlayerRef.current?.pauseVideo();
          } else if (playing) {
            // If the same video is already loaded, resume it; otherwise VideoPlayer
            // will create a fresh player that auto-plays via onReady.
            videoPlayerRef.current?.playVideo();
          }
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
        if (currentVideoIdRef.current === item.video_id) {
          // Same video is already loaded – resume from current position
          videoPlayerRef.current?.playVideo();
        } else {
          setCurrentVideoId(item.video_id);
        }
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
        // Pause the player in place – do NOT unload the video so position is preserved
        videoPlayerRef.current?.pauseVideo();
      } catch {
        setError('Failed to pause song.');
      }
    },
    [partyId]
  );

  const handleVideoEnded = useCallback(async () => {
    // Find currently playing or paused item
    const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
    // Auto-advance to next queued song (skip already-played songs)
    const next = queue.find((i) => i.status === 'queued');
    if (next) {
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentVideoId(next.video_id);
    } else {
      if (active) {
        await updateQueueItemStatus(partyId, active.id, 'played');
      }
      setCurrentVideoId(null);
    }
  }, [partyId, queue]);

  const handlePrevious = useCallback(async () => {
    try {
      const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
      if (!active) return;
      // Find the song with the highest position that is still lower than the current
      const prevSongs = queue.filter((i) => i.position < active.position);
      if (prevSongs.length === 0) return;
      const prev = prevSongs.reduce((a, b) => (a.position > b.position ? a : b));
      await updateQueueItemStatus(partyId, prev.id, 'playing');
      setCurrentVideoId(prev.video_id);
    } catch {
      setError('Failed to go to previous song.');
    }
  }, [partyId, queue]);

  const handleNext = useCallback(async () => {
    try {
      const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
      if (!active) return;
      // Find the song with the lowest position that is higher than the current
      const nextSongs = queue.filter((i) => i.position > active.position);
      if (nextSongs.length === 0) return;
      const next = nextSongs.reduce((a, b) => (a.position < b.position ? a : b));
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentVideoId(next.video_id);
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

  const handleResetQueue = useCallback(async () => {
    if (!window.confirm('Reset all songs (except the currently playing one) back to queued?')) return;
    try {
      await resetQueue(partyId);
      // Queue will update via socket
    } catch {
      setError('Failed to reset queue.');
    }
  }, [partyId]);

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

  const upcomingCount = queue.filter((i) => i.status !== 'played').length;
  const activeQueueItem = queue.find((i) => i.status === 'playing' || i.status === 'paused');

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

        {/* Now Playing in navbar – shown when a video is active */}
        {currentVideoId && activeQueueItem && (
          <div className="header-now-playing">
            {activeQueueItem.video_thumbnail && (
              <img
                src={activeQueueItem.video_thumbnail}
                alt={activeQueueItem.video_title}
                className="hnp-thumb"
              />
            )}
            <span className="hnp-label">
              {activeQueueItem.status === 'paused' ? '⏸' : '♪'}
            </span>
            <div className="hnp-text">
              <span className="hnp-title">{activeQueueItem.video_title}</span>
              <span className="hnp-singer">🎤 {activeQueueItem.singer_name}</span>
            </div>
          </div>
        )}
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
                <div className="queue-count-row">
                  <span className="queue-count">
                    {upcomingCount} song{upcomingCount !== 1 ? 's' : ''} in queue
                  </span>
                  <button
                    className="btn-reset-queue"
                    onClick={handleResetQueue}
                    title="Reset all songs (except currently playing) back to queued"
                  >
                    ↺ Reset All
                  </button>
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
              onPrev={handlePrevious}
              hasPrev={activeQueueItem ? queue.some((i) => i.position < activeQueueItem.position) : false}
              onNext={handleNext}
              hasNext={activeQueueItem ? queue.some((i) => i.position > activeQueueItem.position) : false}
              onTimeUpdate={handleTimeUpdate}
            />

            {/* Now playing info is shown in the header nav bar */}

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
