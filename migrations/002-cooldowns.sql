-- Up
CREATE TABLE cooldowns (
    userid TEXT,
    cooldownid TEXT,
    date INTEGER
);

-- Down
DROP TABLE cooldowns;