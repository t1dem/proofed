-- "Fix with Claude" and "Run again" from the dashboard: the pull request shows the run is on its way
-- until the workflow's next comment (see markAsked in src/worker/runs.ts).
ALTER TABLE reports ADD COLUMN asked TEXT;
ALTER TABLE reports ADD COLUMN asked_at INTEGER;
