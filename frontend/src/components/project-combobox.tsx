import type { VercelProject } from '@app/shared';
import { useMemo, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * The Vercel project picker.
 *
 * A native <select> cannot hold a search field, and an account with dozens of
 * projects turns one into a wall of names. This shows ten at a time and leaves
 * the rest to the filter, saying how many it is holding back so the list never
 * looks like the whole truth.
 *
 * Presentational on purpose: the card above it still owns the query, the
 * selection and the error banner.
 */

/** How many rows the list shows at once. The rest are reachable by typing. */
const LIMIT = 10;

/*
  Four tints, all existing tokens at low alpha, so they follow the theme without
  a `dark:` variant. `danger` is deliberately absent — a red square beside a
  project name reads as a broken project rather than as its initial.
*/
const TINTS = [
  'bg-accent/10 text-accent',
  'bg-success/10 text-success',
  'bg-warning/10 text-warning',
  // A neutral, but still a tint: `bg-raised text-muted` all but vanished
  // against the popover in the dark theme.
  'bg-fg/10 text-fg',
] as const;

/** Hashed rather than indexed, so a project keeps its colour as the list moves. */
function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0];
}

function Monogram({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-2xs font-semibold ${tintFor(name)}`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function ProjectCombobox({
  id,
  labelId,
  value,
  onChange,
  projects,
  loading,
  disabled,
}: {
  id: string;
  /** The <label>'s own id — see the note on the trigger below. */
  labelId: string;
  value: string;
  onChange: (projectId: string) => void;
  projects: VercelProject[];
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = projects.find((project) => project.id === value);

  /*
    Filtered here rather than by cmdk, which can only score the items that are
    rendered — and only ten ever are, so its filter would search the first ten
    names instead of all of them. Doing it here is also the only way to know how
    many matches did not fit, a count cmdk does not expose.
  */
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return projects;
    return projects.filter((project) => {
      const name = project.name.toLowerCase();
      return terms.every((term) => name.includes(term));
    });
  }, [projects, query]);

  const shown = matches.slice(0, LIMIT);
  const hidden = matches.length - shown.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        {/*
          A <button> is labelable, so the card's `htmlFor` is valid HTML and a
          label click opens the picker. Naming a `role="combobox"` from a
          <label> is patchy across screen readers though, hence the explicit
          `aria-labelledby` as well.
        */}
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={labelId}
          disabled={disabled || loading}
          className="input flex items-center gap-2 text-left"
        >
          {selected ? (
            <>
              <Monogram name={selected.name} />
              <span className="min-w-0 flex-1 truncate text-fg">{selected.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-subtle">
              {loading ? 'Loading projects…' : 'Choose a project'}
            </span>
          )}
          <ChevronDownIcon className="shrink-0 text-subtle" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[--radix-popover-trigger-width] p-0"
      >
        {/* `shouldFilter={false}`: see `matches`. cmdk keeps the listbox roles,
            the arrow keys and Enter, which is the half worth having. */}
        <Command shouldFilter={false} label="Vercel projects">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search projects…"
          />
          <CommandList>
            <CommandGroup>
              {shown.map((project) => (
                // Keyed on the id, not the name: two projects can share a name
                // across teams, and cmdk lowercases whatever it is given.
                <CommandItem
                  key={project.id}
                  value={project.id}
                  onSelect={() => {
                    onChange(project.id);
                    setOpen(false);
                  }}
                >
                  <Monogram name={project.name} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {project.id === value && <CheckIcon className="shrink-0 text-accent" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          {/* Both of these sit outside CommandList, which is the listbox — a
              paragraph inside it would be an option that is not one. */}
          {matches.length === 0 && (
            <p className="px-2.5 py-8 text-center text-sm text-muted">No project matches that.</p>
          )}
          {hidden > 0 && (
            <p className="border-t border-line px-3 py-1.5 text-2xs text-subtle">
              {hidden} more {hidden === 1 ? 'project' : 'projects'} — keep typing to narrow it down
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
