import { useState } from 'react';
import { useCopy } from '../hooks/use-copy';
import { CopyIcon, EyeIcon, EyeOffIcon } from './icons';

/** Blank out the password in a `postgres://user:password@host` URL. */
export function maskUrl(value: string) {
  return value.replace(/:\/\/([^:]+):[^@]*@/, '://$1:••••••••@');
}

/**
 * Connection strings contain the database password, so they stay masked until
 * the operator asks for them — and are never logged or put in the URL.
 */
export function ConnectionString({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const copy = useCopy();

  if (!value) {
    return (
      <div>
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="mt-1 rounded-md border border-dashed border-line px-3 py-2.5 text-sm text-subtle">
          Not available.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-fg">{label}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={() => setRevealed((value) => !value)}
            title={revealed ? 'Hide the password' : 'Reveal the password'}
            aria-label={revealed ? 'Hide the password' : 'Reveal the password'}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={() => void copy(value, 'Connection string')}
            title="Copy the connection string"
            aria-label="Copy the connection string"
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className="btn-ghost"
            title="Copy as a DATABASE_URL= line for a .env file"
            onClick={() => void copy(`DATABASE_URL=${value}`, 'DATABASE_URL line')}
          >
            .env
          </button>
        </div>
      </div>
      <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2.5 font-mono text-xs text-fg">
        {revealed ? value : maskUrl(value)}
      </pre>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
