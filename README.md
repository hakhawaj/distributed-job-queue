# Distributed Job Queue

A PostgreSQL-backed distributed job queue built with Node.js, TypeScript, Express, and Docker.

This project is a learning-focused implementation of a background job processing system similar in spirit to systems like Sidekiq, Celery, BullMQ, or a lightweight SQS-style worker architecture.

It supports durable job storage, worker-based job processing, retry handling, exponential backoff, dead-lettering, and job attempt history.

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
- Docker-based local development

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
