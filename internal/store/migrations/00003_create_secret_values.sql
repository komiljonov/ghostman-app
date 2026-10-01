-- +goose Up
-- Values of secret environment variables. They exist ONLY here, never on the
-- server. Keyed by environment + variable KEY (not variable id), so a variable that
-- is deleted and re-created with the same key keeps its secret.
CREATE TABLE secret_values (
    environment_id TEXT NOT NULL,
    key            TEXT NOT NULL,
    value          TEXT NOT NULL,
    PRIMARY KEY (environment_id, key)
);

-- +goose Down
DROP TABLE secret_values;
