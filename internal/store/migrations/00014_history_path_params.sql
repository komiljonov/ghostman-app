-- +goose Up
-- The path variables' values as authored ({key, value} rows, template form; the
-- resolved URL already carries them substituted).
ALTER TABLE history ADD COLUMN req_path_params_json TEXT;

-- +goose Down
ALTER TABLE history DROP COLUMN req_path_params_json;
