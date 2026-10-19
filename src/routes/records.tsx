import { createFileRoute, redirect } from "@tanstack/react-router";

// Old route kept so bookmarks keep working.
export const Route = createFileRoute("/records")({
  beforeLoad: () => {
    throw redirect({ to: "/household", search: { tab: "people" } });
  },
});
