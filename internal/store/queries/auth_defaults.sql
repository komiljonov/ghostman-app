-- name: GetAuthDefault :one
SELECT fields_json FROM auth_defaults WHERE project_id = ? AND auth_type = ?;

-- name: PutAuthDefault :exec
INSERT INTO auth_defaults (project_id, auth_type, fields_json, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT (project_id, auth_type) DO UPDATE SET fields_json = excluded.fields_json, updated_at = excluded.updated_at;
