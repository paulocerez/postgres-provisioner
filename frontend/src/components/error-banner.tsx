import { ApiError } from '../api/client';
import { AlertIcon } from './icons';

/**
 * Coolify failures must be visible, never swallowed into an empty table — see
 * acceptance criterion 6.
 */
export function ErrorBanner({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;

  const message = error instanceof Error ? error.message : String(error);
  const coolifyStatus = error instanceof ApiError ? error.coolifyStatus : undefined;

  return (
    <div role="alert" className="alert-danger">
      <AlertIcon className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="font-medium">{title ?? 'Something went wrong'}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-muted">{message}</p>
        {coolifyStatus !== undefined && (
          <p className="mt-1 text-xs text-subtle">Coolify responded with HTTP {coolifyStatus}.</p>
        )}
      </div>
    </div>
  );
}
