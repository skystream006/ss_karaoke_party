import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { CircleStop, Lock, Trash2, Unlock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
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
  lockParty,
  getMember,
} from '../services/api';
import VideoPlayer from '../components/VideoPlayer';
import Playlist from '../components/Playlist';
import MediaThumbnail from '../components/MediaThumbnail';
import QRCodeModal from '../components/QRCodeModal';
import CustomizationPanel from '../components/CustomizationPanel';
import SongSearch from '../components/SongSearch';
import ThemePicker from '../components/ThemePicker';
import ActionsMenu from '../components/ActionsMenu';
import useSSMusicJobs from '../hooks/useSSMusicJobs';
import './OrganizerPage.css';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL || window.location.origin;

function isReadyForPlayback(item, ssmusicState) {
  return !ssmusicState[item.id]?.pending && !ssmusicState[item.id]?.error
    && !['submitting', 'queued', 'running', 'error'].includes(item.ssmusic_status)
    && !item.ssmusic_error
    && (item.source !== 'ssmusic' || Boolean(item.media_path));
}

export default function OrganizerPage({ signOutAction, accountInfoAction }) {
  const { authLevel } = useAuth();
  const { partyId, memberId: memberIdFromUrl } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [queue, setQueue] = useState([]);
  const { sendToSSMusic, ssmusicState } = useSSMusicJobs(partyId, setQueue);
  const [currentItem, setCurrentItem] = useState(null);
  const queuedCurrentItem = queue.find((item) => item.id === currentItem?.id);
  const currentMedia = queuedCurrentItem?.source === 'ssmusic' ? queuedCurrentItem : currentItem;
  const currentVideoId = currentMedia?.video_id || null;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('playlist'); // 'playlist' | 'search' | 'settings'
  const [qrPanelOpen, setQrPanelOpen] = useState(false);
  const [settings, setSettings] = useState({ key: 0, tempo: 1.0, vocalLevel: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const socketRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const currentItemIdRef = useRef(null);

  const memberName = sessionStorage.getItem('memberName') || 'Organizer';
  const memberId = memberIdFromUrl || sessionStorage.getItem('memberId');

  // Track queue entries, not media IDs: the same song can be queued twice.
  useEffect(() => {
    currentItemIdRef.current = currentItem?.id;
  }, [currentItem]);

  // Reset video progress when the playing song changes
  useEffect(() => {
    setVideoCurrentTime(0);
    setVideoDuration(0);
  }, [currentItem?.id, currentVideoId]);

  // Load party data
  useEffect(() => {
    const loadParty = async () => {
      try {
        const [partyRes, queueRes] = await Promise.all([
          getParty(partyId),
          getQueue(partyId),
        ]);

        // Validate that the member in the URL actually belongs to this party
        if (memberIdFromUrl) {
          try {
            const { data: membership } = await getMember(partyId, memberIdFromUrl);
            if (membership.role === 'guest') {
              navigate(`/guest/${partyId}/${memberIdFromUrl}`, { replace: true });
              return;
            }
          } catch (memberErr) {
            if ([401, 403, 404].includes(memberErr.response?.status)) {
              navigate('/join');
              return;
            }
          }
        }

        setParty(partyRes.data);
        setQueue(queueRes.data);
        setIsLocked(partyRes.data.is_locked || false);

        // Auto-play first queued song
        const active = queueRes.data.find((i) => i.status === 'playing' || i.status === 'paused');
        if (active) setCurrentItem(active);
      } catch (err) {
        setError('Failed to load party data.');
      } finally {
        setLoading(false);
      }
    };
    loadParty();
  }, [partyId, memberIdFromUrl, navigate]);

  // Socket connection
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'],
      auth: (callback) => callback({ token: sessionStorage.getItem('authToken') }) });
    socketRef.current = socket;
    let hasConnected = false;
    socket.on('connect', () => {
      socket.emit('join:party', partyId, (result) => { if (result?.error) setError(result.error); });
      if (hasConnected) {
        getQueue(partyId).then(({ data }) => {
          if (socketRef.current === socket) setQueue(data);
        }).catch(() => {});
      }
      hasConnected = true;
    });
    socket.on('connect_error', (failure) => {
      if (failure.message === 'Unauthorized') window.dispatchEvent(new Event('auth:expired'));
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') getQueue(partyId).catch(() => setError('Party access ended.'));
    });
    socket.on('queue:update', ({ action, queue: updatedQueue }) => {
      if (updatedQueue) {
        setQueue(updatedQueue);
        if (action === 'remove') {
          setCurrentItem((current) => current && !updatedQueue.some((item) => item.id === current.id) ? null : current);
        }
        if (action === 'status') {
          const playing = updatedQueue.find((i) => i.status === 'playing');
          const paused = updatedQueue.find((i) => i.status === 'paused');
          const active = playing || paused;
          setCurrentItem(active || null);
          // Handle player state changes triggered by another client (e.g. a guest)
          if (paused) {
            videoPlayerRef.current?.pauseVideo();
          } else if (playing && playing.id === currentItemIdRef.current) {
            // If the same video is already loaded, resume it; otherwise VideoPlayer
            // will create a fresh player that auto-plays via onReady.
            videoPlayerRef.current?.playVideo();
          }
        }
      }
    });
    // A guest requested a seek – apply it to the local player
    socket.on('video:seek', ({ seekTime }) => {
      videoPlayerRef.current?.seekTo(seekTime);
    });
    // A guest changed audio settings – apply them to the local player
    socket.on('audio:settings', ({ settings: newSettings }) => {
      setSettings(newSettings);
    });
    socket.on('party:lock', ({ is_locked }) => {
      setIsLocked(is_locked);
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
        setQueue((current) => current.filter((item) => item.id !== itemId));
        setCurrentItem((current) => current?.id === itemId ? null : current);
        setError('');
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to remove song.');
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
        if (currentItemIdRef.current === item.id) {
          // Same video is already loaded – resume from current position
          videoPlayerRef.current?.playVideo();
        }
        setCurrentItem({ ...item, status: 'playing' });
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
        setCurrentItem((current) => current?.id === item.id ? { ...current, status: 'paused' } : current);
      } catch {
        setError('Failed to pause song.');
      }
    },
    [partyId]
  );

  const handleVideoRestricted = useCallback(({ videoId, playbackKey }) => {
    if (currentItemIdRef.current !== playbackKey) return;
    const item = queue.find((entry) => entry.id === playbackKey && entry.video_id === videoId);
    if (item) return sendToSSMusic(item);
  }, [queue, sendToSSMusic]);

  const handleVideoEnded = useCallback(async () => {
    // Find currently playing or paused item
    const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
    // Auto-advance to the next song by position, regardless of its played status
    const nextSongs = active ? queue.filter((i) => i.position > active.position && isReadyForPlayback(i, ssmusicState)) : [];
    const next = nextSongs.length > 0 ? nextSongs.reduce((a, b) => (a.position < b.position ? a : b)) : null;
    if (next) {
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentItem({ ...next, status: 'playing' });
    } else {
      if (active) {
        await updateQueueItemStatus(partyId, active.id, 'played');
      }
      setCurrentItem(null);
    }
  }, [partyId, queue, ssmusicState]);

  const handlePrevious = useCallback(async () => {
    try {
      const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
      if (!active) return;
      // Find the song with the highest position that is still lower than the current
      const prevSongs = queue.filter((i) => i.position < active.position);
      if (prevSongs.length === 0) return;
      const prev = prevSongs.reduce((a, b) => (a.position > b.position ? a : b));
      await updateQueueItemStatus(partyId, prev.id, 'playing');
      setCurrentItem({ ...prev, status: 'playing' });
    } catch {
      setError('Failed to go to previous song.');
    }
  }, [partyId, queue]);

  const handleNext = useCallback(async () => {
    try {
      const active = queue.find((i) => i.status === 'playing' || i.status === 'paused');
      if (!active) return;
      // Find the song with the lowest position that is higher than the current
      const nextSongs = queue.filter((i) => i.position > active.position && isReadyForPlayback(i, ssmusicState));
      if (nextSongs.length === 0) {
        await updateQueueItemStatus(partyId, active.id, 'played');
        setCurrentItem(null);
        return;
      }
      const next = nextSongs.reduce((a, b) => (a.position < b.position ? a : b));
      await updateQueueItemStatus(partyId, next.id, 'playing');
      setCurrentItem({ ...next, status: 'playing' });
    } catch {
      setError('Failed to skip to next song.');
    }
  }, [partyId, queue, ssmusicState]);

  // Emit playback progress to guests and update local display
  const handleTimeUpdate = useCallback((currentTime, duration) => {
    setVideoCurrentTime(currentTime);
    setVideoDuration(duration);
    socketRef.current?.emit('video:progress', { partyId, currentTime, duration });
  }, [partyId]);

  // Seek the local player (triggered by the organizer dragging the slider)
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

  const handleToggleLock = async () => {
    try {
      const res = await lockParty(partyId, !isLocked, memberId);
      setIsLocked(res.data.is_locked);
    } catch (err) {
      console.error('Failed to toggle party lock:', err);
      setError('Failed to update party lock.');
    }
  };

  const handleEndParty = async () => {
    if (!window.confirm('End this party and disconnect invited guests?')) return;
    try {
      await endParty(partyId);
      navigate('/');
    } catch {
      setError('Failed to end party.');
    }
  };

  const handleDeleteParty = async () => {
    if (!window.confirm('Permanently delete this party and all its data? This cannot be undone.')) return;
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
        <div className="header-left">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle playlist"
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <button
            type="button"
            className="home-button"
            onClick={() => navigate('/')}
            aria-label="Home"
            title="Home"
          >
            <span aria-hidden="true">🏠</span>
          </button>
          <div className="header-title">
            <span className="header-icon">🎤</span>
            <h1>{party.name}</h1>
          </div>
          <span className="member-name-badge">👤 {memberName}</span>
        </div>

        {/* Now Playing in navbar – shown when a video is active */}
        {currentVideoId && activeQueueItem && (
          <div className="header-now-playing">
            <MediaThumbnail source={activeQueueItem.source} mediaPath={activeQueueItem.media_path}
              thumbnail={activeQueueItem.video_thumbnail} alt={activeQueueItem.video_title} className="hnp-thumb" />
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
          <ThemePicker />
          <button
            className="qr-panel-toggle"
            onClick={() => setQrPanelOpen(!qrPanelOpen)}
            aria-label="Toggle QR code"
          >
            {qrPanelOpen ? '✕' : '📱'}
          </button>
          <ActionsMenu label="Party actions" actions={[
            accountInfoAction,
            authLevel !== 'hostscreen' && { label: isLocked ? 'Unlock party queue' : 'Lock party queue', icon: isLocked ? Unlock : Lock, run: handleToggleLock },
            authLevel !== 'hostscreen' && party.is_active && { label: 'End party', icon: CircleStop, danger: true, run: handleEndParty },
            authLevel === 'admin' && { label: 'Delete party', ariaLabel: 'Permanently delete party', icon: Trash2, danger: true, run: handleDeleteParty },
            signOutAction && { ...signOutAction, separated: true },
          ]} />
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
          {authLevel === 'admin' && <button className="btn btn-reactivate" onClick={handleReactivateParty}>
            Reactivate Party
          </button>}
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
              {authLevel !== 'hostscreen' && <button
                className={`sidebar-tab ${sidebarTab === 'search' ? 'active' : ''}`}
                onClick={() => setSidebarTab('search')}
              >
                🔍 Search
              </button>}
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
                  onSendToSSMusic={isLocked ? undefined : sendToSSMusic}
                  ssmusicState={ssmusicState}
                  isOrganizer={true}
                  currentTime={videoCurrentTime}
                  duration={videoDuration}
                  onSeek={handleSeek}
                />
              </>
            )}
            {authLevel !== 'hostscreen' && sidebarTab === 'search' && (
              <SongSearch
                partyId={partyId}
                member={{ name: memberName }}
              />
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
              playbackKey={currentItem?.id}
              mediaPath={currentMedia?.source === 'ssmusic' ? currentMedia.media_path : null}
              mediaType={currentMedia?.media_type}
              title={currentMedia?.video_title}
              paused={currentItem?.status === 'paused'}
              processing={currentMedia?.source !== 'ssmusic' && Boolean(ssmusicState[currentItem?.id]?.pending
                || ['submitting', 'queued', 'running'].includes(queuedCurrentItem?.ssmusic_status))}
              processingError={queuedCurrentItem?.ssmusic_error || ssmusicState[currentItem?.id]?.error}
              onEnded={handleVideoEnded}
              onRestricted={handleVideoRestricted}
              settings={settings}
              onPrev={handlePrevious}
              hasPrev={activeQueueItem ? queue.some((i) => i.position < activeQueueItem.position) : false}
              onNext={handleNext}
              hasNext={activeQueueItem ? queue.some((i) => i.position > activeQueueItem.position) : false}
              onTimeUpdate={handleTimeUpdate}
            />

            {/* Now playing info is shown in the header nav bar */}
          </div>
        </main>

        {/* Slide-out QR Panel (right) */}
        <aside className={`qr-panel ${qrPanelOpen ? 'open' : ''}`}>
          <div className="qr-panel-header">
            <span className="qr-panel-title">📱 Join Party</span>
          </div>
          <div className="qr-panel-body">
            {qrPanelOpen && <QRCodeModal party={party} />}
          </div>
        </aside>
      </div>

    </div>
  );
}
