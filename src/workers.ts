import { pool } from "./db.js";

export type WorkerStatus = "running" | "stopped";

export type WorkerRecord = {
    id: string;
    hostname: string;
    process_id: number;
    status: WorkerStatus;
    started_at: Date;
    last_heartbeat_at: Date;
    stopped_at: Date | null;
    jobs_processed: number;
};

export async function registerWorker(input: {
    id: string;
    hostname: string;
    processId: number;
}): Promise<WorkerRecord> {
    const result = await pool.query<WorkerRecord>(
        `
    INSERT INTO workers (
      id,
      hostname,
      process_id,
      status,
      started_at,
      last_heartbeat_at,
      stopped_at,
      jobs_processed
    )
    VALUES ($1, $2, $3, 'running', now(), now(), NULL, 0)
    ON CONFLICT (id)
    DO UPDATE SET
      hostname = EXCLUDED.hostname,
      process_id = EXCLUDED.process_id,
      status = 'running',
      started_at = now(),
      last_heartbeat_at = now(),
      stopped_at = NULL
    RETURNING *
    `,
        [input.id, input.hostname, input.processId]
    );

    return result.rows[0];
}

export async function heartbeatWorker(id: string): Promise<WorkerRecord | null> {
    const result = await pool.query<WorkerRecord>(
        `
    UPDATE workers
    SET last_heartbeat_at = now(),
        status = 'running'
    WHERE id = $1
    RETURNING *
    `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function markWorkerStopped(
    id: string
): Promise<WorkerRecord | null> {
    const result = await pool.query<WorkerRecord>(
        `
    UPDATE workers
    SET status = 'stopped',
        stopped_at = now()
    WHERE id = $1
    RETURNING *
    `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function incrementWorkerJobsProcessed(
    id: string
): Promise<WorkerRecord | null> {
    const result = await pool.query<WorkerRecord>(
        `
    UPDATE workers
    SET jobs_processed = jobs_processed + 1,
        last_heartbeat_at = now()
    WHERE id = $1
    RETURNING *
    `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function listWorkers(): Promise<WorkerRecord[]> {
    const result = await pool.query<WorkerRecord>(
        `
    SELECT *
    FROM workers
    ORDER BY started_at DESC
    `
    );

    return result.rows;
}

export async function getWorkerById(
    id: string
): Promise<WorkerRecord | null> {
    const result = await pool.query<WorkerRecord>(
        `
    SELECT *
    FROM workers
    WHERE id = $1
    `,
        [id]
    );

    return result.rows[0] ?? null;
}