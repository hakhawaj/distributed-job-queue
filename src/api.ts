import express from "express";
import { z } from "zod";
import {
    createJob,
    getJobById,
    listJobs,
    listJobAttempts,
} from "./jobs.js";

const app = express();

app.use(express.json());

const createJobSchema = z.object({
    queueName: z.string().min(1).default("default"),
    type: z.string().min(1),
    payload: z.unknown(),
    priority: z.number().int().optional(),
    maxAttempts: z.number().int().positive().optional(),
    runAt: z.iso.datetime().optional(),
});

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "api",
    });
});

app.post("/jobs", async (req, res, next) => {
    try {
        const parsed = createJobSchema.parse(req.body);

        const job = await createJob({
            queueName: parsed.queueName,
            type: parsed.type,
            payload: parsed.payload,
            priority: parsed.priority,
            maxAttempts: parsed.maxAttempts,
            runAt: parsed.runAt ? new Date(parsed.runAt) : undefined,
        });

        res.status(201).json(job);
    } catch (error) {
        next(error);
    }
});

app.get("/jobs", async (_req, res, next) => {
    try {
        const jobs = await listJobs();
        res.json(jobs);
    } catch (error) {
        next(error);
    }
});

app.get("/jobs/:id", async (req, res, next) => {
    try {
        const job = await getJobById(req.params.id);

        if (!job) {
            res.status(404).json({
                error: "Job not found",
            });
            return;
        }

        res.json(job);
    } catch (error) {
        next(error);
    }
});

app.get("/jobs/:id/attempts", async (req, res, next) => {
    try {
        const job = await getJobById(req.params.id);

        if (!job) {
            res.status(404).json({
                error: "Job not found",
            });
            return;
        }

        const attempts = await listJobAttempts(req.params.id);

        res.json(attempts);
    } catch (error) {
        next(error);
    }
});

app.use(
    (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        if (error instanceof z.ZodError) {
            res.status(400).json({
                error: "Invalid request body",
                issues: error.issues,
            });
            return;
        }

        console.error(error);

        res.status(500).json({
            error: "Internal server error",
        });
    }
);

const port = Number(process.env.PORT ?? 3000);

app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
});