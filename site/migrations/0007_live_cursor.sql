-- Where Kane last clicked or typed on a live frame, as a fraction of its width and height (src/report/live.ts).
-- Null: no cursor on that frame, as before Kane's first action or once the page has changed.
ALTER TABLE live_frames ADD COLUMN x REAL;
ALTER TABLE live_frames ADD COLUMN y REAL;
