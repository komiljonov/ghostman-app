-- +goose Up
-- Auth-field memory: the last values the user saved for each auth type, per
-- project. Choosing that type on a node whose fields are all empty prefills
-- them (internal/authmemory). LOCAL ONLY by design: the values may be literal
-- secrets (tokens, passwords, JWT secrets) — they never sync and are never
-- logged; same trust level as secret_values.
CREATE TABLE auth_defaults (
    project_id  TEXT NOT NULL,
    auth_type   TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (project_id, auth_type)
);

-- +goose Down
DROP TABLE auth_defaults;
