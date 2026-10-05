ALTER TABLE queue
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'youtube',
  ADD COLUMN media_path TEXT,
  ADD COLUMN media_type VARCHAR(10),
  ADD CONSTRAINT queue_source_check CHECK (source IN ('youtube', 'ssmusic')),
  ADD CONSTRAINT queue_media_check CHECK (
    (source = 'youtube' AND media_path IS NULL AND media_type IS NULL)
    OR
    (source = 'ssmusic' AND media_path IS NOT NULL AND media_path <> ''
      AND media_type IS NOT NULL AND media_type IN ('audio', 'video'))
  );
