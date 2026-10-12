const { createSsmusicClient, SsmusicError } = require('./ssmusicClient');
const { parseMediaPath, mediaType, mediaId } = require('./ssmusicMedia');

const PENDING_STATUSES = ['submitting', 'queued', 'running'];

function readJob(data, expectedJobId) {
  if (!data || typeof data.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.jobId)
      || (expectedJobId && data.jobId !== expectedJobId) || typeof data.ready !== 'boolean'
      || typeof data.status !== 'string') {
    throw new SsmusicError(502, 'Invalid ssMusic job response');
  }
  if (!data.ready) {
    if (['queued', 'running'].includes(data.status)) {
      return { id: data.jobId, status: data.status, mediaPath: null };
    }
    throw new SsmusicError(409, data.status === 'failed'
      ? 'ssMusic job failed. Rerun it on ssMusic, then try again.'
      : 'ssMusic job has no playable video. Check the job on ssMusic, then try again.');
  }
  const stream = typeof data.playUrl === 'string'
    && /^\/api\/jobs\/([A-Za-z0-9_-]+)\/stream\/([^/?#]+)$/.exec(data.playUrl);
  let mediaPath;
  try {
    if (stream && stream[1] === data.jobId) mediaPath = `${data.jobId}/${decodeURIComponent(stream[2])}`;
  } catch {
    mediaPath = null;
  }
  if (!parseMediaPath(mediaPath) || mediaType(mediaPath) !== 'video') {
    throw new SsmusicError(502, 'Invalid ssMusic video stream');
  }
  return { id: data.jobId, status: 'completed', mediaPath };
}

function createSsmusicJobs({ pool, io, client = createSsmusicClient(), pollIntervalMs = 3000,
  schedule = setTimeout, cancel = clearTimeout }) {
  const tasks = new Map();
  const mutations = new Map();
  let closed = false;

  async function withPlaylistVideo(item, operation) {
    const key = `${item.party_id}:${item.youtube_video_id || item.video_id}`;
    const pending = (mutations.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    mutations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (mutations.get(key) === pending) mutations.delete(key);
    }
  }

  async function removeReference(item, database = pool) {
    if (!item.kpMedia) return null;
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.youtube_video_id || '')) {
      throw new SsmusicError(409, 'Original YouTube identity is missing for this kpMedia item');
    }
    const remaining = await database.query(
      `SELECT id FROM queue WHERE party_id = $1 AND id <> $2
       AND "kpMedia" = TRUE AND youtube_video_id = $3 LIMIT 1`,
      [item.party_id, item.id, item.youtube_video_id]
    );
    if (remaining.rows.length) return null;
    let response;
    try {
      response = await client.request('api/karaoke/jobs', {
        method: 'POST', data: { action: 'remove',
          videoURL: `https://www.youtube.com/watch?v=${item.youtube_video_id}`, playlistId: item.party_id },
      });
    } catch (error) {
      if (error instanceof SsmusicError && error.status === 409) {
        throw new SsmusicError(409, 'ssMusic could not remove the video. Check its access and wait for any running job to finish, then try again.');
      }
      throw error;
    }
    const data = response.data;
    if (response.status !== 200 || data?.action !== 'remove' || data.playlistId !== item.party_id
        || typeof data.removed !== 'boolean' || typeof data.videoDeleted !== 'boolean'
        || !Number.isSafeInteger(data.playlistCount) || data.playlistCount < 0) {
      throw new SsmusicError(502, 'Invalid ssMusic removal response');
    }
    return { removed: data.removed, videoDeleted: data.videoDeleted, playlistCount: data.playlistCount };
  }

  async function load(item) {
    const result = await pool.query('SELECT * FROM queue WHERE id = $1 AND party_id = $2', [item.id, item.party_id]);
    return result.rows[0] || null;
  }

  async function publish(partyId) {
    if (!io) return;
    const result = await pool.query('SELECT * FROM queue WHERE party_id = $1 ORDER BY position ASC', [partyId]);
    io.to(partyId).emit('queue:update', { action: 'media', queue: result.rows });
  }

  async function advance(task, submit) {
    let item = task.item;
    try {
      item = await load(item);
      if (closed || !item || item.source !== 'youtube') {
        tasks.delete(task.item.id);
        return item;
      }
      if (!/^[A-Za-z0-9_-]{11}$/.test(item.video_id)) {
        throw new SsmusicError(400, 'Invalid YouTube video ID');
      }
      const newSubmission = !item.kpMedia || !item.ssmusic_job_id || (submit && !PENDING_STATUSES.includes(item.ssmusic_status));
      if (newSubmission) {
        await pool.query(
          `UPDATE queue SET ssmusic_status = 'submitting', ssmusic_error = NULL,
                            "kpMedia" = TRUE, youtube_video_id = video_id
           WHERE id = $1 AND party_id = $2 AND source = 'youtube' AND video_id = $3`,
          [item.id, item.party_id, item.video_id]
        );
        await publish(item.party_id);
      }
      if (closed) return item;
      const response = await client.request(newSubmission ? 'api/karaoke/jobs'
        : `api/karaoke/jobs/${encodeURIComponent(item.ssmusic_job_id)}`, {
        method: newSubmission ? 'POST' : 'GET',
        data: newSubmission ? { action: 'add', videoURL: `https://www.youtube.com/watch?v=${item.video_id}`,
          playlistId: item.party_id } : undefined,
        signal: task.controller.signal,
      });
      if (closed) return item;
      if (newSubmission && (response.data?.action !== 'add' || response.data.playlistId !== item.party_id
          || !Number.isSafeInteger(response.data.playlistCount) || response.data.playlistCount < 1)) {
        throw new SsmusicError(502, 'Invalid ssMusic playlist add response');
      }
      const job = readJob(response.data, newSubmission ? null : item.ssmusic_job_id);
      const result = await pool.query(
        `UPDATE queue SET source = $1, video_id = $2, media_path = $3, media_type = $4,
                         video_thumbnail = $5, ssmusic_job_id = $6, ssmusic_status = $7, ssmusic_error = NULL
         WHERE id = $8 AND party_id = $9 AND source = 'youtube' AND video_id = $10 RETURNING *`,
        [job.mediaPath ? 'ssmusic' : 'youtube', job.mediaPath ? mediaId(job.mediaPath) : item.video_id,
          job.mediaPath, job.mediaPath ? 'video' : null, job.mediaPath ? null : item.video_thumbnail,
          job.id, job.status, item.id, item.party_id, item.video_id]
      );
      const updated = result.rows[0];
      if (!updated) {
        tasks.delete(item.id);
        return load(item);
      }
      await publish(item.party_id);
      if (job.mediaPath || closed) {
        tasks.delete(item.id);
      } else {
        task.timer = schedule(() => {
          task.timer = null;
          task.promise = withPlaylistVideo(task.item, () => advance(task, false));
          return task.promise.catch(() => {});
        }, pollIntervalMs);
        task.timer.unref?.();
      }
      return updated;
    } catch (error) {
      tasks.delete(task.item.id);
      const failure = error instanceof SsmusicError ? error : new SsmusicError(502, 'Failed to send video to ssMusic');
      if (!closed && item) {
        await pool.query(
          `UPDATE queue SET ssmusic_status = 'error', ssmusic_error = $1
           WHERE id = $2 AND party_id = $3 AND source = 'youtube' AND video_id = $4`,
          [failure.message, item.id, item.party_id, item.video_id]
        );
        await publish(item.party_id);
      }
      throw failure;
    }
  }

  function start(item, submit) {
    if (closed) return Promise.reject(new SsmusicError(503, 'ssMusic job worker is stopped'));
    const existing = tasks.get(item.id);
    if (existing) return existing.promise;
    const task = { item, controller: new AbortController(), timer: null, promise: null };
    tasks.set(item.id, task);
    task.promise = withPlaylistVideo(item, () => advance(task, submit));
    return task.promise;
  }

  return {
    withPlaylistVideo,
    removeReference,
    submit: (item) => start(item, true),
    async resume() {
      const result = await pool.query(
        `SELECT * FROM queue WHERE source = 'youtube' AND ssmusic_status IN ('submitting', 'queued', 'running')`
      );
      await Promise.allSettled(result.rows.map((item) => start(item, false)));
    },
    close() {
      closed = true;
      for (const task of tasks.values()) {
        if (task.timer !== null) cancel(task.timer);
        task.controller.abort();
      }
      tasks.clear();
    },
  };
}

module.exports = { createSsmusicJobs };