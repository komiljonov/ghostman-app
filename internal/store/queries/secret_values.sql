-- name: GetSecretValue :one
SELECT value FROM secret_values WHERE environment_id = ? AND key = ?;

-- name: ListSecretValues :many
SELECT key, value FROM secret_values WHERE environment_id = ? ORDER BY key;

-- name: PutSecretValue :exec
INSERT INTO secret_values (environment_id, key, value) VALUES (?, ?, ?)
ON CONFLICT (environment_id, key) DO UPDATE SET value = excluded.value;

-- name: DeleteSecretValue :exec
DELETE FROM secret_values WHERE environment_id = ? AND key = ?;

-- name: DeleteSecretValuesForEnvironment :exec
DELETE FROM secret_values WHERE environment_id = ?;

-- name: RenameSecretKey :exec
-- Moves a value to a new key; OR REPLACE drops a value already stored under it.
UPDATE OR REPLACE secret_values SET key = sqlc.arg(new_key)
WHERE environment_id = sqlc.arg(environment_id) AND key = sqlc.arg(old_key);
