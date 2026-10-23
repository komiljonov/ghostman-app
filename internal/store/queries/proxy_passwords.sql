-- name: GetProxyPassword :one
SELECT password FROM proxy_passwords WHERE proxy_id = ?;

-- name: PutProxyPassword :exec
INSERT INTO proxy_passwords (proxy_id, password) VALUES (?, ?)
ON CONFLICT (proxy_id) DO UPDATE SET password = excluded.password;

-- name: DeleteProxyPassword :exec
DELETE FROM proxy_passwords WHERE proxy_id = ?;
