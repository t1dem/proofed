-- The pull request's latest commit, from the push webhook: the one Kane is checking before its run
-- reports, shown at the top of the pull request's runs.
ALTER TABLE reports ADD COLUMN head_sha TEXT;
