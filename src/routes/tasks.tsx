import { createFileRoute } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Estatly Real Estate CRM" },
      { name: "description", content: "Callbacks, follow-ups and site-visit tasks assigned to your team." },
      { property: "og:title", content: "Tasks — Estatly Real Estate CRM" },
      { property: "og:description", content: "Never miss a callback or site visit with scheduled CRM tasks." },
    ],
  }),
  component: () => (
    <ModulePage
      title="Tasks"
      icon={ListChecks}
      action="Add Task"
      blurb="Schedule callbacks, follow-ups and site visits against any lead, with reminders that surface on the dashboard."
      items={[
        { label: "Due Today", value: "9", meta: "4 callbacks" },
        { label: "Overdue", value: "1", meta: "needs attention" },
        { label: "Upcoming", value: "23", meta: "next 7 days" },
        { label: "Completed", value: "128", meta: "this month" },
      ]}
    />
  ),
});
