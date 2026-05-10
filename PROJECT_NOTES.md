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

- Express API for creating and inspecting jobs
- PostgreSQL for durable job storage
- Worker process for claiming and processing jobs
- Docker Compose for local development

Current flow:

```text
Client -> Express API -> PostgreSQL jobs table
Worker -> claims queued job -> processes job -> updates job status
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

## Worker Lifecycle

On startup, the worker:

1. Registers itself in the `workers` table
2. Starts a heartbeat timer
3. Begins polling for queued jobs

During shutdown, the worker:

1. Receives `SIGINT` or `SIGTERM`
2. Sets `shuttingDown = true`
3. Stops the heartbeat timer
4. Marks itself as `stopped` in PostgreSQL
5. Closes the PostgreSQL connection pool
6. Exits

The worker also handles:

- Fatal worker loop errors
- Uncaught exceptions
- Unhandled promise rejections

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

Stop only the worker:

```bash
docker compose stop worker
```

Check worker logs:

```bash
docker compose logs worker
```

Inspect worker process tree:

```bash
docker compose exec worker ps -eo pid,ppid,stat,command
```

Open PostgreSQL shell:

```bash
docker compose exec postgres psql -U jobqueue -d job_queue_dev
```

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

## Testing Notes

When testing graceful shutdown, use:

```bash
docker compose stop worker
```

Avoid using this for shutdown testing:

```bash
docker compose down
```

because it may stop PostgreSQL while the worker is trying to update its `stopped_at` timestamp.

## Next Planned Features

- Increment `jobs_processed` after successful jobs
- Stale lock recovery for crashed workers
- `/workers` API endpoint
- `/stats` and `/queues` API endpoints
- Dead-letter inspection endpoint
- Tests
