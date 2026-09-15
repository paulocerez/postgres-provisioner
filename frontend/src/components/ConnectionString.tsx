import { useState } from 'react';

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
  const [copied, setCopied] = useState<'url' | 'env' | null>(null);

  if (!value) {
    return (
      <div className="text-sm">
        <p className="font-medium text-slate-700">{label}</p>
        <p className="text-slate-500">Not available.</p>
      </div>
    );
  }

  const copy = async (text: string, which: 'url' | 'env') => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-slate-700">{label}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setRevealed((v) => !v)}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void copy(value, 'url')}>
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            title="Copy as a DATABASE_URL= line for a .env file"
            onClick={() => void copy(`DATABASE_URL=${value}`, 'env')}
          >
            {copied === 'env' ? 'Copied' : 'Copy .env'}
          </button>
        </div>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
        {revealed ? value : value.replace(/:\/\/([^:]+):[^@]*@/, '://$1:••••••••@')}
      </pre>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
