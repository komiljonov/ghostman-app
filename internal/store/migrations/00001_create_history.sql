-- +goose Up
CREATE TABLE history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    method      TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    -- 0 when no HTTP response was received (bad URL, DNS failure, timeout, ...).
    status      INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    -- Unix epoch milliseconds (UTC).
    created_at  INTEGER NOT NULL
);

CREATE INDEX history_created_at_idx ON history (created_at DESC);

-- +goose Down
DROP TABLE history;
