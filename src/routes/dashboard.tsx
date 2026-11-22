import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/dashboard") {
      throw redirect({
        href: `/admin${location.searchStr}${location.hash || ""}`,
        replace: true,
      });
    }
  },
  component: () => <Outlet />,
});
