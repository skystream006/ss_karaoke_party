import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
});

// Parties
export const getParties = () => api.get('/parties');
export const createParty = (data) => api.post('/parties', data);
export const getParty = (id) => api.get(`/parties/${id}`);
export const joinParty = (partyId, data) => api.post(`/parties/${partyId}/join`, data);
export const getPartyByCode = (code) => api.get(`/parties/join/${code}`);
export const endParty = (partyId) => api.delete(`/parties/${partyId}`);

// Queue
export const getQueue = (partyId) => api.get(`/queue/${partyId}`);
export const addToQueue = (partyId, data) => api.post(`/queue/${partyId}`, data);
export const removeFromQueue = (partyId, itemId) => api.delete(`/queue/${partyId}/${itemId}`);
export const reorderQueue = (partyId, order) => api.put(`/queue/${partyId}/reorder`, { order });
export const updateQueueItemStatus = (partyId, itemId, status) =>
  api.patch(`/queue/${partyId}/${itemId}/status`, { status });

// YouTube search
export const searchYouTube = (query, karaoke = false) =>
  api.get(`/youtube/search?q=${encodeURIComponent(query)}&karaoke=${karaoke}`);

// YouTube video lookup by URL
export const getYouTubeVideoByUrl = (url) => api.get(`/youtube/video?url=${encodeURIComponent(url)}`);

export default api;
