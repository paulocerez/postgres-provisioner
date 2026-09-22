import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  databaseQuery,
  metaQuery,
  useDeleteDatabase,
  useLifecycleAction,
} from '../../api/queries';
import { AllowlistCard } from '../../components/allowlist-card';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { ConnectedProjectsCard } from '../../components/connected-projects-card';
import { ConnectionString } from '../../components/connection-string';
import { ErrorBanner } from '../../components/error-banner';
import { MetaCard } from '../../components/meta-card';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { useToast } from '../../components/toaster';
import {
  AlertIcon,
  ExternalLinkIcon,
  PlayIcon,
  RestartIcon,
  StopIcon,
  TrashIcon,
} from '../../components/icons';

export const Route = createFileRoute('/_auth/db/$uuid')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(databaseQuery(params.uuid)),
  errorComponent: ({ error }) => <ErrorBanner error={error} title="Could not load this database" />,
  component: DatabaseDetailPage,
});

function DatabaseDetailPage() {
  const { uuid } = Route.useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const { data, error } = useQuery(databaseQuery(uuid));
  const meta = useQuery(metaQuery);
  const lifecycle = useLifecycleAction(uuid);
  const remove = useDeleteDatabase(uuid);

  const [confirm, setConfirm] = useState<'restart' | 'stop' | 'delete' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [deleteVolume, setDeleteVolume] = useState(false);

  if (error) return <ErrorBanner error={error} title="Could not load this database" />;
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-32 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  const running = data.status === 'running';

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.name}
        badge={<StatusBadge status={data.status} />}
        description={data.description ?? undefined}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary gap-1.5"
              onClick={() => setConfirm('restart')}
            >
              <RestartIcon />
              Restart
            </button>
            <button
              type="button"
              className="btn-secondary gap-1.5"
              onClick={() =>
                running
                  ? setConfirm('stop')
                  : lifecycle.mutate('start', { onSuccess: () => notify('Start requested.') })
              }
            >
              {running ? <StopIcon /> : <PlayIcon />}
              {running ? 'Stop' : 'Start'}
            </button>
            <button
              type="button"
              className="btn-danger gap-1.5"
              onClick={() => {
                setTypedName('');
                setDeleteVolume(false);
                setConfirm('delete');
              }}
            >
              <TrashIcon />
              Delete
            </button>
          </>
        }
      />

      <ErrorBanner error={lifecycle.error} title="Action failed" />
      <ErrorBanner error={remove.error} title="Delete failed" />

      {/*
        SSL cannot be set through the Coolify API, so this is a warning rather
        than something the app offers to fix.
      */}
      {!data.sslEnabled && (
        <div role="alert" className="alert-danger">
          <AlertIcon className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="font-medium">SSL is disabled</p>
            <p className="mt-0.5 text-muted">
              {data.isPublic
                ? 'This database is reachable on a host port and connections are not encrypted — credentials and data cross the network in the clear.'
                : 'Connections to this database are not encrypted.'}{' '}
              Coolify&apos;s API cannot change this setting; enable SSL in the Coolify UI.
            </p>
          </div>
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Overview</h2>
          {data.coolifyUrl && (
            <a
              className="link inline-flex items-center gap-1 text-sm"
              href={data.coolifyUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Coolify
              <ExternalLinkIcon width="12" height="12" />
            </a>
          )}
        </div>
        {/* Facts carry a top border rather than a bottom one so the last row
            never doubles up against the card's own edge, whatever the count. */}
        <dl className="grid grid-cols-1 [&>*:first-child]:border-t-0 sm:grid-cols-2 sm:[&>*:nth-child(2)]:border-t-0">
          <Fact label="Image" value={data.image} mono />
          <Fact label="Postgres version" value={data.version} />
          <Fact
            label="Access"
            value={data.isPublic ? `Public · port ${data.publicPort ?? '?'}` : 'Internal only'}
          />
          <Fact label="SSL" value={data.sslEnabled ? 'Enabled (require)' : 'Disabled'} />
          <Fact
            label="Created"
            value={data.createdAt ? new Date(data.createdAt).toLocaleString() : '—'}
          />
          <Fact label="UUID" value={data.uuid} mono />
        </dl>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div className="card-body space-y-4">
          {/*
            Coolify never discloses a database password, so the only ones we can
            show are those this app generated. Say so plainly rather than
            rendering a string that would not connect.
          */}
          {!data.postgresPassword && (
            <div className="alert-warning">
              <AlertIcon className="mt-0.5 shrink-0 text-warning" />
              <p className="text-muted">
                This database was not created through this app, so its password is not recoverable —
                Coolify&apos;s API does not disclose one. Connect using the credentials you already
                hold, or read them from the container in Coolify.
              </p>
            </div>
          )}

          <ConnectionString
            label="Public"
            value={data.publicUrl}
            hint={
              data.publicUrl
                ? data.firewall.managed
                  ? `Host ${meta.data?.publicHost ?? ''} — reachable only from the sources allowed below.`
                  : `Host ${meta.data?.publicHost ?? ''} — only reachable from IPs the Hetzner firewall allows.`
                : undefined
            }
          />
          <ConnectionString
            label="Internal (Docker network)"
            value={data.internalUrl}
            hint={data.internalUrl ? 'For other containers on the Coolify network.' : undefined}
          />
          {/*
            Only rendered when a gateway is configured. It is the one string
            that works from an address you cannot enumerate — serverless egress,
            CI — because it is authenticated by a real certificate rather than
            by where the client happens to be connecting from.
          */}
          {data.gatewayUrl && (
            <ConnectionString
              label="Over TLS (works from anywhere)"
              value={data.gatewayUrl}
              hint="No firewall rule needed. Requires PostgreSQL 17+ and a client that supports sslnegotiation=direct — node-postgres does; many other drivers do not yet."
            />
          )}
        </div>
      </section>

      {/*
        Hidden unless a VERCEL_TOKEN is configured. The key re-seeds the card
        after a push, on the same reasoning as the allowlist card below.
      */}
      {data.vercelManaged && (
        <ConnectedProjectsCard
          key={`${uuid}:${data.links.length}`}
          uuid={uuid}
          links={data.links}
          hasPassword={data.postgresPassword !== null}
          gatewayAvailable={data.gatewayUrl !== null}
          publicAvailable={data.publicUrl !== null}
        />
      )}

      {/*
        Only for public databases: an internal-only one never passes through the
        firewall, so an allowlist would be a control that does nothing.
        The key re-seeds the card's local list after a successful save, without
        clobbering an in-progress edit — the detail query does not poll.
      */}
      {data.firewall.managed && data.isPublic && (
        <AllowlistCard
          key={data.allowlist.map((entry) => entry.cidr).join(',')}
          uuid={uuid}
          entries={data.allowlist}
          conflictingRule={data.firewall.conflictingRule}
          reachable={data.firewall.reachable}
        />
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Backups</h2>
        </div>
        {data.backup ? (
          <dl className="grid grid-cols-1 [&>*:first-child]:border-t-0 sm:grid-cols-2 sm:[&>*:nth-child(2)]:border-t-0">
            <Fact label="Enabled" value={data.backup.enabled ? 'Yes' : 'No'} />
            <Fact label="Schedule" value={data.backup.frequency ?? '—'} mono />
            <Fact
              label="Last run"
              value={
                data.backup.lastRunAt
                  ? `${new Date(data.backup.lastRunAt).toLocaleString()} (${data.backup.lastRunStatus ?? 'unknown'})`
                  : 'Never'
              }
            />
          </dl>
        ) : (
          <div className="card-body">
            <p className="text-sm text-muted">
              No backup schedule is visible through this Coolify version&apos;s API.{' '}
              {data.coolifyUrl && (
                <a className="link" href={data.coolifyUrl} target="_blank" rel="noreferrer">
                  Configure backups in Coolify
                </a>
              )}
            </p>
          </div>
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
          const action = confirm === 'stop' ? 'stop' : 'restart';
          lifecycle.mutate(action, {
            onSuccess: () => notify(`${action === 'stop' ? 'Stop' : 'Restart'} requested.`),
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
            {
              onSuccess: () => {
                notify(`${data.name} deleted.`);
                void navigate({ to: '/' });
              },
            },
          );
        }}
      >
        <p>
          Type <code className="font-mono font-semibold text-fg">{data.name}</code> to confirm.
        </p>
        <input
          className="input"
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          aria-label="Confirm database name"
          autoComplete="off"
        />
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="checkbox mt-0.5"
            checked={deleteVolume}
            onChange={(event) => setDeleteVolume(event.target.checked)}
          />
          <span>
            Also delete the data volume.{' '}
            <strong className="font-medium text-danger">This destroys the data permanently.</strong>{' '}
            Leave it unchecked to keep the volume.
          </span>
        </label>
      </ConfirmDialog>
    </div>
  );
}

/** One label/value pair in the overview grid, on a hairline-separated cell. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 border-t border-line px-4 py-2.5">
      <dt className="w-32 shrink-0 text-sm text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-sm text-fg ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
