import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { EmployeeWorkspace } from "@/funcionario/Workspace";
import { InstallGuide, pwaHead } from "@/lib/pwa";

export const Route = createFileRoute("/cleaner")({
  head: () => pwaHead("cleaner"),
  component: CleanerLayout,
});

function CleanerLayout() {
  const login = useRouterState({ select: state => state.location.pathname }) === "/cleaner/login";
  return <>
    {login ? <Outlet /> : <EmployeeWorkspace />}
    <InstallGuide portal="cleaner" />
  </>;
}
