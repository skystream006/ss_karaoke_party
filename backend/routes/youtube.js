const express = require('express');
const router = express.Router();
const axios = require('axios');

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// Extract a YouTube video ID from common URL formats
function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    // youtu.be/<id>
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('?')[0] || null;
    }
    // youtube.com/shorts/<id>
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    // youtube.com/embed/<id>
    const embedMatch = parsed.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    // youtube.com/watch?v=<id>
    const v = parsed.searchParams.get('v');
    if (v && VIDEO_ID_PATTERN.test(v)) return v;
  } catch {
    // Not a valid URL
  }
  // Plain video ID
  if (VIDEO_ID_PATTERN.test(url.trim())) return url.trim();
  return null;
}

// GET /api/youtube/video?url=<url> - Fetch video details by YouTube URL
router.get('/video', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Query parameter url is required' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'YouTube API key not configured' });
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet',
        id: videoId,
        key: apiKey,
      },
    });

    const item = response.data.items?.[0];
    if (!item) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({
      video_id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails.medium?.url ||
        item.snippet.thumbnails.default?.url,
    });
  } catch (err) {
    console.error('YouTube video lookup error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch video details' });
  }
});

// GET /api/youtube/search?q=<query> - Search YouTube videos
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'YouTube API key not configured' });
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: `${q} karaoke`,
        type: 'video',
        maxResults: 20,
        key: apiKey,
        videoCategoryId: '10', // Music category
      },
    });

    const results = response.data.items.map((item) => ({
      video_id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      published_at: item.snippet.publishedAt,
    }));

    res.json(results);
  } catch (err) {
    console.error('YouTube search error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});

module.exports = router;
