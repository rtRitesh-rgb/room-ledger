import { createFileRoute, redirect } from "@tanstack/react-router";

// Old route kept so bookmarks keep working.
export const Route = createFileRoute("/utilities")({
  beforeLoad: () => {
    throw redirect({ to: "/expenses" });
  },
});
