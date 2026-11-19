-- A run while it's going (src/report/live.ts at the repo root): the latest state per pull request, and the
-- latest frame of each scenario's Chrome. A new run (another Actions run id) starts both over.
CREATE TABLE live (
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  run TEXT NOT NULL,
  data TEXT NOT NULL,              -- Live as JSON (src/report/livefile.ts)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo, pr)
);

CREATE TABLE live_frames (
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  scenario TEXT NOT NULL,
  jpg BLOB NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (repo, pr, scenario)
);
