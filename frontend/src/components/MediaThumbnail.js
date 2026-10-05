import React, { useEffect, useState } from 'react';
import { getSSMusicArtwork } from '../services/api';

export default function MediaThumbnail({ source, mediaPath, thumbnail, alt = '', className }) {
  const [artwork, setArtwork] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const isSSMusic = source === 'ssmusic';

  useEffect(() => {
    setArtwork(null);
    if (!isSSMusic || !mediaPath) return;
    const controller = new AbortController();
    let objectUrl;
    async function loadArtwork() {
      try {
        const { data } = await getSSMusicArtwork(mediaPath, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(data);
        setArtwork({ path: mediaPath, url: objectUrl });
      } catch {
        if (!controller.signal.aborted) setArtwork(null);
      }
    }
    loadArtwork();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isSSMusic, mediaPath]);

  if (isSSMusic ? !mediaPath : !thumbnail) return null;
  const imageUrl = isSSMusic ? (artwork?.path === mediaPath ? artwork.url : null) : thumbnail;
  if (!imageUrl || failedUrl === imageUrl) return <span className={className} aria-hidden="true" />;
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