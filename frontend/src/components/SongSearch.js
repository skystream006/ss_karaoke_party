import React, { useState } from 'react';
import { searchYouTube, addToQueue } from '../services/api';
import './SongSearch.css';

export default function SongSearch({ partyId, member, onAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState('');
  const [successId, setSuccessId] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const res = await searchYouTube(query.trim());
      setResults(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed. Make sure the YouTube API key is configured.');
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="song-search">
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
              <button
                className={`btn-add ${successId === video.video_id ? 'added' : ''}`}
                onClick={() => handleAdd(video)}
                disabled={adding === video.video_id || successId === video.video_id}
                title="Add to queue"
              >
                {successId === video.video_id ? '✓' : adding === video.video_id ? '…' : '+'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
