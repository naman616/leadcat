import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Default staleTime is 0, which means every query remount — including
  // AppShell's getCurrentUser() firing again on every single page
  // navigation, since AppShell wraps every route — refetches from
  // scratch: a Supabase Auth verification round-trip plus a full Prisma
  // transaction, every time, even when nothing changed. 30s means normal
  // navigation reuses cached data; mutations still force-refresh via
  // explicit invalidateQueries calls regardless of staleTime, so this
  // doesn't risk showing stale data after an actual change.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
