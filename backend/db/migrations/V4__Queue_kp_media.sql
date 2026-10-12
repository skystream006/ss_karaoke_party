ALTER TABLE queue
  ADD COLUMN "kpMedia" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN youtube_video_id VARCHAR(11),
  ADD CONSTRAINT queue_kp_media_check CHECK (
    NOT "kpMedia" OR (youtube_video_id IS NOT NULL AND youtube_video_id ~ '^[A-Za-z0-9_-]{11}$')
  );