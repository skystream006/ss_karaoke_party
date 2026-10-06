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
export const duplicateParty = (partyId) => api.post(`/parties/${partyId}/duplicate`);
export const lockParty = (partyId, isLocked, memberId) => {
  const body = { is_locked: isLocked };
  if (memberId) body.member_id = memberId;
  return api.patch(`/parties/${partyId}/lock`, body);
};
export const getPartyMembers = (partyId) => api.get(`/parties/${partyId}/members`);
export const getMemberNames = () => api.get('/parties/members/names');
export const searchMembers = (name) => api.get(`/parties/members/search?name=${encodeURIComponent(name)}`);
export const getMember = (partyId, memberId) => api.get(`/parties/${partyId}/members/${memberId}`);
export const updateMember = (partyId, memberId, data) => api.patch(`/parties/${partyId}/members/${memberId}`, data);
export const removeMember = (partyId, memberId) => api.delete(`/parties/${partyId}/members/${memberId}`);

// Queue
export const getQueue = (partyId) => api.get(`/queue/${partyId}`);
export const addToQueue = (partyId, data) => api.post(`/queue/${partyId}`, data);
export const addNextToQueue = (partyId, data) => api.post(`/queue/${partyId}/play-next`, data);
export const removeFromQueue = (partyId, itemId) => api.delete(`/queue/${partyId}/${itemId}`);
export const reorderQueue = (partyId, order) => api.put(`/queue/${partyId}/reorder`, { order });
export const updateQueueItemStatus = (partyId, itemId, status) =>
  api.patch(`/queue/${partyId}/${itemId}/status`, { status });
export const updateQueueItemSinger = (partyId, itemId, data) =>
  api.patch(`/queue/${partyId}/${itemId}`, data);
export const resetQueue = (partyId) => api.patch(`/queue/${partyId}/reset`);

// YouTube search
export const searchYouTube = (query, karaoke = false) =>
  api.get(`/youtube/search?q=${encodeURIComponent(query)}&karaoke=${karaoke}`);

// YouTube video lookup by URL
export const getYouTubeVideoByUrl = (url) => api.get(`/youtube/video?url=${encodeURIComponent(url)}`);

// ssMusic requests go through the backend so the server's API key stays private.
export const searchSSMusic = (query, offset = 0, noVocalsOnly = true) =>
  api.get('/ssmusic/search', { params: { q: query, offset, NoVocalsOnly: noVocalsOnly } });
export const getSSMusicArtwork = (path, signal) =>
  api.get('/ssmusic/artwork', { params: { path }, responseType: 'blob', signal });
export const getSSMusicPlayback = (path, signal) =>
  api.get('/ssmusic/playback', { params: { path }, signal });
export const getSSMusicStreamUrl = (streamPath) => `${api.defaults.baseURL.replace(/\/$/, '')}${streamPath}`;

// Server info
export const getServerInfo = () => api.get('/server-info');

export default api;
