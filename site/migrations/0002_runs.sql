ALTER TABLE reports ADD COLUMN title TEXT;
ALTER TABLE reports ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;

-- One row per published report: the run file the action leaves next to its clips
-- on the proofed-clips branch (see src/worker/runs.ts).
CREATE TABLE runs (
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  key TEXT NOT NULL,               -- folder on proofed-clips: pr-<n>/<sha7>-<run id>
  sha TEXT NOT NULL,
  data TEXT NOT NULL,              -- RunFile as JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo, pr, key)
);
CREATE INDEX runs_pr ON runs(repo, pr, created_at DESC);
