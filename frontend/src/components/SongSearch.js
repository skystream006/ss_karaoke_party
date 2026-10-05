import React, { useState, useEffect, useRef } from 'react';
import ClearableInput from './ClearableInput';
import MediaThumbnail from './MediaThumbnail';
import { searchYouTube, searchSSMusic, getYouTubeVideoByUrl, addToQueue, addNextToQueue } from '../services/api';
import './SongSearch.css';

export default function SongSearch({ partyId, member, onAdded }) {
  const [tab, setTab] = useState('search');

  // Search tab state
  const [query, setQuery] = useState('');
  const [karaokeOnly, setKaraokeOnly] = useState(false);
  const [ssMusicSearch, setSSMusicSearch] = useState(false);
  const [results, setResults] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const [playingNext, setPlayingNext] = useState(null);
  const [error, setError] = useState('');
  const [successId, setSuccessId] = useState(null);
  const [playNextSuccessId, setPlayNextSuccessId] = useState(null);

  // URL tab state
  const [urlInput, setUrlInput] = useState('');
  const [urlVideo, setUrlVideo] = useState(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlAdding, setUrlAdding] = useState(false);
  const [urlPlayingNext, setUrlPlayingNext] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [urlSuccess, setUrlSuccess] = useState(false);
  const [urlPlayNextSuccess, setUrlPlayNextSuccess] = useState(false);

  const hasSearched = useRef(false);
  const searchRequest = useRef(0);
  const submittedQuery = useRef('');

  const runSearch = async (q, karaoke, ssMusic, offset = 0) => {
    const request = ++searchRequest.current;
    setLoading(true);
    setError('');
    if (!offset) setResults([]);
    setNextOffset(null);
    try {
      const res = ssMusic ? await searchSSMusic(q, offset) : await searchYouTube(q, karaoke);
      if (request !== searchRequest.current) return;
      const items = ssMusic ? res.data.items : res.data;
      setResults((previous) => offset ? [...previous, ...items] : items);
      const next = offset + (ssMusic ? res.data.limit : 0);
      setNextOffset(ssMusic && items.length > 0 && next < res.data.total ? next : null);
    } catch (err) {
      if (request !== searchRequest.current) return;
      setError(err.response?.data?.error || `Search failed. Make sure the ${ssMusic ? 'ssMusic server and' : 'YouTube'} API key is configured.`);
      if (offset) setNextOffset(offset);
    } finally {
      if (request === searchRequest.current) setLoading(false);
    }
  };

  useEffect(() => () => { searchRequest.current += 1; }, []);

  const handleQueryChange = (e) => {
    setQuery(e.target.value);
    if (!e.target.value) {
      searchRequest.current += 1;
      setLoading(false);
      setResults([]);
      setNextOffset(null);
      setError('');
      hasSearched.current = false;
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    hasSearched.current = true;
    submittedQuery.current = query.trim();
    runSearch(submittedQuery.current, karaokeOnly, ssMusicSearch);
  };

  // Re-run the last search when the source or karaoke toggle changes.
  useEffect(() => {
    setSuccessId(null);
    setPlayNextSuccessId(null);
    if (hasSearched.current) {
      runSearch(submittedQuery.current, karaokeOnly, ssMusicSearch);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [karaokeOnly, ssMusicSearch]);

  const handleAdd = async (video) => {
    setAdding(video.video_id);
    try {
      await addToQueue(partyId, {
        member_id: member?.id || null,
        singer_name: member?.name || 'Guest',
        video_id: video.video_id,
        video_title: video.title,
        video_thumbnail: video.thumbnail,
        ...(video.source === 'ssmusic' && {
          source: video.source, media_path: video.media_path, media_type: video.media_type,
        }),
      });
      setSuccessId(video.video_id);
      setTimeout(() => setSuccessId(null), 2000);
      if (onAdded) onAdded();
    } catch (err) {
      setError('Failed to add song. Please try again.');
    } finally {
      setAdding(null);
    }
  };

  const handlePlayNext = async (video) => {
    setPlayingNext(video.video_id);
    try {
      await addNextToQueue(partyId, {
        member_id: member?.id || null,
        singer_name: member?.name || 'Guest',
        video_id: video.video_id,
        video_title: video.title,
        video_thumbnail: video.thumbnail,
        ...(video.source === 'ssmusic' && {
          source: video.source, media_path: video.media_path, media_type: video.media_type,
        }),
      });
      setPlayNextSuccessId(video.video_id);
      setTimeout(() => setPlayNextSuccessId(null), 2000);
      if (onAdded) onAdded();
    } catch (err) {
      setError('Failed to add song. Please try again.');
    } finally {
      setPlayingNext(null);
    }
  };

  const handleUrlLookup = async (e) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    setUrlError('');
    setUrlVideo(null);
    setUrlSuccess(false);
    try {
      const res = await getYouTubeVideoByUrl(urlInput.trim());
      setUrlVideo(res.data);
    } catch (err) {
      setUrlError(err.response?.data?.error || 'Could not find video. Please check the URL and try again.');
    } finally {
      setUrlLoading(false);
    }
  };

  const handleUrlInputChange = (e) => {
    setUrlInput(e.target.value);
    setUrlVideo(null);
    setUrlError('');
  };

  const handleUrlAdd = async () => {
    if (!urlVideo) return;
    setUrlAdding(true);
    try {
      await addToQueue(partyId, {
        member_id: member?.id || null,
        singer_name: member?.name || 'Guest',
        video_id: urlVideo.video_id,
        video_title: urlVideo.title,
        video_thumbnail: urlVideo.thumbnail,
      });
      setUrlSuccess(true);
      setUrlVideo(null);
      setUrlInput('');
      setTimeout(() => setUrlSuccess(false), 2000);
      if (onAdded) onAdded();
    } catch (err) {
      setUrlError('Failed to add song. Please try again.');
    } finally {
      setUrlAdding(false);
    }
  };

  const handleUrlPlayNext = async () => {
    if (!urlVideo) return;
    setUrlPlayingNext(true);
    try {
      await addNextToQueue(partyId, {
        member_id: member?.id || null,
        singer_name: member?.name || 'Guest',
        video_id: urlVideo.video_id,
        video_title: urlVideo.title,
        video_thumbnail: urlVideo.thumbnail,
      });
      setUrlPlayNextSuccess(true);
      setUrlVideo(null);
      setUrlInput('');
      setTimeout(() => setUrlPlayNextSuccess(false), 2000);
      if (onAdded) onAdded();
    } catch (err) {
      setUrlError('Failed to add song. Please try again.');
    } finally {
      setUrlPlayingNext(false);
    }
  };

  return (
    <div className="song-search">
      <div className="search-tabs">
        <button
          className={`search-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => setTab('search')}
          type="button"
        >
          🔍 Search
        </button>
        <button
          className={`search-tab ${tab === 'url' ? 'active' : ''}`}
          onClick={() => setTab('url')}
          type="button"
        >
          🔗 YouTube URL
        </button>
      </div>

      {tab === 'search' && (
        <>
          <form className="search-form" onSubmit={handleSearch}>
            <ClearableInput
              type="text"
              placeholder="Search for a song…"
              value={query}
              onChange={handleQueryChange}
              className="search-input"
            />
            <button type="submit" className="btn btn-primary search-btn" disabled={loading || !query.trim()}>
              {loading ? '…' : '🔍'}
            </button>
          </form>

          <label className="karaoke-toggle">
            <input
              type="checkbox"
              checked={ssMusicSearch}
              onChange={(e) => setSSMusicSearch(e.target.checked)}
            />
            ssMusic Search
          </label>
          <label className="karaoke-toggle">
            <input
              type="checkbox"
              checked={karaokeOnly}
              disabled={ssMusicSearch}
              onChange={(e) => setKaraokeOnly(e.target.checked)}
            />
            🎤 Karaoke versions only
          </label>
          {ssMusicSearch && <p className="muted">Search your ssMusic library. The karaoke filter applies only to YouTube.</p>}

          {error && <div className="error-msg">{error}</div>}
          {!loading && !error && hasSearched.current && results.length === 0 && <p className="muted">No songs found.</p>}

          {results.length > 0 && (
            <ul className="search-results">
              {results.map((video) => (
                <li key={video.video_id} className="search-result-item">
                  <MediaThumbnail source={video.source} mediaPath={video.media_path}
                    thumbnail={video.thumbnail} alt={video.title} className="result-thumb" />
                  <div className="result-info">
                    <p className="result-title">{video.title}</p>
                    <p className="result-channel">{video.channel}</p>
                  </div>
                  <div className="result-actions">
                    <button
                      className={`btn-play-next ${playNextSuccessId === video.video_id ? 'added' : ''}`}
                      onClick={() => handlePlayNext(video)}
                      disabled={playingNext === video.video_id || playNextSuccessId === video.video_id}
                      title="Play next"
                    >
                      {playNextSuccessId === video.video_id ? '✓' : playingNext === video.video_id ? '…' : '⏭'}
                    </button>
                    <button
                      className={`btn-add ${successId === video.video_id ? 'added' : ''}`}
                      onClick={() => handleAdd(video)}
                      disabled={adding === video.video_id || successId === video.video_id}
                      title="Add to queue"
                    >
                      {successId === video.video_id ? '✓' : adding === video.video_id ? '…' : '+'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {nextOffset !== null && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={() => runSearch(submittedQuery.current, karaokeOnly, ssMusicSearch, nextOffset)}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      {tab === 'url' && (
        <>
          <form className="search-form" onSubmit={handleUrlLookup}>
            <ClearableInput
              type="text"
              placeholder="Paste a YouTube URL…"
              value={urlInput}
              onChange={handleUrlInputChange}
              className="search-input"
            />
            <button type="submit" className="btn btn-primary search-btn" disabled={urlLoading || !urlInput.trim()}>
              {urlLoading ? '…' : '🔍'}
            </button>
          </form>

          {urlError && <div className="error-msg">{urlError}</div>}
          {urlSuccess && <div className="success-msg">✓ Added to queue!</div>}
          {urlPlayNextSuccess && <div className="success-msg">✓ Playing next!</div>}

          {urlVideo && (
            <div className="url-preview">
              {urlVideo.thumbnail && (
                <img src={urlVideo.thumbnail} alt={urlVideo.title} className="result-thumb" loading="lazy" />
              )}
              <div className="result-info">
                <p className="result-title">{urlVideo.title}</p>
                <p className="result-channel">{urlVideo.channel}</p>
              </div>
              <div className="result-actions">
                <button
                  className="btn-play-next"
                  onClick={handleUrlPlayNext}
                  disabled={urlPlayingNext}
                  title="Play next"
                >
                  {urlPlayingNext ? '…' : '⏭'}
                </button>
                <button
                  className="btn-add"
                  onClick={handleUrlAdd}
                  disabled={urlAdding}
                  title="Add to queue"
                >
                  {urlAdding ? '…' : '+'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
