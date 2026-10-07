-- +goose Up
-- request_settings rows are now per-request OVERRIDES of the global default
-- (Settings). The previous version also wrote a row when a toggle went back on,
-- which equalled the then-fixed default: those carry no choice — drop them, so
-- such requests follow the global default. Explicit "off" rows stay as "never".
DELETE FROM request_settings WHERE follow_redirects = 1;

-- +goose Down
SELECT 1;
