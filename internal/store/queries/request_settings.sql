-- name: GetFollowRedirects :one
SELECT follow_redirects FROM request_settings WHERE request_id = ?;

-- name: PutFollowRedirects :exec
INSERT INTO request_settings (request_id, follow_redirects) VALUES (?, ?)
ON CONFLICT (request_id) DO UPDATE SET follow_redirects = excluded.follow_redirects;

-- name: DeleteFollowRedirects :exec
DELETE FROM request_settings WHERE request_id = ?;
