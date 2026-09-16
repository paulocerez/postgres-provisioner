import { useCallback } from 'react';
import { useToast } from '../components/toaster';

/**
 * Copy to the clipboard and say so. Shared by every copyable thing on the
 * details page, so the failure message stays identical everywhere.
 */
export function useCopy() {
  const notify = useToast();

  return useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify(`${what} copied to the clipboard.`);
      } catch {
        // Clipboard access is denied over plain http on some browsers; saying so
        // beats a button that silently does nothing.
        notify('The browser blocked clipboard access.', 'error');
      }
    },
    [notify],
  );
}
