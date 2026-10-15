CREATE TABLE hostscreen_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('invalid_key', 'rate_limited'))
);