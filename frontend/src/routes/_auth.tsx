import { Outlet, createFileRoute, redirect, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { metaQuery, sessionQuery } from '../api/queries';
import { CommandPalette } from '../components/command-palette';
import { ToastProvider } from '../components/toaster';
import { TopBar } from '../components/top-bar';
import { useHotkeys } from '../hooks/use-hotkeys';

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
  const navigate = useNavigate();
  const meta = useQuery(metaQuery);
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  useHotkeys({ c: () => void navigate({ to: '/new' }) });

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <TopBar email={session.email} />

        {/* A 2px indeterminate bar rather than a "Loading…" string, so the page
            content below never collapses while a route resolves. */}
        <div className="sticky top-12 z-20 h-0.5 overflow-hidden">
          {isLoading && <div className="h-full w-full animate-indeterminate bg-accent" />}
        </div>

        <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 pb-12 pt-6">
          <Outlet />
        </main>

        <footer className="border-t border-line px-5 py-3 text-center text-xs text-subtle">
          {/* Shown so a Coolify upgrade that breaks the API contract is visible. */}
          Coolify {meta.data?.coolifyVersion ?? 'version unknown'} · project{' '}
          {meta.data?.projectName ?? '—'} · ports {meta.data?.portRange.start ?? '?'}–
          {meta.data?.portRange.end ?? '?'}
        </footer>

        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
