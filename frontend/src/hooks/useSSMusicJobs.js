import { useCallback, useEffect, useRef, useState } from 'react';
import { sendQueueItemToSSMusic } from '../services/api';

const MEDIA_FIELDS = ['source', 'video_id', 'media_path', 'media_type', 'video_thumbnail',
  'ssmusic_job_id', 'ssmusic_status', 'ssmusic_error', 'kpMedia', 'youtube_video_id'];

export default function useSSMusicJobs(partyId, setQueue) {
  const [ssmusicState, setSSMusicState] = useState({});
  const requestsRef = useRef(new Map());

  useEffect(() => {
    const requests = requestsRef.current;
    setSSMusicState({});
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, [partyId]);

  const sendToSSMusic = useCallback(async (item) => {
    if ((item.source && item.source !== 'youtube') || requestsRef.current.has(item.id)
        || ['submitting', 'queued', 'running'].includes(item.ssmusic_status)) return;
    const controller = new AbortController();
    requestsRef.current.set(item.id, controller);
    setSSMusicState((current) => ({ ...current, [item.id]: { pending: true, error: '' } }));
    setQueue((current) => current.map((entry) => entry.id === item.id && entry.source !== 'ssmusic'
      ? { ...entry, ssmusic_status: 'submitting', ssmusic_error: null } : entry));
    let message = '';
    try {
      const { data } = await sendQueueItemToSSMusic(partyId, item.id, controller.signal);
      if (controller.signal.aborted) return;
      if (data?.id !== item.id || !['youtube', 'ssmusic'].includes(data.source)) throw new Error('Invalid queue response');
      const media = Object.fromEntries(MEDIA_FIELDS.map((field) => [field, data[field]]));
      setQueue((current) => current.map((entry) => {
        if (entry.id !== item.id || entry.source === 'ssmusic' || entry.video_id !== item.video_id) return entry;
        if (data.source !== 'ssmusic' && (entry.ssmusic_status === 'error'
            || (entry.ssmusic_status === 'running' && data.ssmusic_status === 'queued'))) return entry;
        return { ...entry, ...media };
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      message = typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Failed to send video to ssMusic. Please try again.';
      setQueue((current) => current.map((entry) => entry.id === item.id && entry.source !== 'ssmusic'
        && entry.video_id === item.video_id ? { ...entry, ssmusic_status: 'error', ssmusic_error: message } : entry));
    } finally {
      if (requestsRef.current.get(item.id) === controller) {
        requestsRef.current.delete(item.id);
        setSSMusicState((current) => ({ ...current, [item.id]: { pending: false, error: message } }));
      }
    }
  }, [partyId, setQueue]);

  return { sendToSSMusic, ssmusicState };
}