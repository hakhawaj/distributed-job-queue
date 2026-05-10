# Distributed Job Queue

A PostgreSQL-backed distributed job queue built with Node.js, TypeScript, Express, and Docker.

This project is a learning-focused implementation of a background job processing system similar in spirit to systems like Sidekiq, Celery, BullMQ, or a lightweight SQS-style worker architecture.

It supports durable job storage, worker-based job processing, safe concurrent job claiming, retries with exponential backoff, dead-lettering, worker heartbeats, stale lock recovery, and operational inspection endpoints.

---

## Why I Built This

The goal of this project is to better understand backend infrastructure and system design concepts used in production systems, including:

- Asynchronous background processing
- Producer/consumer architecture
- PostgreSQL transactions and row locking
- Safe job claiming with `FOR UPDATE SKIP LOCKED`
- Retry handling and exponential backoff
- Dead-letter queues
- Job attempt history
- Worker processes
- Worker heartbeats and lifecycle tracking
- Stale lock recovery after worker crashes
- Docker-based local development
- Operational visibility through API endpoints

This project is intentionally built from scratch instead of using an existing queue library so that the core mechanics are easier to understand.

---

## Architecture

```text
+-------------+        +----------------+        +-------------+
|             |        |                |        |             |
|   Client    +------->+   Express API  +------->+ PostgreSQL  |
|             |        |                |        |             |
+-------------+        +----------------+        +------+------+
                                                          ^
                                                          |
                                                          |
                                                   +------+------+
                                                   |             |
                                                   |   Worker    |
                                                   |             |
                                                   +-------------+
```

### Main Components

| Component | Description |
|---|---|
| API | Accepts jobs, exposes job/queue/worker inspection endpoints, and supports dead-job requeueing |
| PostgreSQL | Stores jobs, job attempts, and worker records |
| Worker | Polls for jobs, claims them safely, processes them, retries failures, and recovers stale jobs |
| Docker Compose | Runs the local development environment |

---

## Current Features

- Create jobs through an HTTP API
- Store jobs durably in PostgreSQL
- Process jobs with one or more worker processes
- Claim jobs safely using PostgreSQL row-level locking
- Support multiple queues
- Process all queues by default
- Optionally scope a worker to one queue with `QUEUE_NAME`
- Track job statuses: `queued`, `running`, `completed`, `failed`, `dead`
- Track every processing attempt in `job_attempts`
- Retry failed jobs with exponential backoff
- Dead-letter jobs after max attempts
- Requeue dead jobs through an API endpoint
- Track worker registration and lifecycle
- Track worker heartbeats
- Track `jobs_processed` per worker
- Compute worker health with `is_alive` and `heartbeat_age_seconds`
- Recover jobs stuck in `running` after worker crashes
- Inspect queues, workers, stats, dead jobs, and job attempts through API endpoints

---

## Tech Stack

- Node.js
- TypeScript
- Express
- PostgreSQL
- Docker Compose
- `pg`
- Zod
- TSX

---

## Project Structure

```text
distributed-job-queue/
  db/
    migrations/
      001_create_jobs_table.sql
      002_create_job_attempts_table.sql
      003_create_workers_table.sql
  src/
    api.ts
    worker.ts
    db.ts
    jobs.ts
    workers.ts
    backoff.ts
  docker-compose.yml
  package.json
  tsconfig.json
  README.md
  PROJECT_NOTES.md
```

---

## Prerequisites

You need:

- Docker
- Docker Compose
- Node.js and npm if running commands outside Docker
- `psql` client if running database commands directly from the dev container or host

This project is intended to run locally through Docker Compose.

---

## Environment Variables

The app expects a `DATABASE_URL`.

When running in Docker Compose:

```bash
DATABASE_URL=postgres://jobqueue:jobqueue@postgres:5432/job_queue_dev
```

When connecting from your Mac host machine:

```bash
postgres://jobqueue:jobqueue@localhost:5432/job_queue_dev
```

Optional worker configuration:

```bash
QUEUE_NAME=emails
```

If `QUEUE_NAME` is not set, the worker processes jobs from all queues.

---

## Setup

### 1. Clone the repository

```bash
git clone git@github.com:<your-username>/distributed-job-queue.git
cd distributed-job-queue
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Run migrations

```bash
npm run db:migrate
```

If you are outside the dev container and want to run migrations through Docker:

```bash
docker compose run --rm dev npm run db:migrate
```

### 5. Start the API and worker

```bash
docker compose up postgres api worker
```

The API will be available at:

```text
http://localhost:3000
```

---

## Database Migrations

The project currently has three migrations:

| Migration | Purpose |
|---|---|
| `001_create_jobs_table.sql` | Creates the `jobs` table |
| `002_create_job_attempts_table.sql` | Creates the `job_attempts` table |
| `003_create_workers_table.sql` | Creates the `workers` table |

Run all migrations:

```bash
npm run db:migrate
```

Or manually:

```bash
psql "$DATABASE_URL" -f db/migrations/001_create_jobs_table.sql
psql "$DATABASE_URL" -f db/migrations/002_create_job_attempts_table.sql
psql "$DATABASE_URL" -f db/migrations/003_create_workers_table.sql
```

Using Docker's Postgres container:

```bash
docker compose exec postgres psql -U jobqueue -d job_queue_dev
```

---

## Running the Project

### Start all services

```bash
docker compose up postgres api worker
```

### Run services in the background

```bash
docker compose up -d postgres api worker
```

### Stop services

```bash
docker compose stop
```

### Stop and remove containers

```bash
docker compose down
```

### Reset local database completely

```bash
docker compose down -v
```

Warning: `docker compose down -v` deletes the local PostgreSQL volume and removes all jobs, attempts, and worker history.

---

## Health Check

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "api"
}
```

---

## API Endpoints

### Jobs

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/jobs` | Create a job |
| `GET` | `/jobs` | List recent jobs |
| `GET` | `/jobs/:id` | Get one job |
| `GET` | `/jobs/:id/attempts` | Get attempts for one job |
| `POST` | `/jobs/:id/requeue` | Requeue a dead job |

### Workers

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/workers` | List all workers with health fields |
| `GET` | `/workers?active=true` | List only currently alive workers |
| `GET` | `/workers/:id` | Get one worker |

### Queue Visibility

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stats` | Global job counts by status |
| `GET` | `/queues` | Queue-level job counts |
| `GET` | `/dead` | List dead-letter jobs |
| `GET` | `/dead?limit=10` | List dead-letter jobs with limit |

---

## Creating Jobs

### Create a basic echo job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "default",
    "type": "echo",
    "payload": {
      "message": "hello worker"
    }
  }'
```

### Create a job in another queue

Workers process all queues by default unless `QUEUE_NAME` is set.

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "emails",
    "type": "echo",
    "payload": {
      "to": "user@example.com",
      "template": "welcome",
      "message": "welcome to the app"
    }
  }'
```

### Create a delayed job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "reports",
    "type": "echo",
    "payload": {
      "reportId": "rpt_123"
    },
    "runAt": "2030-01-01T00:00:00.000Z"
  }'
```

### Create a priority job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "default",
    "type": "echo",
    "priority": 10,
    "payload": {
      "message": "high priority job"
    }
  }'
```

---

## Supported Demo Job Types

### `echo`

Logs the payload and completes successfully.

```json
{
  "queueName": "default",
  "type": "echo",
  "payload": {
    "message": "hello"
  }
}
```

### `fail_once`

Fails on the first attempt and succeeds on the next attempt.

```json
{
  "queueName": "default",
  "type": "fail_once",
  "payload": {
    "message": "retry demo"
  },
  "maxAttempts": 3
}
```

### `always_fail`

Always fails until it reaches `maxAttempts` and becomes dead-lettered.

```json
{
  "queueName": "default",
  "type": "always_fail",
  "payload": {
    "message": "dead-letter demo"
  },
  "maxAttempts": 3
}
```

### `slow`

Simulates a long-running job.

```json
{
  "queueName": "default",
  "type": "slow",
  "payload": {
    "message": "slow job demo"
  }
}
```

---

## Retry Demo

Create a job that fails once:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "default",
    "type": "fail_once",
    "payload": {
      "message": "this should retry once"
    },
    "maxAttempts": 3
  }'
```

Expected behavior:

```text
Attempt 1 -> failed
Job is requeued with exponential backoff
Attempt 2 -> completed
```

Inspect the job attempts:

```bash
curl http://localhost:3000/jobs/<job-id>/attempts
```

---

## Dead-Letter Demo

Create a job that always fails:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "default",
    "type": "always_fail",
    "payload": {
      "message": "this should become dead"
    },
    "maxAttempts": 1
  }'
```

Wait for the worker to process it, then inspect dead jobs:

```bash
curl http://localhost:3000/dead
```

### Requeue a dead job

```bash
curl -X POST http://localhost:3000/jobs/<job-id>/requeue
```

This moves a dead job back to:

```text
status = queued
attempts = 0
run_at = now()
error_message = null
```

If the job still fails, it may become dead again.

---

## Inspecting Jobs

```bash
curl http://localhost:3000/jobs
curl http://localhost:3000/jobs/<job-id>
curl http://localhost:3000/jobs/<job-id>/attempts
```

---

## Inspecting Workers

### List all workers

```bash
curl http://localhost:3000/workers
```

### List active workers only

```bash
curl "http://localhost:3000/workers?active=true"
```

A worker is considered active if:

```text
status = running
AND last_heartbeat_at is recent
```

### Get one worker

```bash
curl http://localhost:3000/workers/<worker-id>
```

---

## Inspecting Queues and Stats

### Global job status counts

```bash
curl http://localhost:3000/stats
```

### Queue-level summaries

```bash
curl http://localhost:3000/queues
```

Example:

```json
[
  {
    "queueName": "default",
    "counts": {
      "queued": 0,
      "running": 0,
      "completed": 5,
      "failed": 0,
      "dead": 1
    },
    "total": 6
  }
]
```

### Dead-letter jobs

```bash
curl http://localhost:3000/dead
curl "http://localhost:3000/dead?limit=10"
```

---

## Running Multiple Workers

By default, the worker processes jobs from all queues.

### Scale the worker service

```bash
docker compose up --scale worker=3 postgres api worker
```

This starts three worker containers.

Because workers claim jobs using `FOR UPDATE SKIP LOCKED`, multiple workers can safely compete for jobs without processing the same job at the same time.

### Inspect active workers

```bash
curl "http://localhost:3000/workers?active=true"
```

### Queue-specific workers

Set `QUEUE_NAME` to restrict a worker to one queue.

```text
QUEUE_NAME unset      -> process all queues
QUEUE_NAME=emails     -> process only emails queue
QUEUE_NAME=reports    -> process only reports queue
```

Example Compose environment:

```yaml
environment:
  DATABASE_URL: postgres://jobqueue:jobqueue@postgres:5432/job_queue_dev
  QUEUE_NAME: emails
```

---

## Stale Lock Recovery Demo

This system can recover jobs stuck in `running` if a worker crashes before completing them.

### 1. Submit a slow job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "default",
    "type": "slow",
    "payload": {
      "message": "crash recovery demo"
    }
  }'
```

### 2. Kill the worker while it is processing

```bash
docker compose kill worker
```

This simulates a hard crash. Graceful shutdown will not run.

### 3. Restart the worker

```bash
docker compose up worker
```

After the stale timeout, the worker should recover the stuck job by requeueing it. Then a worker can claim and complete it.

---

## Worker Lifecycle

On startup, each worker:

1. Registers itself in the `workers` table
2. Starts heartbeat updates
3. Starts stale job recovery
4. Begins polling for jobs

During shutdown, each worker:

1. Receives `SIGINT` or `SIGTERM`
2. Stops heartbeat updates
3. Stops stale recovery
4. Marks itself as `stopped`
5. Closes the PostgreSQL connection pool
6. Exits

The worker process is run directly through Node in Docker so Docker signals reach the actual worker process:

```yaml
entrypoint: ["node"]
command: ["--import", "tsx", "src/worker.ts"]
```

---

## Safe Job Claiming

Workers claim jobs using PostgreSQL row-level locking:

```sql
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
    updated_at = now()
WHERE id = (SELECT id FROM next_job)
RETURNING *;
```

This allows multiple workers to safely claim different jobs.

---

## Database Schema Overview

### `jobs`

Stores the current state of each job.

| Column | Description |
|---|---|
| `id` | Unique job ID |
| `queue_name` | Queue name |
| `type` | Job handler type |
| `payload` | JSONB job payload |
| `status` | Current job status |
| `attempts` | Number of processing attempts |
| `max_attempts` | Max attempts before dead-lettering |
| `priority` | Higher priority jobs run first |
| `run_at` | Earliest time the job can be claimed |
| `locked_by` | Worker that claimed the job |
| `locked_at` | Time the job was claimed |
| `error_message` | Most recent error |

### `job_attempts`

Stores attempt history.

| Column | Description |
|---|---|
| `job_id` | Related job |
| `worker_id` | Worker that processed the attempt |
| `attempt_number` | Attempt number |
| `status` | `running`, `completed`, or `failed` |
| `started_at` | Attempt start time |
| `finished_at` | Attempt finish time |
| `error_message` | Error message if failed |

### `workers`

Stores worker lifecycle and health data.

| Column | Description |
|---|---|
| `id` | Worker ID |
| `hostname` | Worker container hostname |
| `process_id` | Worker process ID |
| `status` | `running` or `stopped` |
| `started_at` | Worker startup time |
| `last_heartbeat_at` | Last heartbeat timestamp |
| `stopped_at` | Graceful shutdown timestamp |
| `jobs_processed` | Successful jobs processed by this worker |

---

## Useful SQL

Open PostgreSQL:

```bash
docker compose exec postgres psql -U jobqueue -d job_queue_dev
```

### Recent jobs

```sql
SELECT
  id,
  queue_name,
  type,
  status,
  attempts,
  max_attempts,
  run_at,
  locked_by,
  locked_at,
  error_message
FROM jobs
ORDER BY created_at DESC
LIMIT 20;
```

### Job attempts

```sql
SELECT
  j.id AS job_id,
  j.type,
  j.status AS job_status,
  j.attempts,
  a.attempt_number,
  a.status AS attempt_status,
  a.worker_id,
  a.started_at,
  a.finished_at,
  a.error_message
FROM jobs j
JOIN job_attempts a
  ON a.job_id = j.id
ORDER BY j.created_at DESC, a.attempt_number ASC
LIMIT 50;
```

### Workers

```sql
SELECT
  id,
  status,
  started_at,
  last_heartbeat_at,
  stopped_at,
  jobs_processed
FROM workers
ORDER BY started_at DESC;
```

### Queue counts

```sql
SELECT
  queue_name,
  status,
  COUNT(*)::int AS count
FROM jobs
GROUP BY queue_name, status
ORDER BY queue_name, status;
```

---

## Design Decisions

### PostgreSQL as the queue backend

This project uses PostgreSQL instead of Redis, RabbitMQ, Kafka, or SQS to better understand durable storage, transactions, row locks, and query design.

PostgreSQL is not always the right queue backend at very high scale, but it is practical for many applications and is excellent for learning queue mechanics.

### At-least-once processing

This system is designed around at-least-once processing.

A job may be processed more than once in failure scenarios such as:

- Worker crashes after side effects but before marking the job complete
- Database update fails after job logic succeeds
- Stale lock recovery requeues a job that was partially processed

Because of this, real job handlers should be idempotent.

### JSONB payloads

Job payloads are stored as `JSONB` so different job types can have different input shapes.

Frequently queried fields such as `status`, `queue_name`, `run_at`, and `priority` are stored as regular columns for indexing and query performance.

### Worker history

The `workers` table keeps historical worker records.

Old workers are not automatically deleted because they are useful for debugging graceful shutdowns, crashes, and worker lifecycle behavior.

Use:

```bash
curl "http://localhost:3000/workers?active=true"
```

to see only currently active workers.

---

## Current Limitations

- No authentication for the API
- No queue pause/resume support yet
- No job cancellation endpoint yet
- No recurring scheduled jobs
- No pagination/filtering on `/jobs` yet
- No automated test suite yet
- No dashboard UI yet
- No production deployment setup yet
- Failure handling could be made more transactional

---

## Planned Improvements

- Add pagination and filtering for `/jobs`
- Add job cancellation
- Add queue pause/resume
- Add recurring jobs
- Add automated tests
- Add integration tests with PostgreSQL
- Add a basic dashboard UI
- Add metrics endpoint
- Add production build and deployment setup

---

## Example Interview Summary

A concise way to describe this project:

> I built a PostgreSQL-backed distributed job queue with an Express API and TypeScript worker process. Producers submit jobs through an HTTP API, jobs are stored durably in PostgreSQL, and workers claim jobs safely using `FOR UPDATE SKIP LOCKED`. The system supports multiple queues, retries with exponential backoff, dead-lettering, dead-job requeueing, job attempt history, worker registration, heartbeats, stale lock recovery, and operational inspection endpoints for workers, queues, stats, and dead-letter jobs.

---

## License

MIT
