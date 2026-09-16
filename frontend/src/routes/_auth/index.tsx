import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { databasesQuery, useForgetMeta } from '../../api/queries';
import { DatabaseTable } from '../../components/database-table';
import { ErrorBanner } from '../../components/error-banner';
import { Kbd } from '../../components/kbd';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toaster';
import { PlusIcon } from '../../components/icons';

export const Route = createFileRoute('/_auth/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(databasesQuery),
  // A Coolify outage must render as an error banner, not an empty page.
  errorComponent: ({ error }) => <ErrorBanner error={error} title="Could not load databases" />,
  component: DatabasesPage,
});

function DatabasesPage() {
  const { data, error } = useQuery(databasesQuery);
  const forget = useForgetMeta();
  const notify = useToast();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Databases"
        description="Every Postgres instance in the Coolify project, refreshed every 15 seconds."
        actions={
          <Link to="/new" className="btn-primary gap-1.5">
            <PlusIcon />
            New database
            <Kbd>C</Kbd>
          </Link>
        }
      />

      <ErrorBanner error={error} title="Could not load databases" />

      {data && <DatabaseTable databases={data.databases} />}

      {data && data.orphaned.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Orphaned notes</h2>
            <span className="text-xs text-subtle">{data.orphaned.length} local record(s)</span>
          </div>
          <div className="card-body pb-1 pt-3">
            <p className="text-sm text-muted">
              These local records point at databases that no longer exist in Coolify. Removing one
              only clears the note — it never deletes anything in Coolify.
            </p>
          </div>
          <ul className="divide-y divide-line px-4 pb-2 text-sm">
            {data.orphaned.map((row) => (
              <li key={row.coolifyUuid} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{row.name}</span>
                  <span className="ml-2 font-mono text-xs text-subtle">{row.coolifyUuid}</span>
                </span>
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  disabled={forget.isPending}
                  onClick={() =>
                    forget.mutate(row.coolifyUuid, {
                      onSuccess: () => notify(`Removed the note for ${row.name}.`),
                      onError: () => notify('Could not remove the note.', 'error'),
                    })
                  }
                >
                  Remove note
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
