import { Link, useNavigate } from '@tanstack/react-router';
import { useLogout } from '../api/queries';
import { openCommandPalette } from './command-palette';
import { Kbd, modKey } from './kbd';
import { ThemeToggle } from './theme-toggle';
import { LogOutIcon, SearchIcon } from './icons';

const NAV_LINK =
  'flex h-7 items-center rounded-md px-2 text-sm text-muted transition-colors hover:bg-raised hover:text-fg [&.active]:bg-raised [&.active]:text-fg [&.active]:font-medium';

export function TopBar({ email }: { email: string }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-4 px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-accent text-2xs font-bold text-accent-fg"
          >
            P
          </span>
          <span className="hidden text-sm font-semibold text-fg sm:inline">Provisioner</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          <Link to="/" activeOptions={{ exact: true }} className={NAV_LINK}>
            Databases
          </Link>
          <Link to="/audit" className={NAV_LINK}>
            Audit
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/*
            The palette owns the ⌘K binding; this is only an affordance so the
            shortcut is discoverable without reading documentation.
          */}
          <button
            type="button"
            className="btn-secondary hidden gap-2 text-muted md:inline-flex"
            onClick={openCommandPalette}
          >
            <SearchIcon className="text-subtle" />
            Search
            <span className="flex items-center gap-0.5">
              <Kbd>{modKey}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <ThemeToggle />

          <span
            className="hidden max-w-[14rem] truncate px-2 text-sm text-muted lg:inline"
            title={email}
          >
            {email}
          </span>

          <button
            type="button"
            className="btn-ghost btn-icon"
            disabled={logout.isPending}
            title="Log out"
            aria-label="Log out"
            onClick={() => {
              logout.mutate(undefined, {
                onSettled: () => void navigate({ to: '/login', search: { redirect: undefined } }),
              });
            }}
          >
            <LogOutIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
