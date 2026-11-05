CREATE TABLE classroom_security (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  recovery_pin_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT
);
