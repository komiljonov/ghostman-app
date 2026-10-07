-- +goose Up
-- The request editor's History sub-tab lists one request's entries.
CREATE INDEX history_request_idx ON history (request_id, created_at DESC);

-- +goose Down
DROP INDEX history_request_idx;
