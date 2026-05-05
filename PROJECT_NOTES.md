# Project Notes

## Stack
- TypeScript
- Express
- PostgreSQL
- Docker Compose
- pg
- Zod

## Current features
- POST /jobs
- GET /jobs
- GET /jobs/:id
- GET /jobs/:id/attempts
- Worker claims jobs using FOR UPDATE SKIP LOCKED
- job_attempts table
- Exponential backoff retries
- Dead-lettering after maxAttempts

## Next planned features
- Worker heartbeat table
- Stale lock recovery
- Queue stats endpoints
- Dead-letter inspection endpoint
- Tests