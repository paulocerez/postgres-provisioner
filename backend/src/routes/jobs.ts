import { Router } from 'express';
import { z } from 'zod';
import { continueJob, getJob } from '../jobs.js';
import { asyncHandler, param } from '../middleware.js';

export const jobsRouter: Router = Router();

jobsRouter.get('/:jobId', (req, res) => {
  const job = getJob(param(req, 'jobId'));
  if (!job) {
    res.status(404).json({ error: { message: 'No such job.' } });
    return;
  }
  res.json(job);
});

const continueSchema = z.object({ force: z.boolean().default(false) });

/** Resumes a job paused at the pre-start SSL checkpoint. */
jobsRouter.post(
  '/:jobId/continue',
  asyncHandler(async (req, res) => {
    const { force } = continueSchema.parse(req.body ?? {});
    const result = await continueJob(param(req, 'jobId'), { force });
    if (!result.ok) {
      res.status(409).json({ error: { message: result.message } });
      return;
    }
    res.json({ ok: true });
  }),
);
