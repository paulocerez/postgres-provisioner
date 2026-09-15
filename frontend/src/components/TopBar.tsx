import { Link, useNavigate } from '@tanstack/react-router';
import { useLogout } from '../api/queries';

export function TopBar({ email }: { email: string }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link to="/" className="text-sm font-semibold text-slate-900">
          Postgres Provisioner
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="text-slate-600 hover:text-slate-900 [&.active]:font-semibold [&.active]:text-slate-900"
          >
            Databases
          </Link>
          <Link
            to="/audit"
            className="text-slate-600 hover:text-slate-900 [&.active]:font-semibold [&.active]:text-slate-900"
          >
            Audit
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          <span>{email}</span>
          <button
            type="button"
            className="btn-secondary"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate(undefined, {
                onSettled: () => void navigate({ to: '/login', search: { redirect: undefined } }),
              });
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
