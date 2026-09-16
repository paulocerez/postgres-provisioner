import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

/** Mirrors the key read by /public/theme.js before first paint. */
const STORAGE_KEY = 'theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

interface ThemeContextValue {
  /** What the operator chose — may be `system`. */
  theme: Theme;
  /** What is actually on screen once `system` is resolved. */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  /** Steps system → light → dark → system. */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Private mode: fall through to the default.
  }
  return 'system';
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState(prefersDark);

  // Keep following the OS while the preference is `system` — the toggle is a
  // preference, not a one-time snapshot.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const persist = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable; the session still honours the choice.
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      persist(next);
    },
    [persist],
  );

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
      persist(next);
      return next;
    });
  }, [persist]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
