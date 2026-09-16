import { JOB_STEP_LABELS, type Job } from '@app/shared';

const STATE_MARK: Record<string, string> = {
  pending: '○',
  running: '◐',
  done: '●',
  failed: '✕',
  skipped: '–',
};

const STATE_CLASS: Record<string, string> = {
  pending: 'text-slate-400',
  running: 'text-blue-600',
  done: 'text-green-700',
  failed: 'text-red-700',
  skipped: 'text-amber-700',
};

export function ProgressSteps({ job, coolifyUrl }: { job: Job; coolifyUrl?: string }) {
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {job.steps.map((step) => (
          <li key={step.name} className="flex items-start gap-3 text-sm">
            <span className={`w-4 ${STATE_CLASS[step.state] ?? ''}`}>
              {STATE_MARK[step.state] ?? '○'}
            </span>
            <span className="flex-1">
              <span className={STATE_CLASS[step.state] ?? ''}>{JOB_STEP_LABELS[step.name]}</span>
              {step.note && <p className="mt-0.5 text-xs text-slate-500">{step.note}</p>}
              {step.error && <p className="mt-0.5 text-xs text-red-600">{step.error}</p>}
            </span>
          </li>
        ))}
        <li className="flex items-start gap-3 text-sm">
          <span className={`w-4 ${job.status === 'done' ? 'text-green-700' : 'text-slate-400'}`}>
            {job.status === 'done' ? '●' : '○'}
          </span>
          <span className={job.status === 'done' ? 'text-green-700' : 'text-slate-400'}>Done</span>
        </li>
      </ol>

      {job.status === 'paused' && job.pausedReason && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Waiting for you: SSL is disabled</p>
          <p className="mt-1">{job.pausedReason}</p>
          {coolifyUrl && (
            <p className="mt-2">
              <a className="underline" href={coolifyUrl} target="_blank" rel="noreferrer">
                Open this database in Coolify
              </a>{' '}
              → Configuration → enable SSL, then come back and continue.
            </p>
          )}
        </div>
      )}

      {job.status === 'failed' && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">
            {job.partial ? 'Created, but not fully configured' : 'Creation failed'}
          </p>
          {job.error && <p className="mt-1 whitespace-pre-wrap">{job.error}</p>}
          {job.partial && (
            <p className="mt-2 text-xs">
              The database still exists in Coolify — nothing was deleted automatically. Finish the
              remaining step there, or delete it and try again.
              {coolifyUrl && (
                <>
                  {' '}
                  <a className="underline" href={coolifyUrl} target="_blank" rel="noreferrer">
                    Open in Coolify
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
