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
import {
  databasesQuery,
  jobQuery,
  metaQuery,
  useContinueJob,
  useCreateDatabase,
} from '../../api/queries';
import { ErrorBanner } from '../../components/error-banner';
import { PageHeader } from '../../components/page-header';
import { ProgressSteps } from '../../components/progress-steps';
import { ChevronRightIcon } from '../../components/icons';

export const Route = createFileRoute('/_auth/new')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(databasesQuery),
      context.queryClient.ensureQueryData(metaQuery),
    ]);
  },
  component: NewDatabasePage,
});

/** A section heading inside the form, separated by a hairline from the one above. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4 first:border-t-0">
      <h2 className="mb-3 text-2xs font-medium uppercase text-subtle">{title}</h2>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

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
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="New database"
        description="Provisions a Postgres container in the Coolify project and records it here."
      />

      <ErrorBanner error={create.error} title="Could not start the create job" />

      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Section title="Identity">
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
                <p className="hint">
                  Lowercase letters, numbers and hyphens. Will be created as{' '}
                  <code className="font-mono text-fg">
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
                  Description <span className="font-normal text-subtle">(optional)</span>
                </label>
                <input
                  id={field.name}
                  className="input"
                  maxLength={200}
                  placeholder="What this database is for."
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
        </Section>

        <Section title="Engine">
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
                  onChange={(e) =>
                    field.handleChange(e.target.value as CreateDatabaseInput['version'])
                  }
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
        </Section>

        <Section title="Access">
          <form.Field name="access">
            {(field) => (
              <fieldset>
                <legend className="sr-only">Access</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      [
                        'public',
                        'Public',
                        `Gets a host port in ${meta.data?.portRange.start ?? '?'}–${meta.data?.portRange.end ?? '?'}.`,
                      ],
                      [
                        'internal',
                        'Internal only',
                        'Reachable from the Docker network only.',
                      ],
                    ] as const
                  ).map(([value, title, detail]) => {
                    const selected = field.state.value === value;
                    return (
                      // A selectable card rather than a bare radio: the choice
                      // carries a consequence worth spelling out.
                      <label
                        key={value}
                        className={`flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors ${
                          selected
                            ? 'border-accent bg-accent/[0.06]'
                            : 'border-line hover:border-line-strong hover:bg-raised'
                        }`}
                      >
                        <input
                          type="radio"
                          name={field.name}
                          value={value}
                          className="mt-0.5 accent-[rgb(var(--accent))]"
                          checked={selected}
                          onChange={() => field.handleChange(value)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-fg">{title}</span>
                          <span className="mt-0.5 block text-xs text-muted">{detail}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </form.Field>
        </Section>

        <Section title="Backups">
          <form.Field name="backups">
            {(field) => (
              <div>
                <label className="flex items-start gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="checkbox mt-0.5"
                    disabled={!backupsSupported}
                    checked={backupsSupported && field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  Daily backup at 03:00, 14 days retained
                </label>
                {!backupsSupported && (
                  <p className="mt-1.5 text-xs text-warning">
                    This Coolify version has no backups API (or COOLIFY_S3_STORAGE_UUID is unset).
                    Configure the backup in Coolify after the database is created.
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </Section>

        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-fg">
            <ChevronRightIcon className="transition-transform group-open:rotate-90" />
            Notes (stored locally, not in Coolify)
          </summary>
          <div className="space-y-3.5 px-4 pb-4">
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

        <div className="flex justify-end gap-2 border-t border-line bg-raised/40 px-4 py-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void navigate({ to: '/' })}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create database'}
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
  const resume = useContinueJob(jobId);

  useEffect(() => {
    if (job.data?.status === 'done' && job.data.result) {
      void navigate({ to: '/db/$uuid', params: { uuid: job.data.result.uuid } });
    }
  }, [job.data, navigate]);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Creating database"
        description="This takes a moment — the page moves on by itself when it lands."
      />

      <div className="card">
        <div className="card-body">
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
            <div className="space-y-2.5">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-4 w-3/5" />
            </div>
          )}
        </div>
      </div>

      <ErrorBanner error={job.error} title="Lost track of the job" />
      <ErrorBanner error={resume.error} title="Could not continue" />

      {job.data?.status === 'paused' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={resume.isPending}
            onClick={() => resume.mutate(false)}
          >
            {resume.isPending ? 'Checking…' : "I've enabled SSL — continue"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={resume.isPending}
            onClick={() => resume.mutate(true)}
            title="Starts the database with SSL disabled. Connections will not be encrypted."
          >
            Continue without SSL
          </button>
        </div>
      )}

      {job.data?.status === 'failed' && (
        <div className="flex flex-wrap gap-2">
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
