-- +goose Up
-- Proxy passwords. The server stores a proxy's username at most; its password
-- exists ONLY here, per machine, like a secret variable value. Never log it.
CREATE TABLE proxy_passwords (
    proxy_id TEXT NOT NULL PRIMARY KEY,
    password TEXT NOT NULL
);

-- Which proxy a send went through ("" / NULL = direct): its name and address,
-- never its password.
ALTER TABLE history ADD COLUMN proxy_label TEXT;

-- +goose Down
DROP TABLE proxy_passwords;
