import { createFileRoute } from "@tanstack/react-router";
import { UsersRound } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Estatly Real Estate CRM" },
      { name: "description", content: "Sales hierarchy, roles and lead-distribution rules for your team." },
      { property: "og:title", content: "Team — Estatly Real Estate CRM" },
      { property: "og:description", content: "Manage agents, managers and lead-routing rules." },
    ],
  }),
  component: () => (
    <ModulePage
      title="Team"
      icon={UsersRound}
      action="Add Member"
      blurb="Manage agents, team leads and managers, set reporting hierarchy and control how fresh leads get distributed."
      items={[
        { label: "Total Members", value: "15", meta: "3 teams" },
        { label: "Active Today", value: "11", meta: "logged in" },
        { label: "Team Leads", value: "3", meta: "managers" },
        { label: "Avg Leads / Agent", value: "818", meta: "lifetime" },
      ]}
    />
  ),
});
