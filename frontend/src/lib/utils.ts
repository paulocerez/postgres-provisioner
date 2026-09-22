import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's class merger, used only by the primitives in `components/ui`. The
 * rest of the app composes classes as plain template strings — `cn` exists so
 * those files stay close enough to upstream to re-diff against a new version.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
