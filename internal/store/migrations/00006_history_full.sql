-- +goose Up
-- Full local history: request (template AND resolved form), response, timings.
-- Replaces the skeleton-era table; old rows keep method / url (→ url_template) /
-- status / duration / created_at, everything new is NULL. Local only, never synced.
-- The resolved columns include secret values ON PURPOSE (this machine only).
CREATE TABLE history_full (
    id                        INTEGER PRIMARY KEY,
    created_at                INTEGER NOT NULL,          -- Unix epoch ms (UTC)
    project_id                TEXT,                      -- origin; the request may be deleted later
    request_id                TEXT,
    request_name              TEXT,
    method                    TEXT    NOT NULL,
    url_template              TEXT    NOT NULL,          -- as authored ({{vars}})
    url_resolved              TEXT,                      -- as sent (query included)
    env_id                    TEXT,
    env_name                  TEXT,
    req_headers_json          TEXT,                      -- template form, every row as authored
    req_params_json           TEXT,
    req_body_json             TEXT,
    req_headers_resolved_json TEXT,                      -- resolved form, as sent
    req_body_resolved         TEXT,
    status                    INTEGER NOT NULL,          -- 0: no HTTP response (see error)
    duration_ms               INTEGER NOT NULL,
    error                     TEXT,
    resp_headers_json         TEXT,
    resp_body                 BLOB,                      -- up to history_max_response_bytes
    resp_body_size            INTEGER NOT NULL DEFAULT 0, -- the full size received
    resp_truncated            INTEGER NOT NULL DEFAULT 0,
    timings_json              TEXT                       -- per-hop timing (engine.Hop list)
);

INSERT INTO history_full (id, created_at, method, url_template, status, duration_ms)
SELECT id, created_at, method, url, status, duration_ms FROM history;

DROP TABLE history;
ALTER TABLE history_full RENAME TO history;

CREATE INDEX history_created_at_idx ON history (created_at DESC, id DESC);
CREATE INDEX history_project_idx ON history (project_id, created_at DESC);

-- +goose Down
SELECT 1;
