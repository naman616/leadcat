// Plain, client-safe values matching prisma/schema.prisma's LeadStatus enum
// member names exactly. Deliberately NOT re-exported from @prisma/client —
// that package is Node-only (native query-engine bindings) and must never
// be imported by a file that also renders in the browser, like
// src/routes/leads.tsx. Server-only files can still use Prisma's own
// LeadStatus type (type-only imports are erased at compile time either
// way); this file exists so route components have a safe runtime source
// for the same values.
export const LEAD_STATUS_VALUES = [
  "New",
  "Callback",
  "FollowUp",
  "SiteVisit",
  "Booked",
  "Dropped",
] as const;

export type LeadStatusValue = (typeof LEAD_STATUS_VALUES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatusValue, string> = {
  New: "New",
  Callback: "Callback",
  FollowUp: "Follow Up",
  SiteVisit: "Site Visit",
  Booked: "Booked",
  Dropped: "Dropped",
};

export const LEAD_STATUS_TONE: Record<LeadStatusValue, string> = {
  New: "text-info",
  Callback: "text-warning",
  FollowUp: "text-info",
  SiteVisit: "text-primary",
  Booked: "text-success",
  Dropped: "text-destructive",
};
