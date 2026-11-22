import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/login") {
      throw redirect({
        href: `/login/admin${location.searchStr}${location.hash || ""}`,
        replace: true,
      });
    }
  },
  component: () => <Outlet />,
});
