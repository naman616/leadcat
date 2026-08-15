import { createFileRoute } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";
import { leadProjectNames, leadRequirements } from "@/data/crm";

export const Route = createFileRoute("/properties")({
  head: () => ({
    meta: [
      { title: "Properties — Estatly Real Estate CRM" },
      {
        name: "description",
        content: "Unit-level inventory across towers, floors and configurations.",
      },
      { property: "og:title", content: "Properties — Estatly Real Estate CRM" },
      {
        property: "og:description",
        content: "Track unit availability, holds and bookings across every tower.",
      },
    ],
  }),
  component: () => (
    <ModulePage
      title="Properties"
      icon={Home}
      action="Add Property"
      blurb="Maintain unit-level inventory — tower, floor, configuration, carpet area and pricing — mapped to each project."
      items={[
        { label: "Total Units", value: "1,284", meta: "10 projects" },
        { label: "Available", value: "742", meta: "ready to sell" },
        { label: "On Hold", value: "96", meta: "token pending" },
        { label: "Sold", value: "446", meta: "registered" },
      ]}
      recordLabel="Units"
      fields={[
        {
          key: "project",
          label: "Project",
          type: "select",
          options: leadProjectNames,
          required: true,
        },
        {
          key: "unit",
          label: "Unit Number",
          type: "text",
          placeholder: "e.g. B-1204",
          required: true,
        },
        {
          key: "configuration",
          label: "Configuration",
          type: "select",
          options: leadRequirements,
          required: true,
        },
        { key: "price", label: "Price", type: "text", placeholder: "e.g. ₹ 78,00,000" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: ["Available", "Blocked", "Booked", "Registered"],
          required: true,
        },
      ]}
    />
  ),
});
