import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { databasesQuery, useForgetMeta } from '../../api/queries';
import { DatabaseTable } from '../../components/DatabaseTable';
import { ErrorBanner } from '../../components/ErrorBanner';

export const Route = createFileRoute('/_auth/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(databasesQuery),
  // A Coolify outage must render as an error banner, not an empty page.
  errorComponent: ({ error }) => <ErrorBanner error={error} title="Could not load databases" />,
  component: DatabasesPage,
});

function DatabasesPage() {
  const { data, error } = useQuery(databasesQuery);
  const forget = useForgetMeta();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Databases</h1>
        <Link to="/new" className="btn-primary">
          New database
        </Link>
      </div>

      <ErrorBanner error={error} title="Could not load databases" />

      {data && <DatabaseTable databases={data.databases} />}

      {data && data.orphaned.length > 0 && (
        <section className="card space-y-3">
          <div>
            <h2 className="font-semibold text-slate-900">Orphaned notes</h2>
            <p className="text-sm text-slate-500">
              These local records point at databases that no longer exist in Coolify. Removing one
              only clears the note — it never deletes anything in Coolify.
            </p>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.orphaned.map((row) => (
              <li key={row.coolifyUuid} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium text-slate-800">{row.name}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{row.coolifyUuid}</span>
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(row.coolifyUuid)}
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
