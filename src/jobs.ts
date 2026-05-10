import { pool } from "./db.js";
import { calculateBackoffSeconds } from "./backoff.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "dead";

export type Job = {
  id: string;
  queue_name: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  priority: number;
  run_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

export type JobAttemptStatus = "running" | "completed" | "failed";

export type JobAttempt = {
  id: string;
  job_id: string;
  worker_id: string;
  attempt_number: number;
  status: JobAttemptStatus;
  started_at: Date;
  finished_at: Date | null;
  error_message: string | null;
  created_at: Date;
};

export type JobStatusCount = {
  status: JobStatus;
  count: number;
};

export type QueueStatusCount = {
  queue_name: string;
  status: JobStatus;
  count: number;
};

export async function createJob(input: {
  queueName: string;
  type: string;
  payload: unknown;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
}): Promise<Job> {
  const result = await pool.query<Job>(
    `
    INSERT INTO jobs (
      queue_name,
      type,
      payload,
      priority,
      max_attempts,
      run_at
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [
      input.queueName,
      input.type,
      JSON.stringify(input.payload),
      input.priority ?? 0,
      input.maxAttempts ?? 3,
      input.runAt ?? new Date(),
    ]
  );

  return result.rows[0];
}

export async function getJobById(id: string): Promise<Job | null> {
  const result = await pool.query<Job>(
    `
    SELECT *
    FROM jobs
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const result = await pool.query<Job>(
    `
    SELECT *
    FROM jobs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function claimNextJob(input: {
  workerId: string;
  queueName?: string;
}): Promise<Job | null> {
  const result = await pool.query<Job>(
    `
    WITH next_job AS (
      SELECT id
      FROM jobs
      WHERE status = 'queued'
        AND run_at <= now()
        AND ($2::text IS NULL OR queue_name = $2)
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs
    SET status = 'running',
        locked_by = $1,
        locked_at = now(),
        attempts = attempts + 1,
        updated_at = now(),
        error_message = NULL
    WHERE id = (SELECT id FROM next_job)
    RETURNING *
    `,
    [input.workerId, input.queueName ?? null]
  );

  return result.rows[0] ?? null;
}

export async function completeJob(id: string): Promise<Job | null> {
  const result = await pool.query<Job>(
    `
    UPDATE jobs
    SET status = 'completed',
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function failJob(input: {
  id: string;
  errorMessage: string;
}): Promise<Job | null> {
  const job = await getJobById(input.id);

  if (!job) {
    return null;
  }

  const shouldDeadLetter = job.attempts >= job.max_attempts;
  const backoffSeconds = calculateBackoffSeconds(job.attempts);

  const result = await pool.query<Job>(
    `
    UPDATE jobs
    SET status = CASE
          WHEN $3::boolean THEN 'dead'
          ELSE 'queued'
        END,
        run_at = CASE
          WHEN $3::boolean THEN run_at
          ELSE now() + ($4::int * interval '1 second')
        END,
        locked_by = NULL,
        locked_at = NULL,
        error_message = $2,
        updated_at = now()
    WHERE id = $1
    RETURNING *
    `,
    [input.id, input.errorMessage, shouldDeadLetter, backoffSeconds]
  );

  return result.rows[0] ?? null;
}

export async function recoverStaleJobs(input: {
  staleAfterSeconds: number;
}): Promise<Job[]> {
  const result = await pool.query<Job>(
    `
    UPDATE jobs
    SET status = 'queued',
        locked_by = NULL,
        locked_at = NULL,
        error_message = 'Recovered from stale worker lock',
        updated_at = now()
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - ($1::int * interval '1 second')
    RETURNING *
    `,
    [input.staleAfterSeconds]
  );

  return result.rows;
}

export async function createJobAttempt(input: {
  jobId: string;
  workerId: string;
  attemptNumber: number;
}): Promise<JobAttempt> {
  const result = await pool.query<JobAttempt>(
    `
    INSERT INTO job_attempts (
      job_id,
      worker_id,
      attempt_number,
      status
    )
    VALUES ($1, $2, $3, 'running')
    RETURNING *
    `,
    [input.jobId, input.workerId, input.attemptNumber]
  );

  return result.rows[0];
}

export async function completeJobAttempt(input: {
  attemptId: string;
}): Promise<JobAttempt | null> {
  const result = await pool.query<JobAttempt>(
    `
    UPDATE job_attempts
    SET status = 'completed',
        finished_at = now(),
        error_message = NULL
    WHERE id = $1
    RETURNING *
    `,
    [input.attemptId]
  );

  return result.rows[0] ?? null;
}

export async function failJobAttempt(input: {
  attemptId: string;
  errorMessage: string;
}): Promise<JobAttempt | null> {
  const result = await pool.query<JobAttempt>(
    `
    UPDATE job_attempts
    SET status = 'failed',
        finished_at = now(),
        error_message = $2
    WHERE id = $1
    RETURNING *
    `,
    [input.attemptId, input.errorMessage]
  );

  return result.rows[0] ?? null;
}

export async function listJobAttempts(jobId: string): Promise<JobAttempt[]> {
  const result = await pool.query<JobAttempt>(
    `
    SELECT *
    FROM job_attempts
    WHERE job_id = $1
    ORDER BY started_at ASC
    `,
    [jobId]
  );

  return result.rows;
}

export async function getJobStatusCounts(): Promise<JobStatusCount[]> {
  const result = await pool.query<JobStatusCount>(
    `
    SELECT
      status,
      COUNT(*)::int AS count
    FROM jobs
    GROUP BY status
    ORDER BY status
    `
  );

  return result.rows;
}

export async function getQueueStatusCounts(): Promise<QueueStatusCount[]> {
  const result = await pool.query<QueueStatusCount>(
    `
    SELECT
      queue_name,
      status,
      COUNT(*)::int AS count
    FROM jobs
    GROUP BY queue_name, status
    ORDER BY queue_name, status
    `
  );

  return result.rows;
}

export async function listDeadJobs(limit = 50): Promise<Job[]> {
  const result = await pool.query<Job>(
    `
    SELECT *
    FROM jobs
    WHERE status = 'dead'
    ORDER BY updated_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}