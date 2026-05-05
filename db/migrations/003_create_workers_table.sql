CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    process_id INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ,
    jobs_processed INT NOT NULL DEFAULT 0,
    CONSTRAINT workers_status_check
      CHECK (status IN ('running', 'stopped'))
);

CREATE INDEX IF NOT EXISTS idx_workers_status
ON workers (status);

CREATE INDEX IF NOT EXISTS idx_workers_last_heartbeat_at
ON workers (last_heartbeat_at);