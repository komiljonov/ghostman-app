-- +goose Up
-- Local paths of multipart file fields. The synced body (server) names a file by
-- its display name only; WHERE it is on disk is per machine, like a secret value.
-- Keyed by request + field KEY, so a field keeps its file across edits of the
-- other rows (duplicate file keys within a request are not supported here).
CREATE TABLE request_files (
    request_id TEXT NOT NULL,
    field_key  TEXT NOT NULL,
    path       TEXT NOT NULL,
    PRIMARY KEY (request_id, field_key)
);

-- +goose Down
DROP TABLE request_files;
