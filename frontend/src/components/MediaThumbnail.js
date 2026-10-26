import React, { useEffect, useRef, useState } from 'react';
import { getSSMusicArtwork } from '../services/api';

const artworkCache = new Map();
const MAX_IDLE_ITEMS = 32;
const MAX_IDLE_BYTES = 8 * 1024 * 1024;

function trimArtworkCache() {
  const idle = [...artworkCache.entries()].filter(([, entry]) => !entry.users && entry.blob);
  let bytes = idle.reduce((total, [, entry]) => total + entry.blob.size, 0);
  let count = idle.length;
  for (const [key, entry] of idle) {
    if (count <= MAX_IDLE_ITEMS && bytes <= MAX_IDLE_BYTES) break;
    artworkCache.delete(key);
    bytes -= entry.blob.size;
    count -= 1;
  }
}

function acquireArtwork(mediaPath) {
  const key = JSON.stringify([sessionStorage.getItem('authToken'), mediaPath]);
  let entry = artworkCache.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: 0, blob: null, url: null };
    entry.promise = (async () => {
      const { data } = await getSSMusicArtwork(mediaPath, controller.signal);
      if (controller.signal.aborted) return null;
      entry.blob = data;
      entry.url = URL.createObjectURL(data);
      return entry;
    })().catch((error) => {
      if (artworkCache.get(key) === entry) artworkCache.delete(key);
      throw error;
    });
  }
  artworkCache.delete(key);
  artworkCache.set(key, entry);
  entry.users += 1;
  if (entry.blob && !entry.url) entry.url = URL.createObjectURL(entry.blob);
  return {
    promise: entry.promise,
    release: () => {
      entry.users -= 1;
      if (entry.users) return;
      if (entry.url) {
        URL.revokeObjectURL(entry.url);
        entry.url = null;
      }
      if (!entry.blob) {
        entry.controller.abort();
        if (artworkCache.get(key) === entry) artworkCache.delete(key);
      }
      trimArtworkCache();
    },
  };
}

export default function MediaThumbnail({ source, mediaPath, thumbnail, alt = '', className }) {
  const placeholderRef = useRef(null);
  const [artwork, setArtwork] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const isSSMusic = source === 'ssmusic';

  useEffect(() => {
    setArtwork(null);
    if (!isSSMusic || !mediaPath) return;
    let disposed = false;
    let request;
    const loadArtwork = () => {
      if (disposed || request) return;
      request = acquireArtwork(mediaPath);
      request.promise.then((entry) => {
        if (!disposed && entry) setArtwork({ path: mediaPath, url: entry.url });
      }).catch(() => {
        if (!disposed) setArtwork(null);
      });
    };
    let observer;
    if (typeof IntersectionObserver === 'undefined') loadArtwork();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadArtwork();
        }
      }, { rootMargin: '200px' });
      observer.observe(placeholderRef.current);
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      request?.release();
    };
  }, [isSSMusic, mediaPath]);

  if (isSSMusic ? !mediaPath : !thumbnail) return null;
  const imageUrl = isSSMusic ? (artwork?.path === mediaPath ? artwork.url : null) : thumbnail;
  if (!imageUrl || failedUrl === imageUrl) return <span ref={placeholderRef} className={className} aria-hidden="true" />;
  return (
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailedUrl(imageUrl)}
    />
  );
}