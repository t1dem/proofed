-- Tokens and keys are stored AES-GCM encrypted with the SECRETS_KEY Worker secret.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,          -- GitHub user id
  login TEXT NOT NULL,
  avatar TEXT,
  token TEXT,                      -- user-to-server token (encrypted)
  refresh TEXT,                    -- refresh token (encrypted)
  token_expires INTEGER,
  lt_username TEXT,
  lt_key TEXT,                     -- encrypted
  claude_token TEXT,               -- encrypted
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- The latest Proofed report per pull request, from the PR comment webhooks.
CREATE TABLE reports (
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  state TEXT NOT NULL,             -- failing | passing | fixing | blocked
  headline TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo, pr)
);
CREATE INDEX reports_updated ON reports(updated_at DESC);
