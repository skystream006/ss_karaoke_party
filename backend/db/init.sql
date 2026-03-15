-- Karaoke Party Database Schema

CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  join_code VARCHAR(8) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_locked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS party_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'guest', -- 'organizer' or 'guest'
  joined_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  member_id UUID REFERENCES party_members(id) ON DELETE SET NULL,
  singer_name VARCHAR(255) NOT NULL,
  video_id VARCHAR(50) NOT NULL,
  video_title VARCHAR(500) NOT NULL,
  video_thumbnail VARCHAR(500),
  position INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'queued', -- 'queued', 'playing'
  added_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_party_id ON queue(party_id);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(party_id, position);
CREATE INDEX IF NOT EXISTS idx_parties_join_code ON parties(join_code);
