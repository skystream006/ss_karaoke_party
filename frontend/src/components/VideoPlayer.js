import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { buildAudioUrl } from '../services/api';
import './VideoPlayer.css';

const VideoPlayer = forwardRef(function VideoPlayer({ videoId, onEnded, settings, onPrev, hasPrev, onNext, hasNext, onTimeUpdate }, ref) {
  // ─── YouTube player refs ─────────────────────────────────────────────────────
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const mouseTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);

  // ─── Stable callback refs (avoid stale closures in YouTube event handlers) ──
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

  // ─── Audio-mode refs ─────────────────────────────────────────────────────────
  // audioRef   – the hidden <audio> element used when key ≠ 0
  // audioModeRef  – mirror of (settings.key !== 0), readable in callbacks without
  //                 causing stale-closure bugs
  // settingsRef   – always up-to-date settings, for use inside callbacks/imperative
  // videoIdRef    – always up-to-date videoId
  const audioRef = useRef(null);
  const audioModeRef = useRef(settings ? settings.key !== 0 : false);
  const settingsRef = useRef(settings);
  const videoIdRef = useRef(videoId);

  useEffect(() => { settingsRef.current = settings; audioModeRef.current = !!(settings && settings.key !== 0); }, [settings]);
  useEffect(() => { videoIdRef.current = videoId; }, [videoId]);

  // ─── Expose seekTo/pauseVideo/playVideo to parent pages ─────────────────────
  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      if (playerRef.current?.seekTo) {
        playerRef.current.seekTo(seconds, true);
      }
      // In audio mode reload stream from the new position
      if (audioModeRef.current && audioRef.current && videoIdRef.current) {
        const s = settingsRef.current;
        const wasPlaying = !audioRef.current.paused;
        audioRef.current.src = buildAudioUrl(videoIdRef.current, s.key, seconds);
        audioRef.current.load();
        if (wasPlaying) audioRef.current.play().catch(() => {});
      }
    },
    pauseVideo: () => {
      playerRef.current?.pauseVideo?.();
      if (audioModeRef.current && audioRef.current) {
        audioRef.current.pause();
      }
    },
    playVideo: () => {
      playerRef.current?.playVideo?.();
      if (audioModeRef.current && audioRef.current && audioRef.current.src) {
        audioRef.current.play().catch(() => {});
      }
    },
  }), []);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(tag, firstScript);
    }
  }, []);

  // Apply settings to the YouTube player.
  // In audio mode the YouTube player is muted; volume/playbackRate are applied
  // to the <audio> element instead (see the settings change effect below).
  const applySettings = (player) => {
    const s = settingsRef.current;
    if (!player || !s) return;
    if (s.key !== 0) {
      // Audio mode: mute YouTube for the visual, match its playback rate for sync
      player.setVolume(0);
      try { player.setPlaybackRate(s.tempo); } catch (err) {
        console.warn('setPlaybackRate not supported:', err);
      }
    } else {
      // Normal mode: YouTube handles sound
      if (s.vocalLevel !== undefined) player.setVolume(s.vocalLevel);
      if (s.tempo !== undefined) {
        try { player.setPlaybackRate(s.tempo); } catch (err) {
          console.warn('setPlaybackRate not supported:', err);
        }
      }
    }
  };

  // Create/recreate the YouTube player whenever videoId changes
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
            // In audio mode, initialise the audio stream as soon as YouTube is ready
            if (settingsRef.current?.key !== 0 && audioRef.current) {
              const s = settingsRef.current;
              audioRef.current.src = buildAudioUrl(videoId, s.key, 0);
              audioRef.current.volume = s.vocalLevel / 100;
              audioRef.current.playbackRate = s.tempo;
              audioRef.current.load();
              // Brief delay lets YouTube buffer a moment before audio kicks in
              setTimeout(() => {
                if (audioRef.current && audioModeRef.current) {
                  audioRef.current.play().catch(() => {});
                }
              }, 300);
            }
          },
          onStateChange: (event) => {
            const { PlayerState } = window.YT;
            if (event.data === PlayerState.PLAYING) {
              if (!audioModeRef.current) {
                // YouTube mode: poll playback position every second
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = setInterval(() => {
                  if (playerRef.current?.getCurrentTime) {
                    const ct = playerRef.current.getCurrentTime();
                    const dur = playerRef.current.getDuration();
                    onTimeUpdateRef.current?.(ct, dur);
                  }
                }, 1000);
              } else if (audioRef.current && audioRef.current.src) {
                // Audio mode: keep audio in sync with YouTube state
                audioRef.current.play().catch(() => {});
              }
            } else {
              if (!audioModeRef.current) {
                clearInterval(progressIntervalRef.current);
              } else if (audioRef.current) {
                audioRef.current.pause();
              }
            }
            // YouTube ENDED only triggers onEnded in normal (non-audio) mode.
            // In audio mode the <audio> element's own onEnded handles it.
            if (event.data === PlayerState.ENDED && !audioModeRef.current) {
              onEndedRef.current?.();
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

    // Capture ref here so the cleanup closure sees the same node
    const container = containerRef.current;
    const audio = audioRef.current;
    return () => {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      // Remove the child element YouTube replaced so it doesn't accumulate
      // across video changes.
      if (container) container.innerHTML = '';
      // Stop audio stream when the video is unloaded
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-creating the player on each render would be disruptive; callbacks are kept current via refs
  }, [videoId]);

  // ─── Mode-switching effect ───────────────────────────────────────────────────
  // Fires when settings.key changes.  Uses settingsRef / videoIdRef so it always
  // reads the current values even though it only depends on settings.key.
  useEffect(() => {
    const s = settingsRef.current;
    const vid = videoIdRef.current;
    if (!vid) return;

    if (s.key !== 0) {
      // Entering (or staying in) audio mode ─ mute YouTube, reload audio stream
      if (playerRef.current?.setVolume) playerRef.current.setVolume(0);
      if (playerRef.current?.setPlaybackRate) {
        try { playerRef.current.setPlaybackRate(s.tempo); } catch {}
      }
      if (audioRef.current) {
        const currentTime = playerRef.current?.getCurrentTime?.() || 0;
        const ytState = playerRef.current?.getPlayerState?.();
        const wasPlaying = ytState === window.YT?.PlayerState?.PLAYING;
        audioRef.current.src = buildAudioUrl(vid, s.key, currentTime);
        audioRef.current.volume = s.vocalLevel / 100;
        audioRef.current.playbackRate = s.tempo;
        audioRef.current.load();
        if (wasPlaying) audioRef.current.play().catch(() => {});
      }
    } else {
      // Returning to normal YouTube mode
      if (playerRef.current?.setVolume) playerRef.current.setVolume(s.vocalLevel);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on settings.key; current values read via refs
  }, [settings?.key]);

  // ─── Apply non-key settings changes ─────────────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    if (playerRef.current?.setVolume) {
      applySettings(playerRef.current);
    }
    // In audio mode also update the audio element directly
    if (settings.key !== 0 && audioRef.current) {
      audioRef.current.volume = settings.vocalLevel / 100;
      audioRef.current.playbackRate = settings.tempo;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applySettings reads settingsRef; settings is the only changing dep
  }, [settings]);

  // ─── Fullscreen change detection ─────────────────────────────────────────────
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

      {/*
        Hidden audio element used in audio mode (settings.key !== 0).
        The YouTube iframe remains visible for lyrics/visuals but is muted;
        this element delivers the pitch-shifted audio from the backend.
      */}
      <audio
        ref={audioRef}
        style={{ display: 'none' }}
        onPlay={() => {
          if (!audioModeRef.current) return;
          // Start polling position from the audio element (mirrors YouTube-mode interval)
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = setInterval(() => {
            if (audioRef.current) {
              const ct = audioRef.current.currentTime;
              const dur = isFinite(audioRef.current.duration) ? audioRef.current.duration : 0;
              onTimeUpdateRef.current?.(ct, dur);
            }
          }, 1000);
        }}
        onPause={() => {
          if (!audioModeRef.current) return;
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }}
        onEnded={() => {
          if (!audioModeRef.current) return;
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
          onEndedRef.current?.();
        }}
      />

      {/* Fullscreen overlay nav buttons */}
      {isFullscreen && (
        <>
          {hasPrev && (
            <button
              className={`fullscreen-nav-btn fullscreen-prev-btn${controlsVisible ? ' visible' : ''}`}
              onClick={onPrev}
              aria-label="Previous song"
            >
              &#9664;
            </button>
          )}
          {hasNext && (
            <button
              className={`fullscreen-nav-btn fullscreen-next-btn${controlsVisible ? ' visible' : ''}`}
              onClick={onNext}
              aria-label="Next song"
            >
              &#9654;
            </button>
          )}
        </>
      )}

      {/* Below-video nav controls (hidden in fullscreen) */}
      {!isFullscreen && (
        <div className="video-nav-controls">
          <button
            className="nav-btn nav-btn-fullscreen"
            onClick={toggleFullscreen}
            aria-label="Enter fullscreen"
          >
            ⛶ Fullscreen
          </button>
          {hasPrev && (
            <button
              className="nav-btn"
              onClick={onPrev}
              aria-label="Previous song"
            >
              ⏮ Previous
            </button>
          )}
          {hasNext && (
            <button
              className="nav-btn"
              onClick={onNext}
              aria-label="Next song"
            >
              Next ⏭
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default VideoPlayer;

