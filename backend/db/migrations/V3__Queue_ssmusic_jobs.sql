ALTER TABLE queue
  ADD COLUMN ssmusic_job_id TEXT,
  ADD COLUMN ssmusic_status VARCHAR(20),
  ADD COLUMN ssmusic_error TEXT;