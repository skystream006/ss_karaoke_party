CREATE TABLE auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX auth_users_name_unique ON auth_users (LOWER(name));

CREATE TABLE auth_credentials (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB NOT NULL DEFAULT '[]',
  rp_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX auth_credentials_user ON auth_credentials(user_id);

ALTER TABLE party_members ADD COLUMN user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX party_members_account ON party_members(party_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE,
  member_id UUID REFERENCES party_members(id) ON DELETE CASCADE,
  host_session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE,
  invitation_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (user_id IS NOT NULL AND party_id IS NULL AND member_id IS NULL AND host_session_id IS NULL AND invitation_id IS NULL)
    OR
    (user_id IS NULL AND party_id IS NOT NULL AND member_id IS NOT NULL AND host_session_id IS NOT NULL AND invitation_id IS NOT NULL)
  )
);

CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_host ON auth_sessions(host_session_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE party_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  host_member_id UUID NOT NULL REFERENCES party_members(id) ON DELETE CASCADE,
  host_session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX party_invitations_host ON party_invitations(host_session_id, host_member_id);
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_invitation
  FOREIGN KEY (invitation_id) REFERENCES party_invitations(id) ON DELETE CASCADE;
CREATE INDEX auth_sessions_invitation ON auth_sessions(invitation_id);