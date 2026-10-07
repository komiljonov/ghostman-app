-- +goose Up
-- Per-request client settings that live only on this machine (not on the server).
-- No row = defaults (follow_redirects on).
CREATE TABLE request_settings (
    request_id       TEXT PRIMARY KEY,
    follow_redirects INTEGER NOT NULL
);

-- +goose Down
DROP TABLE request_settings;
