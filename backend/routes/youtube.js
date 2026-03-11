const express = require('express');
const router = express.Router();
const axios = require('axios');

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
