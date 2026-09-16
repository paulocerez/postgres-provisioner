import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** `⌘` on Apple platforms, `Ctrl` everywhere else. */
export const modKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
