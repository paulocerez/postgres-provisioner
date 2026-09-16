import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { auditQuery } from '../../api/queries';
import { EmptyState } from '../../components/empty-state';
import { ErrorBanner } from '../../components/error-banner';
import { PageHeader } from '../../components/page-header';
import { ListIcon } from '../../components/icons';

export const Route = createFileRoute('/_auth/audit')({
  loader: ({ context }) => context.queryClient.ensureQueryData(auditQuery()),
  component: AuditPage,
});

function AuditPage() {
  const { data, error } = useQuery(auditQuery());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="The 100 most recent actions taken through this app."
      />
      <ErrorBanner error={error} title="Could not load the audit log" />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="h-8 px-3 font-medium">Time</th>
                <th className="h-8 px-3 font-medium">Actor</th>
                <th className="h-8 px-3 font-medium">Action</th>
                <th className="h-8 px-3 font-medium">Target</th>
                <th className="h-8 px-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(data ?? []).map((entry) => (
                <tr key={entry.id} className="transition-colors hover:bg-raised/60">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                    {new Date(entry.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-fg">{entry.actor}</td>
                  <td className="px-3 py-2">
                    <span className="badge-neutral font-mono">{entry.action}</span>
                  </td>
                  <td className="px-3 py-2 text-fg">{entry.targetName ?? '—'}</td>
                  <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-subtle">
                    {entry.details ? JSON.stringify(entry.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.length === 0 && (
          <EmptyState
            icon={<ListIcon />}
            title="Nothing recorded yet"
            description="Actions taken through this app will appear here."
          />
        )}
      </div>
    </div>
  );
}
