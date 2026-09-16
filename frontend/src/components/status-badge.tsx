import type { DatabaseStatus } from '@app/shared';

const BADGE: Record<DatabaseStatus, string> = {
  running: 'badge-success',
  starting: 'badge-warning',
  stopped: 'badge-neutral',
  exited: 'badge-danger',
  unknown: 'badge-neutral',
};

const DOT: Record<DatabaseStatus, string> = {
  running: 'bg-success',
  starting: 'bg-warning animate-pulse',
  stopped: 'bg-subtle',
  exited: 'bg-danger',
  unknown: 'bg-subtle',
};

export function StatusBadge({ status }: { status: DatabaseStatus }) {
  return (
    <span className={BADGE[status]}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
      {status}
    </span>
  );
}
