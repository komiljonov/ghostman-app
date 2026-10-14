-- name: ListRequestFiles :many
SELECT field_key, path FROM request_files WHERE request_id = ? ORDER BY field_key;

-- name: PutRequestFile :exec
INSERT INTO request_files (request_id, field_key, path) VALUES (?, ?, ?)
ON CONFLICT (request_id, field_key) DO UPDATE SET path = excluded.path;

-- name: DeleteRequestFile :exec
DELETE FROM request_files WHERE request_id = ? AND field_key = ?;

-- name: RenameRequestFileKey :exec
-- Moves a path to a new key; OR REPLACE drops a path already stored under it.
UPDATE OR REPLACE request_files SET field_key = sqlc.arg(new_key)
WHERE request_id = sqlc.arg(request_id) AND field_key = sqlc.arg(old_key);
