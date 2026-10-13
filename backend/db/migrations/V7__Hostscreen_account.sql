ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check CHECK (role IN ('admin', 'member', 'hostscreen'));

INSERT INTO auth_users (name, role, status) VALUES ('HOSTSCREEN', 'hostscreen', 'approved');
CREATE UNIQUE INDEX auth_users_hostscreen ON auth_users(role) WHERE role = 'hostscreen';