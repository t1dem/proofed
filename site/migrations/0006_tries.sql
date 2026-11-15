-- "Break it yourself" (/try): a visitor opens one of a few prepared pull requests on the demo store
-- and watches the run. One at a time: a row with no finished_at is the run that's going.
CREATE TABLE tries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bug TEXT NOT NULL,               -- which prepared change (src/worker/try.ts)
  pr INTEGER,                      -- null for the moment between taking the slot and GitHub's answer
  branch TEXT,
  visitor TEXT NOT NULL,           -- hash of the address it came from, for the per-visitor limit
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX tries_started ON tries(started_at DESC);
