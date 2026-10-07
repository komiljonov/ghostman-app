-- name: InsertHistory :one
INSERT INTO history (
    created_at, project_id, request_id, request_name, method, url_template, url_resolved,
    env_id, env_name, req_headers_json, req_params_json, req_body_json,
    req_headers_resolved_json, req_body_resolved, status, duration_ms, error,
    resp_headers_json, resp_body, resp_body_size, resp_truncated, timings_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: ListHistoryPage :many
-- SUMMARY COLUMNS ONLY: never resp_body or the request JSON / resolved blobs
-- (rows can carry tens of MB). Filters run here (text: plain, case-insensitive
-- substring via instr - no wildcards to escape); keyset pagination on
-- (created_at, id) - before_created = 0 starts at the newest.
SELECT id, created_at, project_id, request_id, request_name, method, url_template, url_resolved,
       env_name, status, duration_ms, error, resp_body_size, resp_truncated
FROM history
WHERE (CAST(sqlc.arg(project_id) AS TEXT) = '' OR project_id = sqlc.arg(project_id))
  AND (CAST(sqlc.arg(method) AS TEXT) = '' OR method = sqlc.arg(method))
  AND (CAST(sqlc.arg(status_min) AS INTEGER) = 0
       OR (sqlc.arg(status_min) = -1 AND status = 0)
       OR (status BETWEEN sqlc.arg(status_min) AND CAST(sqlc.arg(status_max) AS INTEGER)))
  AND (CAST(sqlc.arg(needle) AS TEXT) = ''
       OR instr(lower(coalesce(url_resolved, '')), lower(sqlc.arg(needle))) > 0
       OR instr(lower(url_template), lower(sqlc.arg(needle))) > 0
       OR instr(lower(coalesce(request_name, '')), lower(sqlc.arg(needle))) > 0)
  AND (CAST(sqlc.arg(before_created) AS INTEGER) = 0
       OR created_at < sqlc.arg(before_created)
       OR (created_at = sqlc.arg(before_created) AND id < CAST(sqlc.arg(before_id) AS INTEGER)))
ORDER BY created_at DESC, id DESC
LIMIT CAST(sqlc.arg(page_limit) AS INTEGER);

-- name: GetHistoryEntry :one
SELECT * FROM history WHERE id = ?;

-- name: DeleteHistoryEntry :execrows
DELETE FROM history WHERE id = ?;

-- name: CountHistory :one
SELECT count(*) FROM history;

-- name: PruneHistory :execrows
-- Keep the newest n entries.
DELETE FROM history WHERE id IN (
    SELECT id FROM history ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
);

-- name: DeleteAllHistory :execrows
DELETE FROM history;

-- name: DeleteHistoryBefore :execrows
DELETE FROM history WHERE created_at < ?;

-- name: DeleteHistoryForProject :execrows
DELETE FROM history WHERE project_id = ?;
