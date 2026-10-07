-- The request_settings table held per-request follow-redirects overrides before
-- the setting moved to the server. These queries only serve the one-time push of
-- leftover rows to the server (then the table is dropped). PutFollowRedirects
-- only seeds tests.

-- name: ListRequestSettings :many
SELECT request_id, follow_redirects FROM request_settings ORDER BY request_id;

-- name: PutFollowRedirects :exec
INSERT INTO request_settings (request_id, follow_redirects) VALUES (?, ?)
ON CONFLICT (request_id) DO UPDATE SET follow_redirects = excluded.follow_redirects;
