-- name: InsertHistory :exec
INSERT INTO history (method, url, status, duration_ms, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: ListHistory :many
SELECT id, method, url, status, duration_ms, created_at
FROM history
ORDER BY created_at DESC, id DESC
LIMIT ?;
