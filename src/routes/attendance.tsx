import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";
import { teamMembers } from "@/data/crm";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Estatly Real Estate CRM" },
      {
        name: "description",
        content: "Shift timings, check-ins and field visits for your sales team.",
      },
      { property: "og:title", content: "Attendance — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Monitor sales-team shifts, check-ins and field movement.",
      },
    ],
  }),
  component: () => (
    <ModulePage
      title="Attendance"
      icon={CalendarCheck}
      action="Mark Attendance"
      blurb="Track check-in and check-out times, field visits and leave requests for every agent and site executive."
      items={[
        { label: "Present Today", value: "11", meta: "of 15 agents" },
        { label: "On Field", value: "4", meta: "site visits" },
        { label: "On Leave", value: "2", meta: "approved" },
        { label: "Avg Working Hours", value: "7:48", meta: "this week" },
      ]}
      recordLabel="Attendance Log"
      fields={[
        {
          key: "agent",
          label: "Agent",
          type: "select",
          options: teamMembers.map((m) => m.name),
          required: true,
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: ["Present", "On Field", "On Leave"],
          required: true,
        },
        { key: "checkIn", label: "Check-in Time", type: "text", placeholder: "e.g. 09:30 AM" },
      ]}
    />
  ),
});
