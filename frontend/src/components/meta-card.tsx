import type { DatabaseMeta } from '@app/shared';
import { useState } from 'react';
import { useUpdateMeta } from '../api/queries';
import { ErrorBanner } from './error-banner';
import { useToast } from './toaster';

/**
 * Project / owner / notes live only in our SQLite — Coolify has nowhere to put
 * them. Saving here never touches the Coolify resource.
 */
export function MetaCard({ uuid, meta }: { uuid: string; meta: DatabaseMeta | null }) {
  const update = useUpdateMeta(uuid);
  const notify = useToast();
  const [form, setForm] = useState({
    project: meta?.project ?? '',
    owner: meta?.owner ?? '',
    notes: meta?.notes ?? '',
  });

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          {
            project: form.project.trim() || null,
            owner: form.owner.trim() || null,
            notes: form.notes.trim() || null,
          },
          { onSuccess: () => notify('Notes saved.') },
        );
      }}
    >
      <div className="card-header">
        <h2 className="card-title">Notes</h2>
        <span className="text-xs text-subtle">Stored locally, not in Coolify</span>
      </div>

      <div className="card-body space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="meta-project">
              Project
            </label>
            <input
              id="meta-project"
              className="input"
              placeholder="—"
              value={form.project}
              onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="meta-owner">
              Owner
            </label>
            <input
              id="meta-owner"
              className="input"
              placeholder="—"
              value={form.owner}
              onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="meta-notes">
            Notes
          </label>
          <textarea
            id="meta-notes"
            className="input min-h-20 resize-y"
            placeholder="Anything worth remembering about this database."
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <ErrorBanner error={update.error} title="Could not save" />

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
