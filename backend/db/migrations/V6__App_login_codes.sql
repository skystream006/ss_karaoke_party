CREATE TABLE auth_app_codes (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  redirect_uri TEXT NOT NULL CHECK (redirect_uri = 'com.sskaraoke.player:/oauth/callback'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_app_codes_user ON auth_app_codes(user_id);
CREATE INDEX auth_app_codes_expiry ON auth_app_codes(expires_at);