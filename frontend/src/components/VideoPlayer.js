import React, { useEffect, useRef, useState, useCallback } from 'react';
import './VideoPlayer.css';

export default function VideoPlayer({ videoId, onEnded, onNext, onPrevious, settings }) {
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const hideTimerRef = useRef(null);
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
      }
      playerRef.current = new window.YT.Player(containerRef.current, {
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
            if (event.data === window.YT.PlayerState.ENDED && onEnded) {
              onEnded();
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEnded is a callback prop; re-creating the player on each render would be disruptive
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

  // Fullscreen detection
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Start / reset the 2-second hide timer for fullscreen overlay controls
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2000);
  }, []);

  // When entering fullscreen start the timer; when leaving always show controls
  useEffect(() => {
    if (isFullscreen) {
      resetHideTimer();
    } else {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isFullscreen, resetHideTimer]);

  const handleMouseMove = useCallback(() => {
    if (isFullscreen) resetHideTimer();
  }, [isFullscreen, resetHideTimer]);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      wrapperRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
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
      className={`video-wrapper${isFullscreen ? ' video-wrapper--fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
    >
      <div className="video-container">
        <div ref={containerRef} id="yt-player" />
      </div>

      {/* Normal mode: navigation buttons below the video */}
      {!isFullscreen && (
        <div className="video-nav-controls">
          <button
            className="nav-btn nav-btn--prev"
            onClick={onPrevious}
            disabled={!onPrevious}
            aria-label="Previous song"
          >
            ⏮ Previous
          </button>
          <button
            className="nav-btn nav-btn--fullscreen"
            onClick={handleFullscreenToggle}
            aria-label="Enter fullscreen"
          >
            ⛶ Fullscreen
          </button>
          <button
            className="nav-btn nav-btn--next"
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next song"
          >
            Next ⏭
          </button>
        </div>
      )}

      {/* Fullscreen mode: overlay prev/next buttons on left and right */}
      {isFullscreen && (
        <>
          <button
            className={`fs-nav-btn fs-nav-btn--prev${controlsVisible ? ' visible' : ''}`}
            onClick={onPrevious}
            disabled={!onPrevious}
            aria-label="Previous song"
          >
            ◀
          </button>
          <button
            className={`fs-nav-btn fs-nav-btn--next${controlsVisible ? ' visible' : ''}`}
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next song"
          >
            ▶
          </button>
        </>
      )}
    </div>
  );
}
