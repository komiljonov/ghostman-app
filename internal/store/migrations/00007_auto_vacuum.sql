-- +goose NO TRANSACTION
-- +goose Up
-- History rows can carry large bodies: incremental auto-vacuum lets deletes give
-- the space back (store.ReclaimSpace). auto_vacuum only changes on an existing
-- database through a VACUUM (outside a transaction, hence NO TRANSACTION); new
-- databases get it from the connection pragma at open (store.dsn).
PRAGMA auto_vacuum = INCREMENTAL;
VACUUM;

-- +goose Down
SELECT 1;
