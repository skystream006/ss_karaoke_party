ALTER TABLE hostscreen_login_attempts DROP CONSTRAINT hostscreen_login_attempts_outcome_check;
ALTER TABLE hostscreen_login_attempts ADD CONSTRAINT hostscreen_login_attempts_outcome_check
  CHECK (outcome IN ('invalid_key', 'rate_limited', 'success'));