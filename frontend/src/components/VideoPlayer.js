import React, { useEffect, useRef } from 'react';
import './VideoPlayer.css';

export default function VideoPlayer({ videoId, onEnded, settings }) {
  const playerRef = useRef(null);
  const containerRef = useRef(null);

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
    // eslint-disable-next-line
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
      } catch {}
    }
  };

  // Re-apply settings whenever they change
  useEffect(() => {
    if (playerRef.current && playerRef.current.setVolume) {
      applySettings(playerRef.current);
    }
    // eslint-disable-next-line
  }, [settings]);

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
    <div className="video-container">
      <div ref={containerRef} id="yt-player" />
    </div>
  );
}
