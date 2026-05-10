# Project Notes

## Stack

- TypeScript
- Express
- PostgreSQL
- Docker Compose
- pg
- Zod

## Current Architecture

The project is a PostgreSQL-backed distributed job queue.

Core components:

- Express API for creating, inspecting, and monitoring jobs
- PostgreSQL for durable job storage
- Worker process for claiming and processing jobs
- Worker registry for lifecycle and health tracking
- Docker Compose for local development

Current flow:

```text
Client -> Express API -> PostgreSQL jobs table
Worker -> claims queued job -> processes job -> updates job status
Worker -> records job attempts -> updates worker metrics
```

## Implemented

- PostgreSQL-backed `jobs` table
- JSONB job payloads
- Job claiming with PostgreSQL row locking using `FOR UPDATE SKIP LOCKED`
- Job attempt history with `job_attempts`
- Exponential backoff retries
- Dead-lettering after max attempts
- Worker registration with `workers` table
- Worker heartbeat via `last_heartbeat_at`
- Graceful worker shutdown
- Docker signal-handling fix for worker process
- `jobs_processed` worker metric after successful jobs
- Stale lock recovery for crashed workers
- Worker inspection API endpoints
- Worker health fields:
  - `heartbeat_age_seconds`
  - `is_alive`
- Active worker filtering with `GET /workers?active=true`
- Queue visibility endpoints:
  - `GET /stats`
  - `GET /queues`
  - `GET /dead`

## Main API Endpoints

### Job endpoints

```text
POST /jobs
GET /jobs
GET /jobs/:id
GET /jobs/:id/attempts
```

### Worker endpoints

```text
GET /workers
GET /workers?active=true
GET /workers/:id
```

### Queue visibility endpoints

```text
GET /stats
GET /queues
GET /dead
GET /dead?limit=10
```

## Job Lifecycle

Jobs can move through these states:

```text
queued -> running -> completed
queued -> running -> queued
queued -> running -> dead
```

Current job statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `dead`

In normal retry flow, failed jobs are usually moved back to `queued` with a future `run_at` timestamp until they reach `max_attempts`. Once they exhaust retries, they become `dead`.

## Retry Behavior

Failed jobs use exponential backoff.

Current retry schedule:

| Failed Attempt | Next Retry Delay |
|---|---|
| 1 | 10 seconds |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 5 minutes |
| 5+ | 15 minutes |

If a job reaches `maxAttempts`, it is marked as `dead`.

## Job Attempt History

Each processing attempt is recorded in the `job_attempts` table.

Each attempt tracks:

- `job_id`
- `worker_id`
- `attempt_number`
- `status`
- `started_at`
- `finished_at`
- `error_message`

This makes it possible to inspect retry history and debug failures.

## Worker Lifecycle

On startup, the worker:

1. Registers itself in the `workers` table
2. Starts a heartbeat timer
3. Starts stale job recovery
4. Begins polling for queued jobs

During normal processing, the worker:

1. Claims a queued job using `FOR UPDATE SKIP LOCKED`
2. Creates a `job_attempts` row
3. Processes the job
4. Marks the attempt as completed or failed
5. Marks the job as completed, queued for retry, or dead
6. Increments `jobs_processed` after successful jobs

During shutdown, the worker:

1. Receives `SIGINT` or `SIGTERM`
2. Sets `shuttingDown = true`
3. Stops the heartbeat timer
4. Stops the stale job recovery timer
5. Marks itself as `stopped` in PostgreSQL
6. Closes the PostgreSQL connection pool
7. Exits

The worker also handles:

- Fatal worker loop errors
- Uncaught exceptions
- Unhandled promise rejections

## Queue Processing

Workers process all queues by default.

If `QUEUE_NAME` is set, the worker only claims jobs from that queue.

Examples:

```text
QUEUE_NAME unset     -> process all queues
QUEUE_NAME=emails    -> process only emails queue
QUEUE_NAME=default   -> process only default queue
```

## Worker Health

The `workers` table keeps historical worker records. Old workers are not automatically deleted because they are useful for debugging and lifecycle history.

A worker can be:

| `status` | Recent heartbeat? | Meaning |
|---|---:|---|
| `running` | yes | Active worker |
| `running` | no | Likely crashed or stale worker |
| `stopped` | no | Gracefully stopped worker |

The API computes:

- `heartbeat_age_seconds`
- `is_alive`

A worker is considered alive if:

```text
status = running
AND last_heartbeat_at is within the alive threshold
```

The current alive threshold is 15 seconds.

Use this endpoint to list all historical workers with computed health fields:

```bash
curl http://localhost:3000/workers
```

Use this endpoint to return only active workers:

```bash
curl "http://localhost:3000/workers?active=true"
```

## Stale Lock Recovery

Stale lock recovery handles this failure mode:

```text
Worker claims job
Job status becomes running
Worker crashes before completing it
Job remains stuck as running
```

The worker periodically finds jobs where:

```text
status = running
locked_at is older than the stale timeout
```

Then it requeues them:

```text
status = queued
locked_by = null
locked_at = null
error_message = "Recovered from stale worker lock"
```

For local testing, the stale timeout is short, such as 30 seconds.

A real crash can be simulated with:

```bash
docker compose kill worker
```

This avoids graceful shutdown and lets stale lock recovery requeue the stuck job after the timeout.

## Docker Signal Handling Note

The worker originally did not shut down gracefully when run through `npm`, `npx`, or `tsx watch`.

Problematic process chain:

```text
docker-init
  -> npm exec
    -> sh -c
      -> tsx
        -> node worker
```

This prevented Docker `SIGTERM` from reliably reaching the actual Node worker process.

The fix was to run Node directly in `docker-compose.yml`:

```yaml
worker:
  image: mcr.microsoft.com/devcontainers/typescript-node:20
  init: true
  volumes:
    - .:/workspace:cached
  working_dir: /workspace
  entrypoint: ["node"]
  command: ["--import", "tsx", "src/worker.ts"]
  depends_on:
    - postgres
  environment:
    DATABASE_URL: postgres://jobqueue:jobqueue@postgres:5432/job_queue_dev
  stop_grace_period: 15s
```

This gives a cleaner process tree:

```text
docker-init
  -> node --import tsx src/worker.ts
```

Graceful shutdown now works when stopping only the worker container.

## Useful Commands

Start services:

```bash
docker compose up postgres api worker
```

Restart API:

```bash
docker compose restart api
```

Restart worker:

```bash
docker compose restart worker
```

Stop only the worker:

```bash
docker compose stop worker
```

Force-kill the worker to simulate a crash:

```bash
docker compose kill worker
```

Check worker logs:

```bash
docker compose logs worker
```

Follow worker logs:

```bash
docker compose logs -f worker
```

Inspect worker process tree:

```bash
docker compose exec worker ps -eo pid,ppid,stat,command
```

Open PostgreSQL shell:

```bash
docker compose exec postgres psql -U jobqueue -d job_queue_dev
```

Run TypeScript type check:

```bash
npx tsc --noEmit
```

## Useful SQL

Check workers:

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

Check worker health manually:

```sql
SELECT
  id,
  status,
  last_heartbeat_at,
  now() - last_heartbeat_at AS heartbeat_age,
  jobs_processed
FROM workers
ORDER BY started_at DESC;
```

Check recent jobs:

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
  error_message,
  created_at,
  updated_at
FROM jobs
ORDER BY created_at DESC
LIMIT 20;
```

Check job attempts:

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

Check job status counts:

```sql
SELECT
  status,
  COUNT(*)::int AS count
FROM jobs
GROUP BY status
ORDER BY status;
```

Check queue status counts:

```sql
SELECT
  queue_name,
  status,
  COUNT(*)::int AS count
FROM jobs
GROUP BY queue_name, status
ORDER BY queue_name, status;
```

Check dead jobs:

```sql
SELECT
  id,
  queue_name,
  type,
  status,
  attempts,
  max_attempts,
  error_message,
  updated_at
FROM jobs
WHERE status = 'dead'
ORDER BY updated_at DESC;
```

## Testing Notes

When testing graceful shutdown, use:

```bash
docker compose stop worker
```

Avoid using this for graceful shutdown testing:

```bash
docker compose down
```

because it may stop PostgreSQL while the worker is trying to update its `stopped_at` timestamp.

When testing crash recovery, use:

```bash
docker compose kill worker
```

because this simulates a hard crash where graceful shutdown does not run.

## Local Data Persistence

PostgreSQL data persists because Docker Compose uses a named volume.

Stopping containers does not clear database rows:

```bash
docker compose stop
docker compose down
```

To completely reset the local database, including jobs, attempts, and workers:

```bash
docker compose down -v
```

Then restart services and rerun migrations.

Be careful: `docker compose down -v` deletes the local Postgres volume.

## Current Operational Endpoints

Check global job counts:

```bash
curl http://localhost:3000/stats
```

Check queue-level counts:

```bash
curl http://localhost:3000/queues
```

Check dead-letter jobs:

```bash
curl http://localhost:3000/dead
```

Check active workers:

```bash
curl "http://localhost:3000/workers?active=true"
```

## Next Planned Features

- Improve `/queues` response shape into a cleaner nested format
- Add pagination/filtering for `/jobs`
- Add retry/requeue endpoint for dead jobs
- Add cancel job endpoint
- Add queue pause/resume support
- Add automated tests
- Add integration tests with PostgreSQL
- Add basic dashboard UI
- Add metrics endpoint
- Add README updates reflecting the latest features
