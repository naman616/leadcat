// Plain, client-safe values matching prisma/schema.prisma's ProjectType and
// UnitStatus enum member names exactly. Same reason as src/lib/lead-status.ts:
// @prisma/client is Node-only and must never be imported by a file that also
// renders in the browser (src/routes/projects.tsx, properties.tsx). Server
// files (src/lib/inventory.server.ts) import from here too rather than
// duplicating the list.
export const PROJECT_TYPE_VALUES = ["Residential", "Commercial", "Agricultural"] as const;

export type ProjectTypeValue = (typeof PROJECT_TYPE_VALUES)[number];

export const UNIT_STATUS_VALUES = ["Available", "Blocked", "Booked", "Registered"] as const;

export type UnitStatusValue = (typeof UNIT_STATUS_VALUES)[number];

export const UNIT_STATUS_LABELS: Record<UnitStatusValue, string> = {
  Available: "Available",
  Blocked: "Blocked",
  Booked: "Booked",
  Registered: "Registered",
};

export const UNIT_STATUS_TONE: Record<UnitStatusValue, string> = {
  Available: "text-success",
  Blocked: "text-warning",
  Booked: "text-primary",
  Registered: "text-info",
};
