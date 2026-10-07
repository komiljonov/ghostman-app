-- +goose Up
-- The effective auth config of a send in template form ({{vars}} unresolved)
-- plus where it came from; the derived header/param itself is in the resolved copy.
ALTER TABLE history ADD COLUMN req_auth_json TEXT;

-- +goose Down
SELECT 1;
