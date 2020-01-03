-- Up
CREATE TABLE pins (
    msgid TEXT
);

CREATE TABLE users (
    id      TEXT PRIMARY KEY,
    balance INTEGER
);

CREATE TABLE purchases (
    userid TEXT,
    item   TEXT,
    FOREIGN KEY(userid) REFERENCES users(id)
);

-- Down
DROP TABLE pins;
DROP TABLE users;
DROP TABLE purchases;