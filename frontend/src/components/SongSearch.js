import React, { useState, useEffect, useRef } from 'react';
import { searchYouTube, getYouTubeVideoByUrl, addToQueue, addNextToQueue } from '../services/api';
import './SongSearch.css';

export default function SongSearch({ partyId, member, onAdded }) {
  const [tab, setTab] = useState('search');

  // Search tab state
  const [query, setQuery] = useState('');
  const [karaokeOnly, setKaraokeOnly] = useState(false);
  const [results, setResults] = useState([]);
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

  const runSearch = async (q, karaoke) => {
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const res = await searchYouTube(q, karaoke);
      setResults(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed. Make sure the YouTube API key is configured.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    hasSearched.current = true;
    runSearch(query.trim(), karaokeOnly);
  };

  // Re-run search when karaoke toggle changes, but only if a search has been performed
  useEffect(() => {
    if (hasSearched.current && query.trim()) {
      runSearch(query.trim(), karaokeOnly);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [karaokeOnly]);

  const handleAdd = async (video) => {
    setAdding(video.video_id);
    try {
      await addToQueue(partyId, {
        member_id: member?.id || null,
        singer_name: member?.name || 'Guest',
        video_id: video.video_id,
        video_title: video.title,
        video_thumbnail: video.thumbnail,
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
            <input
              type="text"
              placeholder="Search for a song…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="btn btn-primary search-btn" disabled={loading || !query.trim()}>
              {loading ? '…' : '🔍'}
            </button>
          </form>

          <label className="karaoke-toggle">
            <input
              type="checkbox"
              checked={karaokeOnly}
              onChange={(e) => setKaraokeOnly(e.target.checked)}
            />
            🎤 Karaoke versions only
          </label>

          {error && <div className="error-msg">{error}</div>}

          {results.length > 0 && (
            <ul className="search-results">
              {results.map((video) => (
                <li key={video.video_id} className="search-result-item">
                  {video.thumbnail && (
                    <img src={video.thumbnail} alt={video.title} className="result-thumb" />
                  )}
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
        </>
      )}

      {tab === 'url' && (
        <>
          <form className="search-form" onSubmit={handleUrlLookup}>
            <input
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
                <img src={urlVideo.thumbnail} alt={urlVideo.title} className="result-thumb" />
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
