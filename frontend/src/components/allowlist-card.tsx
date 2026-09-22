import { type AllowlistEntry, MAX_ALLOWLIST_ENTRIES, isOpenToWorld, parseCidr } from '@app/shared';
import { useState } from 'react';
import { useUpdateAllowlist } from '../api/queries';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState } from './empty-state';
import { ErrorBanner } from './error-banner';
import { AlertIcon, PlusIcon, TrashIcon } from './icons';
import { useToast } from './toaster';

/**
 * The sources allowed to reach this database's public port, applied to the
 * Hetzner firewall on save.
 *
 * Edits are local until Save, because the firewall is written as a whole — an
 * add and a remove in the same sitting should cost one rule change, not two.
 * Like `MetaCard`, the list is seeded from props once and not re-synced: after a
 * failed save the server has rolled its own rows back, and keeping what the
 * operator typed is more useful than silently reverting the form under them.
 */
export function AllowlistCard({
  uuid,
  entries: initial,
  conflictingRule,
  reachable,
}: {
  uuid: string;
  entries: AllowlistEntry[];
  conflictingRule: string | null;
  reachable: boolean;
}) {
  const save = useUpdateAllowlist(uuid);
  const notify = useToast();
  const [entries, setEntries] = useState(initial);
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [confirmingWorld, setConfirmingWorld] = useState(false);

  const dirty = JSON.stringify(entries) !== JSON.stringify(initial);
  const full = entries.length >= MAX_ALLOWLIST_ENTRIES;
  /*
    A `/0` entry is the one width that makes this card stop being a control:
    it allows every host on the internet, leaving only the password and TLS.
    It is sometimes the right answer — an allowlist cannot express serverless
    egress — so it is permitted, but never by accident.
  */
  const worldEntries = entries.filter((entry) => isOpenToWorld(entry.cidr));

  function add() {
    const parsed = parseCidr(cidr);
    if (!parsed.ok) {
      setAddError(parsed.message);
      return;
    }
    if (entries.some((entry) => entry.cidr === parsed.value)) {
      setAddError(`${parsed.value} is already on the list.`);
      return;
    }
    setEntries([...entries, { cidr: parsed.value, label: label.trim() || null }]);
    setCidr('');
    setLabel('');
    setAddError(null);
  }

  function commit() {
    setConfirmingEmpty(false);
    setConfirmingWorld(false);
    save.mutate(entries, { onSuccess: () => notify('Firewall updated.') });
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Allowed sources</h2>
        <span className="text-xs text-subtle">Hetzner firewall</span>
      </div>

      {!reachable && (
        <div className="px-4 pt-4">
          <div role="alert" className="alert-warning">
            <AlertIcon className="mt-0.5 shrink-0 text-warning" />
            <p className="text-muted">
              The firewall could not be read, so what is shown here is the list this app intends —
              not necessarily what is in force. Check HCLOUD_TOKEN and the Hetzner API.
            </p>
          </div>
        </div>
      )}

      {/*
        Ownership is narrow by design (inbound tcp, in the port range, described
        `pgp:<uuid>`), which means a hand-written rule covering this port is left
        alone — and keeps the port open regardless of this list. Saying so is the
        difference between a useful card and a misleading one.
      */}
      {conflictingRule && (
        <div className="px-4 pt-4">
          <div role="alert" className="alert-warning">
            <AlertIcon className="mt-0.5 shrink-0 text-warning" />
            <div>
              <p className="font-medium">Another firewall rule also covers this port</p>
              <p className="mt-0.5 text-muted">
                <span className="font-mono text-xs">{conflictingRule}</span> was not created by this
                app, so it is left untouched. Until you remove it in the Hetzner console this list
                can only widen access, never restrict it.
              </p>
            </div>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          title="No sources allowed"
          description="Nothing can reach this database on its public port. Add the egress address of the project that needs it."
        />
      ) : (
        <ul>
          {entries.map((entry) => (
            <li
              key={entry.cidr}
              className="flex items-baseline gap-4 border-t border-line px-4 py-2.5 first:border-t-0"
            >
              <span
                className={`w-44 shrink-0 font-mono text-xs ${
                  isOpenToWorld(entry.cidr) ? 'font-semibold text-danger' : 'text-fg'
                }`}
              >
                {entry.cidr}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm text-muted">
                {isOpenToWorld(entry.cidr) ? (
                  <>
                    <span className="text-danger">Every host on the internet</span>
                    {entry.label ? ` — ${entry.label}` : ''}
                  </>
                ) : (
                  (entry.label ?? '—')
                )}
              </span>
              <button
                type="button"
                className="btn-ghost btn-icon shrink-0"
                aria-label={`Remove ${entry.cidr}`}
                onClick={() => setEntries(entries.filter((e) => e.cidr !== entry.cidr))}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="card-body space-y-3.5 border-t border-line">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="sm:w-52">
            <label className="label" htmlFor="allowlist-cidr">
              Address or range
            </label>
            <input
              id="allowlist-cidr"
              className="input font-mono text-xs"
              placeholder="203.0.113.4/32"
              value={cidr}
              disabled={full}
              onChange={(event) => {
                setCidr(event.target.value);
                setAddError(null);
              }}
              onKeyDown={(event) => {
                // The card is not a <form>: Enter here must add a row, not save.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="allowlist-label">
              Label (optional)
            </label>
            <input
              id="allowlist-label"
              className="input"
              placeholder="Which project is this?"
              value={label}
              disabled={full}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary gap-1.5 sm:mt-[1.375rem]"
            onClick={add}
            disabled={full}
          >
            <PlusIcon />
            Add
          </button>
        </div>

        {addError && <p className="field-error">{addError}</p>}
        {full && (
          <p className="hint">
            {MAX_ALLOWLIST_ENTRIES} is the maximum per database. Use a wider range instead of more
            entries.
          </p>
        )}

        <ErrorBanner error={save.error} title="Could not update the firewall" />

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="mr-auto text-xs text-subtle">Unsaved changes</span>}
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              if (entries.length === 0) setConfirmingEmpty(true);
              else if (worldEntries.length > 0) setConfirmingWorld(true);
              else commit();
            }}
          >
            {save.isPending ? 'Applying…' : 'Apply to firewall'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingEmpty}
        title="Allow no sources?"
        confirmLabel="Close the port"
        busy={save.isPending}
        onConfirm={commit}
        onCancel={() => setConfirmingEmpty(false)}
      >
        <p>
          Saving an empty list removes this database&apos;s firewall rule entirely. No address will
          be able to connect on its public port, including anything connecting today.
        </p>
        <p>Containers on the Coolify network are unaffected — they never go through the firewall.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingWorld}
        title="Allow the entire internet?"
        confirmLabel="Open to the world"
        busy={save.isPending}
        onConfirm={commit}
        onCancel={() => setConfirmingWorld(false)}
      >
        <p>
          <span className="font-mono text-xs">
            {worldEntries.map((entry) => entry.cidr).join(' and ')}
          </span>{' '}
          allows every host on the internet to reach this database&apos;s public port. This list
          stops being a restriction.
        </p>
        <p>
          The only things still protecting it are its password and its TLS configuration. The port
          will be found by scanners within hours.
        </p>
      </ConfirmDialog>
    </section>
  );
}
