import { createFileRoute } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { ModulePage } from "@/components/crm/ModulePage";

export const Route = createFileRoute("/invoice")({
  head: () => ({
    meta: [
      { title: "Invoices — Estatly Real Estate CRM" },
      { name: "description", content: "Booking invoices, token receipts and payment collection tracking." },
      { property: "og:title", content: "Invoices — Estatly Real Estate CRM" },
      { property: "og:description", content: "Track booking payments and outstanding collections." },
    ],
  }),
  component: () => (
    <ModulePage
      title="Invoice"
      icon={ReceiptText}
      action="Create Invoice"
      blurb="Raise booking invoices, record token amounts and keep collection status synced with each booked lead."
      items={[
        { label: "Raised This Month", value: "₹ 4.2Cr", meta: "18 invoices" },
        { label: "Collected", value: "₹ 2.8Cr", meta: "67% of raised" },
        { label: "Outstanding", value: "₹ 1.4Cr", meta: "6 invoices" },
        { label: "Overdue", value: "₹ 32L", meta: "2 invoices" },
      ]}
    />
  ),
});
