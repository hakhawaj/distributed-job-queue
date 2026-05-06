import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import {
    claimNextJob,
    completeJob,
    failJob,
    createJobAttempt,
    completeJobAttempt,
    failJobAttempt,
    Job,
} from "./jobs.js";
import { closePool } from "./db.js";
import { registerWorker, heartbeatWorker } from "./workers.js";

const hostname = os.hostname();
const processId = process.pid;
const workerId = `${hostname}-${processId}`;
const heartbeatIntervalMs = 5000;

let shuttingDown = false;
let heartbeatTimer: NodeJS.Timeout | null = null;

type JobHandler = (job: Job) => Promise<void>;

const handlers: Record<string, JobHandler> = {
    echo: async (job) => {
        console.log(`[${workerId}] echo payload:`, job.payload);
        await sleep(500);
    },

    fail_once: async (job) => {
        if (job.attempts === 1) {
            throw new Error("Intentional failure on first attempt");
        }

        console.log(`[${workerId}] fail_once succeeded on attempt ${job.attempts}`);
    },

    slow: async (job) => {
        console.log(`[${workerId}] starting slow job ${job.id}`);
        await sleep(5000);
        console.log(`[${workerId}] finished slow job ${job.id}`);
    },
};

async function processJob(job: Job): Promise<void> {
    const handler = handlers[job.type];

    if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
    }

    await handler(job);
}

function startHeartbeat() {
    heartbeatTimer = setInterval(async () => {
        try {
            await heartbeatWorker(workerId);
        } catch (error) {
            console.error(`[${workerId}] heartbeat failed`, error);
        }
    }, heartbeatIntervalMs);
}

async function workerLoop() {
    await registerWorker({
        id: workerId,
        hostname,
        processId,
    });

    startHeartbeat();

    console.log(`[${workerId}] worker registered and started`);

    while (!shuttingDown) {
        const job = await claimNextJob({
            workerId,
            queueName: "default",
        });

        if (!job) {
            await sleep(1000);
            continue;
        }

        console.log(
            `[${workerId}] claimed job ${job.id} type=${job.type} attempt=${job.attempts}`
        );

        const attempt = await createJobAttempt({
            jobId: job.id,
            workerId,
            attemptNumber: job.attempts,
        });

        try {
            await processJob(job);

            await completeJobAttempt({
                attemptId: attempt.id,
            });

            await completeJob(job.id);

            console.log(
                `[${workerId}] completed job ${job.id} attempt=${job.attempts}`
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            await failJobAttempt({
                attemptId: attempt.id,
                errorMessage: message,
            });

            const updatedJob = await failJob({
                id: job.id,
                errorMessage: message,
            });

            console.error(
                `[${workerId}] failed job ${job.id} attempt=${job.attempts}: ${message}. New status=${updatedJob?.status} runAt=${updatedJob?.run_at?.toISOString?.()}`
            );
        }
    }

    console.log(`[${workerId}] worker stopped`);
}

async function shutdown() {
    console.log(`[${workerId}] shutting down`);
    shuttingDown = true;

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    await closePool();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

workerLoop().catch(async (error) => {
    console.error(`[${workerId}] fatal worker error`, error);
    await closePool();
    process.exit(1);
});