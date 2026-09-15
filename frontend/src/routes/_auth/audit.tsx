import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { auditQuery } from '../../api/queries';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Route = createFileRoute('/_auth/audit')({
  loader: ({ context }) => context.queryClient.ensureQueryData(auditQuery()),
  component: AuditPage,
});

function AuditPage() {
  const { data, error } = useQuery(auditQuery());

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Audit log</h1>
      <ErrorBanner error={error} title="Could not load the audit log" />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Actor</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Target</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                  {new Date(entry.at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-slate-700">{entry.actor}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {entry.action}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-700">{entry.targetName ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {entry.details ? JSON.stringify(entry.details) : '—'}
                </td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
