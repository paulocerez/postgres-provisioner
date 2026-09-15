import { Outlet, createFileRoute, redirect, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { metaQuery, sessionQuery } from '../api/queries';
import { TopBar } from '../components/TopBar';

/**
 * Everything behind this layout requires a session. The check runs in
 * `beforeLoad`, so an expired cookie lands on /login before any page data is
 * requested — the server enforces it again on every route regardless.
 */
export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context, location }) => {
    try {
      const session = await context.queryClient.ensureQueryData(sessionQuery);
      return { session };
    } catch {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { session } = Route.useRouteContext();
  const meta = useQuery(metaQuery);
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar email={session.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : <Outlet />}
      </main>
      <footer className="border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400">
        {/* Shown so a Coolify upgrade that breaks the API contract is visible. */}
        Coolify {meta.data?.coolifyVersion ?? 'version unknown'} · project{' '}
        {meta.data?.projectName ?? '—'} · ports {meta.data?.portRange.start ?? '?'}–
        {meta.data?.portRange.end ?? '?'}
      </footer>
    </div>
  );
}
