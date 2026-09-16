import { useEffect, useRef } from 'react';

type Handler = (event: KeyboardEvent) => void;

/**
 * Normalises a keydown into the same shape as a binding key: `mod+k`, `/`, `c`.
 * `mod` is ⌘ on Apple platforms and Ctrl elsewhere.
 */
function describe(event: KeyboardEvent): string {
  const mod = event.metaKey || event.ctrlKey ? 'mod+' : '';
  return `${mod}${event.key.toLowerCase()}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Installs a single document-level keydown listener for the given bindings.
 *
 * Bare-letter bindings are suppressed while the operator is typing in a field
 * or while any modal <dialog> is open — otherwise typing a database name into
 * the delete confirmation would fire navigation shortcuts. Bindings that
 * include `mod+` still fire, since those cannot be typed by accident.
 */
export function useHotkeys(bindings: Record<string, Handler>): void {
  // Held in a ref so callers can pass an inline object without re-binding the
  // listener on every render.
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = describe(event);
      const handler = latest.current[combo];
      if (!handler) return;

      const isModCombo = combo.startsWith('mod+');
      if (!isModCombo && (isTypingTarget(event.target) || document.querySelector('dialog[open]'))) {
        return;
      }

      event.preventDefault();
      handler(event);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
