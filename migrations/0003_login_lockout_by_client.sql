-- Login lockout is keyed by client, not by account number.
--
-- 0002 keyed login_failures by number_hmac. That throttles nothing: a brute-force
-- attempt submits a different number every time, so every attempt hits a fresh key,
-- the counter never reaches the limit, and each guess appends a new row. Keying by
-- the HMAC of the client IP makes the counter fire and bounds the table at one row
-- per client. This table is throttle state, not ledger data, so recreating it is safe.
DROP TABLE login_failures;

CREATE TABLE login_failures (
  ip_hmac TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
