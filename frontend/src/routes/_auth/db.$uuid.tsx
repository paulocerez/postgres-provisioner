import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  databaseQuery,
  metaQuery,
  useDeleteDatabase,
  useLifecycleAction,
} from '../../api/queries';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConnectionString } from '../../components/ConnectionString';
import { ErrorBanner } from '../../components/ErrorBanner';
import { MetaCard } from '../../components/MetaCard';
import { StatusBadge } from '../../components/StatusBadge';

export const Route = createFileRoute('/_auth/db/$uuid')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(databaseQuery(params.uuid)),
  errorComponent: ({ error }) => <ErrorBanner error={error} title="Could not load this database" />,
  component: DatabaseDetailPage,
});

function DatabaseDetailPage() {
  const { uuid } = Route.useParams();
  const navigate = useNavigate();
  const { data, error } = useQuery(databaseQuery(uuid));
  const meta = useQuery(metaQuery);
  const lifecycle = useLifecycleAction(uuid);
  const remove = useDeleteDatabase(uuid);

  const [confirm, setConfirm] = useState<'restart' | 'stop' | 'delete' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [deleteVolume, setDeleteVolume] = useState(false);

  if (error) return <ErrorBanner error={error} title="Could not load this database" />;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const running = data.status === 'running';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{data.name}</h1>
        <StatusBadge status={data.status} />
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setConfirm('restart')}>
            Restart
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => (running ? setConfirm('stop') : lifecycle.mutate('start'))}
          >
            {running ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setTypedName('');
              setDeleteVolume(false);
              setConfirm('delete');
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <ErrorBanner error={lifecycle.error} title="Action failed" />
      <ErrorBanner error={remove.error} title="Delete failed" />

      <section className="card">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <Fact label="Description" value={data.description ?? '—'} />
          <Fact label="Image" value={data.image} />
          <Fact label="Postgres version" value={data.version} />
          <Fact
            label="Access"
            value={data.isPublic ? `public · port ${data.publicPort ?? '?'}` : 'internal only'}
          />
          <Fact label="SSL" value={data.sslEnabled ? 'enabled (require)' : 'disabled'} />
          <Fact
            label="Created"
            value={data.createdAt ? new Date(data.createdAt).toLocaleString() : '—'}
          />
        </dl>
        {data.coolifyUrl && (
          <a
            className="mt-4 inline-block text-sm text-slate-600 underline"
            href={data.coolifyUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Coolify
          </a>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Connection</h2>
        <ConnectionString
          label="Public"
          value={data.publicUrl}
          hint={
            data.publicUrl
              ? `Host ${meta.data?.publicHost ?? ''} — only reachable from IPs the Hetzner firewall allows.`
              : undefined
          }
        />
        <ConnectionString label="Internal (Docker network)" value={data.internalUrl} />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Backups</h2>
        {data.backup ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <Fact label="Enabled" value={data.backup.enabled ? 'yes' : 'no'} />
            <Fact label="Schedule" value={data.backup.frequency ?? '—'} />
            <Fact
              label="Last run"
              value={
                data.backup.lastRunAt
                  ? `${new Date(data.backup.lastRunAt).toLocaleString()} (${data.backup.lastRunStatus ?? 'unknown'})`
                  : 'never'
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-slate-600">
            No backup schedule is visible through this Coolify version&apos;s API.{' '}
            {data.coolifyUrl && (
              <a className="underline" href={data.coolifyUrl} target="_blank" rel="noreferrer">
                Configure backups in Coolify
              </a>
            )}
          </p>
        )}
      </section>

      <MetaCard uuid={uuid} meta={data.meta} />

      <ConfirmDialog
        open={confirm === 'restart' || confirm === 'stop'}
        title={confirm === 'stop' ? `Stop ${data.name}?` : `Restart ${data.name}?`}
        confirmLabel={confirm === 'stop' ? 'Stop' : 'Restart'}
        busy={lifecycle.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          lifecycle.mutate(confirm === 'stop' ? 'stop' : 'restart', {
            onSettled: () => setConfirm(null),
          });
        }}
      >
        <p>Connected applications will lose their connections while this happens.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Delete ${data.name}?`}
        confirmLabel="Delete database"
        confirmDisabled={typedName !== data.name}
        busy={remove.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          remove.mutate(
            { confirmName: typedName, deleteVolume },
            { onSuccess: () => void navigate({ to: '/' }) },
          );
        }}
      >
        <p>
          Type <code className="font-mono font-semibold">{data.name}</code> to confirm.
        </p>
        <input
          className="input"
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          aria-label="Confirm database name"
        />
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={deleteVolume}
            onChange={(event) => setDeleteVolume(event.target.checked)}
          />
          <span>
            Also delete the data volume.{' '}
            <strong>This destroys the data permanently.</strong> Leave it unchecked to keep the
            volume.
          </span>
        </label>
      </ConfirmDialog>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
