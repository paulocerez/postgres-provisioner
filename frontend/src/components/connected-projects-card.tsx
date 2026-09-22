import {
  type ProjectLink,
  VERCEL_TARGETS,
  type VercelTarget,
  envKeySchema,
} from '@app/shared';
import { useState } from 'react';
import { useLinkProject, useUnlinkProject, useVercelProjects } from '../api/queries';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState } from './empty-state';
import { ErrorBanner } from './error-banner';
import { AlertIcon, PlusIcon, TrashIcon } from './icons';
import { ProjectCombobox } from './project-combobox';
import { useToast } from './toaster';

/**
 * The projects holding a connection string to this database.
 *
 * Unlike `AllowlistCard` this is not desired state — nothing reconciles it, and
 * each row records a push that happened rather than a thing still in force.
 * Vercel stores the variable write-only, so neither this app nor the dashboard
 * can read it back to check; the card shows when it was written and leaves the
 * inference to the reader rather than implying more than it knows.
 */
export function ConnectedProjectsCard({
  uuid,
  links,
  hasPassword,
  gatewayAvailable,
  publicAvailable,
}: {
  uuid: string;
  links: ProjectLink[];
  hasPassword: boolean;
  gatewayAvailable: boolean;
  /** Whether this database has a host port at all — false for internal-only. */
  publicAvailable: boolean;
}) {
  const link = useLinkProject(uuid);
  const unlink = useUnlinkProject(uuid);
  const notify = useToast();

  const [picking, setPicking] = useState(false);
  const projects = useVercelProjects(picking);

  const [projectId, setProjectId] = useState('');
  const [envKey, setEnvKey] = useState('DATABASE_URL');
  const [targets, setTargets] = useState<VercelTarget[]>([...VERCEL_TARGETS]);
  const [formError, setFormError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<ProjectLink | null>(null);

  const chosen = projects.data?.projects.find((p) => p.id === projectId);
  /*
    An internal-only database with no gateway has no string that would work off
    this server. The push refuses it, but saying so before the operator fills
    the form in is the difference between a hint and an error message.
  */
  const reachable = gatewayAvailable || publicAvailable;

  function submit() {
    const key = envKeySchema.safeParse(envKey);
    if (!chosen) {
      setFormError('Choose a project.');
      return;
    }
    if (!key.success) {
      setFormError(key.error.issues[0]?.message ?? 'Not a usable variable name.');
      return;
    }
    if (targets.length === 0) {
      setFormError('Choose at least one environment.');
      return;
    }
    setFormError(null);
    link.mutate(
      {
        platform: 'vercel',
        projectId: chosen.id,
        projectName: chosen.name,
        envKey: key.data,
        targets,
      },
      {
        onSuccess: () => {
          notify(`${key.data} set on ${chosen.name}.`);
          setPicking(false);
          setProjectId('');
        },
      },
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Connected projects</h2>
        <span className="text-xs text-subtle">Vercel</span>
      </div>

      {!hasPassword && (
        <div className="px-4 pt-4">
          <div role="alert" className="alert-warning">
            <AlertIcon className="mt-0.5 shrink-0 text-warning" />
            <p className="text-muted">
              This database&apos;s password is not recoverable, so there is no connection string to
              send. It was created outside this app.
            </p>
          </div>
        </div>
      )}

      {hasPassword && !reachable && (
        <div className="px-4 pt-4">
          <div role="alert" className="alert-warning">
            <AlertIcon className="mt-0.5 shrink-0 text-warning" />
            <p className="text-muted">
              This database is internal-only and no TLS gateway is configured, so it has no
              connection string that would work from off this server. Nothing to connect yet.
            </p>
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <EmptyState
          title="Not connected to anything"
          description="Push this database's connection string straight into a Vercel project's environment variables."
        />
      ) : (
        <ul>
          {links.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline gap-4 border-t border-line px-4 py-2.5 first:border-t-0"
            >
              <span className="w-44 shrink-0 truncate text-sm text-fg">{entry.projectName}</span>
              <span className="min-w-0 flex-1 break-words text-sm text-muted">
                <span className="font-mono text-xs">{entry.envKey}</span>
                {' · '}
                {entry.targets.join(', ')}
                {entry.urlKind === 'public' && (
                  <>
                    {' · '}
                    <span className="text-warning">public port</span>
                  </>
                )}
              </span>
              <span className="shrink-0 text-xs text-subtle">
                {new Date(entry.linkedAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                className="btn-ghost btn-icon shrink-0"
                aria-label={`Forget ${entry.projectName}`}
                onClick={() => setForgetting(entry)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="card-body space-y-3.5 border-t border-line">
        {!picking ? (
          <button
            type="button"
            className="btn-secondary gap-1.5"
            disabled={!hasPassword || !reachable}
            onClick={() => setPicking(true)}
          >
            <PlusIcon />
            Connect a project
          </button>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1">
                <label className="label" id="link-project-label" htmlFor="link-project">
                  Project
                </label>
                <ProjectCombobox
                  id="link-project"
                  labelId="link-project-label"
                  value={projectId}
                  onChange={(next) => {
                    setProjectId(next);
                    setFormError(null);
                  }}
                  projects={projects.data?.projects ?? []}
                  loading={projects.isPending}
                  // Nothing to pick from behind the error banner below.
                  disabled={projects.isError}
                />
              </div>
              <div className="sm:w-52">
                <label className="label" htmlFor="link-env-key">
                  Variable name
                </label>
                <input
                  id="link-env-key"
                  className="input font-mono text-xs"
                  value={envKey}
                  onChange={(event) => {
                    setEnvKey(event.target.value.toUpperCase());
                    setFormError(null);
                  }}
                />
              </div>
            </div>

            <fieldset>
              <legend className="label">Environments</legend>
              <div className="flex flex-wrap gap-4">
                {VERCEL_TARGETS.map((target) => (
                  <label key={target} className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={targets.includes(target)}
                      onChange={(event) => {
                        setTargets(
                          event.target.checked
                            ? [...targets, target]
                            : targets.filter((t) => t !== target),
                        );
                        setFormError(null);
                      }}
                    />
                    {target}
                  </label>
                ))}
              </div>
            </fieldset>

            {!gatewayAvailable && (
              <p className="hint">
                No TLS gateway is configured, so the public connection string will be sent — the
                project&apos;s address must be allowed through the firewall for it to work.
              </p>
            )}

            <ErrorBanner error={projects.error} title="Could not list Vercel projects" />
            {formError && <p className="field-error">{formError}</p>}
            <ErrorBanner error={link.error} title="Could not connect the project" />

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setPicking(false);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={link.isPending}
                onClick={submit}
              >
                {link.isPending ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </>
        )}

        <ErrorBanner error={unlink.error} title="Could not forget the link" />
      </div>

      <ConfirmDialog
        open={forgetting !== null}
        title="Forget this connection?"
        confirmLabel="Forget it"
        busy={unlink.isPending}
        onConfirm={() => {
          const target = forgetting;
          if (!target) return;
          unlink.mutate(target.id, {
            onSuccess: () => {
              notify('Link forgotten.');
              setForgetting(null);
            },
          });
        }}
        onCancel={() => setForgetting(null)}
      >
        <p>
          This removes the record here only.{' '}
          <span className="font-mono text-xs">{forgetting?.envKey}</span> stays set on{' '}
          {forgetting?.projectName}, because deleting it could break that project&apos;s next
          deploy.
        </p>
        <p>Remove it in Vercel&apos;s dashboard if you want it gone for real.</p>
      </ConfirmDialog>
    </section>
  );
}
