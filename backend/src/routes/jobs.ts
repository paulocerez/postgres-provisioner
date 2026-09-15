import { Router } from 'express';
import { getJob } from '../jobs.js';
import { param } from '../middleware.js';

export const jobsRouter: Router = Router();

jobsRouter.get('/:jobId', (req, res) => {
  const job = getJob(param(req, 'jobId'));
  if (!job) {
    res.status(404).json({ error: { message: 'No such job.' } });
    return;
  }
  res.json(job);
});
