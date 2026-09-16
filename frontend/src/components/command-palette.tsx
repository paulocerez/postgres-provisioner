import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { databasesQuery, useLogout } from '../api/queries';
import { useHotkeys } from '../hooks/use-hotkeys';
import { useTheme } from '../theme';
import { Kbd, modKey } from './kbd';
import {
  DatabaseIcon,
  ListIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from './icons';

const OPEN_EVENT = 'command-palette:open';

/**
 * Opens the palette from anywhere without threading state through the layout —
 * used by the search affordance in the top bar.
 */
export function openCommandPalette(): void {
  document.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

interface Command {
  id: string;
  label: string;
  section: string;
  icon: ReactNode;
  /** Extra text matched by the filter but not displayed. */
  keywords?: string;
  hint?: ReactNode;
  run: () => void;
}

/**
 * ⌘K launcher. Built on the same native <dialog> as ConfirmDialog so focus
 * trapping and Escape come from the platform rather than a focus-trap library.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const logout = useLogout();
  const { setTheme } = useTheme();
  // Only fetched while the palette is open; the list page owns the polling.
  const databases = useQuery({ ...databasesQuery, enabled: open });

  useHotkeys({
    'mod+k': () => setOpen((value) => !value),
  });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery('');
      setActive(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const close = (action: () => void) => () => {
      setOpen(false);
      action();
    };

    const navigation: Command[] = [
      {
        id: 'nav-databases',
        label: 'Go to Databases',
        section: 'Navigation',
        icon: <ListIcon />,
        keywords: 'list home index',
        run: close(() => void navigate({ to: '/' })),
      },
      {
        id: 'nav-new',
        label: 'Create a database',
        section: 'Navigation',
        icon: <PlusIcon />,
        keywords: 'new add provision',
        hint: <Kbd>C</Kbd>,
        run: close(() => void navigate({ to: '/new' })),
      },
      {
        id: 'nav-audit',
        label: 'Go to Audit log',
        section: 'Navigation',
        icon: <ListIcon />,
        keywords: 'history events',
        run: close(() => void navigate({ to: '/audit' })),
      },
    ];

    const jumps: Command[] = (databases.data?.databases ?? []).map((database) => ({
      id: `db-${database.uuid}`,
      label: database.name,
      section: 'Databases',
      icon: <DatabaseIcon />,
      keywords: `${database.description ?? ''} ${database.meta?.project ?? ''} ${database.uuid}`,
      hint: <span className="text-2xs text-subtle">{database.status}</span>,
      run: close(() => void navigate({ to: '/db/$uuid', params: { uuid: database.uuid } })),
    }));

    const appearance: Command[] = [
      {
        id: 'theme-light',
        label: 'Switch to light theme',
        section: 'Appearance',
        icon: <SunIcon />,
        keywords: 'colour color mode',
        run: close(() => setTheme('light')),
      },
      {
        id: 'theme-dark',
        label: 'Switch to dark theme',
        section: 'Appearance',
        icon: <MoonIcon />,
        keywords: 'colour color mode night',
        run: close(() => setTheme('dark')),
      },
      {
        id: 'theme-system',
        label: 'Match system theme',
        section: 'Appearance',
        icon: <MonitorIcon />,
        keywords: 'colour color mode auto os',
        run: close(() => setTheme('system')),
      },
    ];

    const account: Command[] = [
      {
        id: 'logout',
        label: 'Log out',
        section: 'Account',
        icon: <LogOutIcon />,
        keywords: 'sign out exit',
        run: close(() =>
          logout.mutate(undefined, {
            onSettled: () => void navigate({ to: '/login', search: { redirect: undefined } }),
          }),
        ),
      },
    ];

    return [...navigation, ...jumps, ...appearance, ...account];
  }, [databases.data, logout, navigate, setTheme]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    // Every whitespace-separated term must appear somewhere, so "dark th" and
    // "th dark" both land on the theme command.
    const terms = needle.split(/\s+/);
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.section} ${command.keywords ?? ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [commands, query]);

  // Clamp the cursor whenever filtering shrinks the list under it.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, matches]);

  const sections = useMemo(() => {
    const grouped: { name: string; items: Command[] }[] = [];
    for (const command of matches) {
      const last = grouped.at(-1);
      if (last?.name === command.section) last.items.push(command);
      else grouped.push({ name: command.section, items: [command] });
    }
    return grouped;
  }, [matches]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={() => setOpen(false)}
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClick={(event) => {
        // A click that lands on the <dialog> itself is a backdrop click — the
        // content sits in a child element.
        if (event.target === dialogRef.current) setOpen(false);
      }}
      className="w-full max-w-lg animate-slide-up-fade rounded-xl border border-line bg-surface p-0 text-fg shadow-popover backdrop:bg-canvas/70 backdrop:backdrop-blur-sm open:mt-[12vh] open:mb-auto"
    >
      <div
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => (matches.length ? (index + 1) % matches.length : 0));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (matches.length ? (index - 1 + matches.length) % matches.length : 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            matches[active]?.run();
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <SearchIcon className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search databases and commands…"
            aria-label="Search databases and commands"
            aria-controls="command-palette-list"
            className="h-11 w-full bg-transparent text-base text-fg outline-none placeholder:text-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {matches.length === 0 && (
            <p className="px-2.5 py-8 text-center text-sm text-muted">No matching commands.</p>
          )}
          {sections.map((section) => (
            <div key={section.name} className="mb-1 last:mb-0">
              <p className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase text-subtle">
                {section.name}
              </p>
              {section.items.map((command) => {
                const index = matches.indexOf(command);
                const isActive = index === active;
                return (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onMouseMove={() => setActive(index)}
                    onClick={command.run}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${
                      isActive ? 'bg-raised text-fg' : 'text-muted'
                    }`}
                  >
                    <span className={isActive ? 'text-accent' : 'text-subtle'}>{command.icon}</span>
                    <span className="flex-1 truncate">{command.label}</span>
                    {command.hint}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2 text-2xs text-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to navigate <Kbd>↵</Kbd> to select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </div>
      </div>
    </dialog>
  );
}
