import type { DatabaseStatus } from '@app/shared';

const STYLES: Record<DatabaseStatus, string> = {
  running: 'bg-green-100 text-green-800 border-green-200',
  starting: 'bg-amber-100 text-amber-800 border-amber-200',
  stopped: 'bg-slate-100 text-slate-700 border-slate-200',
  exited: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function StatusBadge({ status }: { status: DatabaseStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
