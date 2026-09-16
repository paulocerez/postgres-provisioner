import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-2xl font-semibold tracking-tight text-fg">404</p>
      <p className="text-sm text-muted">This page does not exist.</p>
      <Link to="/" className="btn-secondary mt-1">
        Back to databases
      </Link>
    </main>
  ),
});
