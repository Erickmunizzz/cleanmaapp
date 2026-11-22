import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/$section")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/admin/${encodeURIComponent(params.section)}${location.searchStr}${location.hash || ""}`,
      replace: true,
    });
  },
});
