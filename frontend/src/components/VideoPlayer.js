import React, { useEffect, useRef, useState, useCallback } from 'react';
import './VideoPlayer.css';

export default function VideoPlayer({ videoId, onEnded, settings, onNext, onPrevious, hasPrevious, hasNext }) {
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const mouseTimerRef = useRef(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(tag, firstScript);
    }
  }, []);

  useEffect(() => {
    if (!videoId) return;

    const initPlayer = () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      // Create a nested element for YouTube to replace so that containerRef.current
      // (React's tracked node) is never removed from the DOM by the YouTube API.
      // This prevents React's removeChild from failing when reconciling after a
      // videoId change (e.g. pausing a song).
      const playerTarget = document.createElement('div');
      containerRef.current.appendChild(playerTarget);
      playerRef.current = new window.YT.Player(playerTarget, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          fs: 0,
        },
        events: {
          onReady: (event) => {
            event.target.playVideo();
            applySettings(event.target);
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.ENDED && onEndedRef.current) {
              onEndedRef.current();
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      // Remove the child element YouTube replaced so it doesn't accumulate
      // across video changes.
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-creating the player on each render would be disruptive; onEnded is kept current via onEndedRef
  }, [videoId]);

  const applySettings = (player) => {
    if (!player || !settings) return;
    // Volume proxy for vocal level (0–100)
    if (settings.vocalLevel !== undefined) {
      player.setVolume(settings.vocalLevel);
    }
    // Playback rate proxy for tempo (0.5 – 2.0)
    if (settings.tempo !== undefined) {
      try {
        player.setPlaybackRate(settings.tempo);
      } catch (err) {
        console.warn('setPlaybackRate not supported:', err);
      }
    }
  };

  // Re-apply settings whenever they change
  useEffect(() => {
    if (playerRef.current && playerRef.current.setVolume) {
      applySettings(playerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applySettings is defined in component scope and stable; settings is the only changing dep
  }, [settings]);

  // Fullscreen change detection
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      clearTimeout(mouseTimerRef.current);
      if (fs) {
        setControlsVisible(true);
        mouseTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
      } else {
        setControlsVisible(true);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      clearTimeout(mouseTimerRef.current);
    };
  }, []);

  const handleMouseMove = useCallback(() => {
    if (!isFullscreen) return;
    setControlsVisible(true);
    clearTimeout(mouseTimerRef.current);
    mouseTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }, []);

  if (!videoId) {
    return (
      <div className="video-placeholder">
        <div className="video-placeholder-inner">
          <span className="video-placeholder-icon">🎵</span>
          <p>No song playing</p>
          <p className="muted">Add songs to the queue to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={`video-fullscreen-wrapper${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}
      onMouseMove={handleMouseMove}
    >
      <div className="video-container">
        <div ref={containerRef} id="yt-player" />
      </div>

      {/* Fullscreen overlay nav buttons */}
      {isFullscreen && (
        <>
          <button
            className={`fullscreen-nav-btn fullscreen-prev-btn${controlsVisible ? ' visible' : ''}`}
            onClick={onPrevious}
            disabled={!hasPrevious}
            aria-label="Previous song"
          >
            &#9664;
          </button>
          <button
            className={`fullscreen-nav-btn fullscreen-next-btn${controlsVisible ? ' visible' : ''}`}
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Next song"
          >
            &#9654;
          </button>
        </>
      )}

      {/* Below-video nav controls (hidden in fullscreen) */}
      {!isFullscreen && (
        <div className="video-nav-controls">
          <button
            className="nav-btn"
            onClick={onPrevious}
            disabled={!hasPrevious}
            aria-label="Previous song"
          >
            ⏮ Previous
          </button>
          <button
            className="nav-btn nav-btn-fullscreen"
            onClick={toggleFullscreen}
            aria-label="Enter fullscreen"
          >
            ⛶ Fullscreen
          </button>
          <button
            className="nav-btn"
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Next song"
          >
            Next ⏭
          </button>
        </div>
      )}
    </div>
  );
}
