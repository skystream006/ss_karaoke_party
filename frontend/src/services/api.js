import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
});

// Attach auth token to every request
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('authToken');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Parties
export const getParties = () => api.get('/parties');
export const getAllParties = () => api.get('/parties/all');
export const createParty = (data) => api.post('/parties', data);
export const getParty = (id) => api.get(`/parties/${id}`);
export const updateParty = (id, data) => api.patch(`/parties/${id}`, data);
export const joinParty = (partyId, data) => api.post(`/parties/${partyId}/join`, data);
export const getPartyByCode = (code) => api.get(`/parties/join/${code}`);
export const endParty = (partyId) => api.delete(`/parties/${partyId}`);
export const deleteParty = (partyId) => api.delete(`/parties/${partyId}/remove`);
export const reactivateParty = (partyId) => api.patch(`/parties/${partyId}/reactivate`);
export const getPartyMembers = (partyId) => api.get(`/parties/${partyId}/members`);
export const searchMembers = (name) => api.get(`/parties/members/search?name=${encodeURIComponent(name)}`);
export const updateMember = (partyId, memberId, data) => api.patch(`/parties/${partyId}/members/${memberId}`, data);
export const removeMember = (partyId, memberId) => api.delete(`/parties/${partyId}/members/${memberId}`);

// Queue
export const getQueue = (partyId) => api.get(`/queue/${partyId}`);
export const addToQueue = (partyId, data) => api.post(`/queue/${partyId}`, data);
export const removeFromQueue = (partyId, itemId) => api.delete(`/queue/${partyId}/${itemId}`);
export const reorderQueue = (partyId, order) => api.put(`/queue/${partyId}/reorder`, { order });
export const updateQueueItemStatus = (partyId, itemId, status) =>
  api.patch(`/queue/${partyId}/${itemId}/status`, { status });
export const resetQueue = (partyId) => api.patch(`/queue/${partyId}/reset`);

// YouTube search
export const searchYouTube = (query, karaoke = false) =>
  api.get(`/youtube/search?q=${encodeURIComponent(query)}&karaoke=${karaoke}`);

// YouTube video lookup by URL
export const getYouTubeVideoByUrl = (url) => api.get(`/youtube/video?url=${encodeURIComponent(url)}`);

/**
 * Build a URL for the server-side pitch-shifted audio stream.
 * The ?t= query parameter carries the auth token so the URL can be used
 * directly as an <audio> element's src attribute (which cannot set headers).
 *
 * @param {string} videoId  YouTube video ID
 * @param {number} key      Semitone shift (non-zero integer, -6 to +6)
 * @param {number} startSec Start offset in seconds (for seeking)
 * @returns {string} Full URL for the audio stream
 */
export function buildAudioUrl(videoId, key, startSec = 0) {
  const token = sessionStorage.getItem('authToken') || '';
  const base = process.env.REACT_APP_API_URL || '/api';
  const params = new URLSearchParams({
    key: String(key),
    start: String(Math.floor(Math.max(0, startSec))),
  });
  if (token) params.set('t', token);
  return `${base}/audio/${videoId}?${params}`;
}

// Server info
export const getServerInfo = () => api.get('/server-info');

export default api;
