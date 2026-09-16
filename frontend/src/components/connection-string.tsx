import { useState } from 'react';
import { useToast } from './toaster';
import { CopyIcon, EyeIcon, EyeOffIcon } from './icons';

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
  const notify = useToast();

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

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied to the clipboard.`);
    } catch {
      // Clipboard access is denied over plain http on some browsers; saying so
      // beats a button that silently does nothing.
      notify('The browser blocked clipboard access.', 'error');
    }
  };

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
        {revealed ? value : value.replace(/:\/\/([^:]+):[^@]*@/, '://$1:••••••••@')}
      </pre>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
