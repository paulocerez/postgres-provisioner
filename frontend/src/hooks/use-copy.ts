import { useCallback } from 'react';
import { useToast } from '../components/toaster';

/**
 * Copies via the deprecated `execCommand`, which — unlike the clipboard API —
 * still works outside a secure context. The textarea has to be in the document
 * and selectable, so it is moved off-screen rather than hidden.
 */
function copyWithExecCommand(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';

  document.body.append(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Puts `text` on the clipboard, returning whether it worked.
 *
 * `navigator.clipboard` only exists in a secure context, and this app is served
 * over plain http on its Hetzner host — so the API is missing exactly where the
 * copy buttons matter most, and `execCommand` carries the load there.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or a blocked document; fall through to execCommand.
    }
  }
  return copyWithExecCommand(text);
}

type Copy = (text: string, what: string, onFallback?: () => void) => Promise<void>;

/**
 * `copy(text, what, onFallback?)` — copies and confirms with a toast. When both
 * clipboard paths fail, `onFallback` gets the chance to select the text in the
 * page so the operator can still copy it by hand.
 */
export function useCopy(): Copy {
  const notify = useToast();

  return useCallback<Copy>(
    async (text, what, onFallback) => {
      if (await copyText(text)) {
        notify(`${what} copied to the clipboard.`);
        return;
      }

      onFallback?.();
      notify("Couldn't copy automatically — the text is selected, press ⌘C.", 'error');
    },
    [notify],
  );
}
