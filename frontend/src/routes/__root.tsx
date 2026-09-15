import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="p-10 text-center text-sm text-slate-500">This page does not exist.</div>
  ),
});
