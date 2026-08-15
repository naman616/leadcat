import { createFileRoute } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";

export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { title: "Data Bank — Estatly Real Estate CRM" },
      { name: "description", content: "Bulk contact data, campaign lists and imported enquiry records." },
      { property: "og:title", content: "Data Bank — Estatly Real Estate CRM" },
      { property: "og:description", content: "Manage imported contact data before it becomes a qualified lead." },
    ],
  }),
  component: () => (
    <ModulePage
      title="Data"
      icon={Database}
      action="Import Data"
      blurb="Upload raw contact lists, dedupe them against existing leads and push qualified records into the lead pipeline."
      items={[
        { label: "Total Records", value: "48,210", meta: "across 14 imports" },
        { label: "Qualified", value: "6,842", meta: "moved to leads" },
        { label: "Duplicates", value: "1,205", meta: "auto-merged" },
        { label: "Pending Review", value: "312", meta: "needs assignment" },
      ]}
    />
  ),
});
