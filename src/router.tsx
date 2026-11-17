import { lazy, Suspense } from "react";
import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppLayout } from "@/components/layout/app-layout";

/* ── Lazy page imports ── */

const McpServerPage = lazy(() => import("./app/(pages)/mcp-server/page"));
const ConnectionsPage = lazy(() => import("./app/(pages)/connections/page"));

/* ── Route tree ── */

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  component: () => (
    <AuthGate>
      <AppLayout>
        <Suspense>
          <Outlet />
        </Suspense>
      </AppLayout>
    </AuthGate>
  ),
});

function lazyRoute(
  path: string,
  Component: React.LazyExoticComponent<React.ComponentType>,
) {
  return createRoute({
    getParentRoute: () => authLayout,
    path,
    component: () => <Component />,
  });
}

const mcpServerRoute = lazyRoute("/mcp-server", McpServerPage);
const connectionsRoute = lazyRoute("/connections", ConnectionsPage);
// Dev-only — not in the sidebar; reachable from the MCP Server page link.

// / → /mcp-server
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/mcp-server" as string });
  },
});




const routeTree = rootRoute.addChildren([
  authLayout.addChildren([mcpServerRoute, connectionsRoute]),
  indexRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
