import { JOB_STEP_LABELS, type Job } from '@app/shared';
import type { ReactNode } from 'react';
import {
  AlertIcon,
  CircleCheckIcon,
  CircleDashIcon,
  CircleIcon,
  CircleXIcon,
  ExternalLinkIcon,
  SpinnerIcon,
} from './icons';

const MARK: Record<string, ReactNode> = {
  pending: <CircleIcon className="text-subtle" />,
  running: <SpinnerIcon className="text-accent" />,
  done: <CircleCheckIcon className="text-success" />,
  failed: <CircleXIcon className="text-danger" />,
  skipped: <CircleDashIcon className="text-warning" />,
};

const LABEL_CLASS: Record<string, string> = {
  pending: 'text-subtle',
  running: 'text-fg font-medium',
  done: 'text-fg',
  failed: 'text-danger font-medium',
  skipped: 'text-warning',
};

function Step({
  state,
  label,
  last,
  children,
}: {
  state: string;
  label: string;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0 text-sm">
      {/* The connector is drawn behind the marker so completed steps read as a
          continuous run rather than disconnected dots. */}
      {!last && (
        <span
          aria-hidden="true"
          className={`absolute left-[7.5px] top-5 h-[calc(100%-1.25rem)] w-px ${
            state === 'done' ? 'bg-success/40' : 'bg-line'
          }`}
        />
      )}
      <span className="relative z-10 mt-0.5 shrink-0 bg-surface">{MARK[state] ?? MARK.pending}</span>
      <span className="min-w-0 flex-1">
        <span className={LABEL_CLASS[state] ?? 'text-muted'}>{label}</span>
        {children}
      </span>
    </li>
  );
}

export function ProgressSteps({ job, coolifyUrl }: { job: Job; coolifyUrl?: string }) {
  return (
    <div className="space-y-4">
      <ol>
        {job.steps.map((step) => (
          <Step key={step.name} state={step.state} label={JOB_STEP_LABELS[step.name]}>
            {step.note && <p className="mt-0.5 text-xs text-muted">{step.note}</p>}
            {step.error && <p className="mt-0.5 text-xs text-danger">{step.error}</p>}
          </Step>
        ))}
        <Step last state={job.status === 'done' ? 'done' : 'pending'} label="Done" />
      </ol>

      {/*
        Coolify can create a database with SSL off, and it cannot be turned on
        through the API — so the job stops and hands the decision back rather
        than starting something unencrypted on the operator's behalf.
      */}
      {job.status === 'paused' && job.pausedReason && (
        <div className="alert-warning">
          <AlertIcon className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="font-medium">Waiting for you: SSL is disabled</p>
            <p className="mt-0.5 text-muted">{job.pausedReason}</p>
            {coolifyUrl && (
              <p className="mt-1.5 text-xs text-muted">
                <a
                  className="link inline-flex items-center gap-1"
                  href={coolifyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open this database in Coolify
                  <ExternalLinkIcon width="12" height="12" />
                </a>{' '}
                → Configuration → enable SSL, then come back and continue.
              </p>
            )}
          </div>
        </div>
      )}

      {job.status === 'failed' && (
        <div className="alert-danger">
          <AlertIcon className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="font-medium">
              {job.partial ? 'Created, but not fully configured' : 'Creation failed'}
            </p>
            {job.error && <p className="mt-0.5 whitespace-pre-wrap text-muted">{job.error}</p>}
            {job.partial && (
              <p className="mt-1.5 text-xs text-muted">
                The database still exists in Coolify — nothing was deleted automatically. Finish the
                remaining step there, or delete it and try again.
                {coolifyUrl && (
                  <>
                    {' '}
                    <a
                      className="link inline-flex items-center gap-1"
                      href={coolifyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Coolify
                      <ExternalLinkIcon width="12" height="12" />
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
