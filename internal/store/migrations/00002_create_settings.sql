-- +goose Up
-- Local-only key/value settings. Keys in use: "session_token", "server_url".
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- +goose Down
DROP TABLE settings;
