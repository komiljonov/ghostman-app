-- +goose Up
-- The send's script console output (internal/scripting.Console as JSON): owner,
-- phase, level and text per entry. Local only, like the rest of history.
ALTER TABLE history ADD COLUMN console_json TEXT;

-- +goose Down
SELECT 1;
