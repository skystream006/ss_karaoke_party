import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { getSSMusicPlayback, getSSMusicStreamUrl } from '../services/api';

export function activeCueIndex(cues, timeMs) {
  let low = 0;
  let high = cues.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].time <= timeMs) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}

export function SyltLyrics({ lyrics, currentTime, title, onSeek }) {
  const activeLineRef = useRef(null);
  const linesRef = useRef(null);
  const lines = useMemo(() => (lyrics?.lines || [])
    .filter((line) => Number.isFinite(line.time) && line.time >= 0 && typeof line.text === 'string')
    .slice().sort((a, b) => a.time - b.time), [lyrics]);
  const timeMs = currentTime * 1000;
  const active = activeCueIndex(lines, timeMs);

  useEffect(() => {
    const list = linesRef.current;
    const line = activeLineRef.current;
    if (!list) return;
    const top = line ? list.scrollTop + line.getBoundingClientRect().top - list.getBoundingClientRect().top
      - (list.clientHeight - line.clientHeight) / 2 : 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo?.({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <section className="sylt-screen" aria-label="Synchronized lyrics">
      <h2>{title}</h2>
      {lines.length ? (
        <div className="sylt-lines" ref={linesRef}>
          {lines.map((line, index) => (
            <button
              key={index}
              type="button"
              ref={index === active ? activeLineRef : null}
              className={`sylt-line${index === active ? ' active' : ''}${index < active ? ' sung' : ''}`}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => onSeek?.(line.time / 1000)}
              disabled={!onSeek}
            >
              {line.text || '♪'}
            </button>
          ))}
        </div>
      ) : (
        <div className="sylt-fallback">
          <p>{lyrics?.text || 'No synchronized lyrics available for this song.'}</p>
        </div>
      )}
    </section>
  );
}

const SSMusicPlayer = forwardRef(function SSMusicPlayer({ mediaPath, mediaType, title, paused, settings, onEnded, onTimeUpdate }, ref) {
  const mediaRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const lastProgressRef = useRef(-Infinity);
  const [playback, setPlayback] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState('');
  const [needsPlay, setNeedsPlay] = useState(false);

  const play = useCallback(() => {
    const promise = mediaRef.current?.play();
    promise?.then(() => setNeedsPlay(false)).catch((err) => {
      if (err.name !== 'AbortError') setNeedsPlay(true);
    });
  }, []);

  const publishTime = useCallback((force = false) => {
    const media = mediaRef.current;
    if (!media) return;
    setCurrentTime(media.currentTime);
    const now = performance.now();
    if (force || now - lastProgressRef.current >= 2000) {
      lastProgressRef.current = now;
      onTimeUpdateRef.current?.(media.currentTime, Number.isFinite(media.duration) ? media.duration : 0);
    }
  }, []);

  const seekTo = useCallback((seconds) => {
    if (!Number.isFinite(seconds) || !mediaRef.current) return;
    const media = mediaRef.current;
    media.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(media.duration) ? media.duration : seconds));
    publishTime(true);
  }, [publishTime]);

  useImperativeHandle(ref, () => ({
    seekTo,
    pauseVideo: () => mediaRef.current?.pause(),
    playVideo: play,
  }), [play, seekTo]);

  useEffect(() => {
    const controller = new AbortController();
    setPlayback(null);
    setCurrentTime(0);
    setError('');
    setNeedsPlay(false);
    getSSMusicPlayback(mediaPath, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setPlayback(data);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err.response?.data?.error || 'Unable to load ssMusic media.');
    });
    return () => controller.abort();
  }, [mediaPath]);

  const applySettings = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = Math.max(0, Math.min(100, settingsRef.current?.vocalLevel ?? 100)) / 100;
    media.playbackRate = Math.max(0.5, Math.min(2, settingsRef.current?.tempo ?? 1));
  }, []);

  useEffect(() => {
    applySettings();
  }, [settings, playback, applySettings]);

  useEffect(() => {
    if (paused) mediaRef.current?.pause();
    else if (playback) play();
  }, [paused, playback, play]);

  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (media) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    };
  }, [playback]);

  // Native timeupdate can be too coarse for closely spaced SYLT cues.
  useEffect(() => {
    if (!playback || paused) return;
    const interval = setInterval(() => {
      if (mediaRef.current && !mediaRef.current.paused) publishTime();
    }, 100);
    return () => clearInterval(interval);
  }, [playback, paused, publishTime]);

  const isVideo = (playback?.media_type || mediaType) === 'video';
  const Media = isVideo ? 'video' : 'audio';

  return (
    <div className={`ssmusic-player${isVideo ? ' ssmusic-video' : ''}`}>
      {!isVideo && <SyltLyrics lyrics={playback?.lyrics} currentTime={currentTime} title={title} onSeek={seekTo} />}
      {!playback && !error && <p className="ssmusic-notice" role="status">Loading ssMusic media…</p>}
      {error && <p className="ssmusic-notice" role="alert">{error}</p>}
      {playback && (
        <Media
          ref={mediaRef}
          src={getSSMusicStreamUrl(playback.stream_path)}
          controls
          playsInline
          preload="metadata"
          aria-label={title || 'ssMusic player'}
          onLoadedMetadata={() => {
            applySettings();
            publishTime(true);
            if (!pausedRef.current) play();
          }}
          onTimeUpdate={() => publishTime()}
          onSeeked={() => publishTime(true)}
          onPause={() => publishTime(true)}
          onEnded={onEnded}
          onError={() => setError('Unable to play this media. The file may be unavailable or its format unsupported by this browser.')}
        />
      )}
      {needsPlay && !paused && (
        <button className="nav-btn ssmusic-play-button" onClick={play}>Play song</button>
      )}
    </div>
  );
});

export default SSMusicPlayer;
