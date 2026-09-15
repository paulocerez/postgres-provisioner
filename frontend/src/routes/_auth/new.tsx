import {
  PG_VERSIONS,
  type CreateDatabaseInput,
  createDatabaseSchema,
  imageForVersion,
  normaliseDatabaseName,
} from '@app/shared';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { databasesQuery, jobQuery, metaQuery, useCreateDatabase } from '../../api/queries';
import { ErrorBanner } from '../../components/ErrorBanner';
import { ProgressSteps } from '../../components/ProgressSteps';

export const Route = createFileRoute('/_auth/new')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(databasesQuery),
      context.queryClient.ensureQueryData(metaQuery),
    ]);
  },
  component: NewDatabasePage,
});

function NewDatabasePage() {
  const navigate = useNavigate();
  const databases = useQuery(databasesQuery);
  const meta = useQuery(metaQuery);
  const create = useCreateDatabase();
  const [jobId, setJobId] = useState<string | null>(null);

  const backupsSupported = meta.data?.backupsSupported ?? false;
  const existingNames = new Set(
    (databases.data?.databases ?? []).map((database) => database.name.toLowerCase()),
  );

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      version: '18',
      access: 'public',
      backups: true,
      project: '',
      owner: '',
      notes: '',
    } as CreateDatabaseInput & { description: string; project: string; owner: string; notes: string },
    validators: { onSubmit: createDatabaseSchema },
    onSubmit: async ({ value }) => {
      const response = await create.mutateAsync({
        ...value,
        description: value.description?.trim() || undefined,
        project: value.project?.trim() || undefined,
        owner: value.owner?.trim() || undefined,
        notes: value.notes?.trim() || undefined,
        backups: backupsSupported ? value.backups : false,
      });
      setJobId(response.jobId);
    },
  });

  if (jobId) return <CreateProgress jobId={jobId} />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">New database</h1>

      <ErrorBanner error={create.error} title="Could not start the create job" />

      <form
        className="card space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="name"
          validators={{
            // Checked here so a duplicate never reaches the API; the server
            // re-checks against Coolify anyway.
            onChange: ({ value }) =>
              existingNames.has(normaliseDatabaseName(value))
                ? `A database named "${normaliseDatabaseName(value)}" already exists.`
                : undefined,
          }}
        >
          {(field) => (
            <div>
              <label className="label" htmlFor={field.name}>
                Name
              </label>
              <input
                id={field.name}
                className="input"
                autoFocus
                placeholder="quotes"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value.toLowerCase())}
              />
              <p className="mt-1 text-xs text-slate-500">
                Lowercase letters, numbers and hyphens. Will be created as{' '}
                <code className="font-mono">
                  {field.state.value ? normaliseDatabaseName(field.state.value) : '<name>-db'}
                </code>
                .
              </p>
              {field.state.meta.errors.length > 0 && (
                <p className="field-error">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <div>
              <label className="label" htmlFor={field.name}>
                Description <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id={field.name}
                className="input"
                maxLength={200}
                value={field.state.value ?? ''}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="field-error">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="version">
          {(field) => (
            <div>
              <label className="label" htmlFor={field.name}>
                Postgres version
              </label>
              <select
                id={field.name}
                className="input"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as CreateDatabaseInput['version'])}
              >
                {PG_VERSIONS.map((version) => (
                  <option key={version} value={version}>
                    {version} — {imageForVersion(version)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="access">
          {(field) => (
            <fieldset>
              <legend className="label">Access</legend>
              <div className="space-y-2">
                {(
                  [
                    ['public', `Public — gets a host port in ${meta.data?.portRange.start ?? '?'}–${meta.data?.portRange.end ?? '?'}`],
                    ['internal', 'Internal only — reachable from the Docker network'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={field.name}
                      value={value}
                      checked={field.state.value === value}
                      onChange={() => field.handleChange(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </form.Field>

        <form.Field name="backups">
          {(field) => (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!backupsSupported}
                  checked={backupsSupported && field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                />
                Daily backup at 03:00, 14 days retained
              </label>
              {!backupsSupported && (
                <p className="mt-1 text-xs text-amber-700">
                  This Coolify version has no backups API (or COOLIFY_S3_STORAGE_UUID is unset).
                  Configure the backup in Coolify after the database is created.
                </p>
              )}
            </div>
          )}
        </form.Field>

        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Notes (stored locally, not in Coolify)
          </summary>
          <div className="mt-3 space-y-3">
            {(['project', 'owner', 'notes'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <div>
                    <label className="label capitalize" htmlFor={field.name}>
                      {name}
                    </label>
                    <input
                      id={field.name}
                      className="input"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            ))}
          </div>
        </details>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create database'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void navigate({ to: '/' })}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** Polls the job every 2s and jumps to the details page once it lands. */
function CreateProgress({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const job = useQuery(jobQuery(jobId));
  const meta = useQuery(metaQuery);

  useEffect(() => {
    if (job.data?.status === 'done' && job.data.result) {
      void navigate({ to: '/db/$uuid', params: { uuid: job.data.result.uuid } });
    }
  }, [job.data, navigate]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Creating database</h1>
      <div className="card">
        {job.data ? (
          <ProgressSteps
            job={job.data}
            coolifyUrl={
              job.data.result && meta.data
                ? `${meta.data.coolifyUrl}/project/${meta.data.projectUuid}/${meta.data.environment}/database/${job.data.result.uuid}`
                : undefined
            }
          />
        ) : (
          <p className="text-sm text-slate-500">Starting…</p>
        )}
      </div>
      <ErrorBanner error={job.error} title="Lost track of the job" />
      {job.data?.status === 'failed' && (
        <div className="flex gap-2">
          {job.data.result && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const uuid = job.data?.result?.uuid;
                if (uuid) void navigate({ to: '/db/$uuid', params: { uuid } });
              }}
            >
              Open the database anyway
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => void navigate({ to: '/' })}>
            Back to the list
          </button>
        </div>
      )}
    </div>
  );
}
