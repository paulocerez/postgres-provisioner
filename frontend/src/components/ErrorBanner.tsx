import { ApiError } from '../api/client';

/**
 * Coolify failures must be visible, never swallowed into an empty table — see
 * acceptance criterion 6.
 */
export function ErrorBanner({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;

  const message = error instanceof Error ? error.message : String(error);
  const coolifyStatus = error instanceof ApiError ? error.coolifyStatus : undefined;

  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">{title ?? 'Something went wrong'}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{message}</p>
      {coolifyStatus !== undefined && (
        <p className="mt-1 text-xs text-red-700">Coolify responded with HTTP {coolifyStatus}.</p>
      )}
    </div>
  );
}
