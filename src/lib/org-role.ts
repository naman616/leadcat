// Client-safe values matching prisma/schema.prisma's OrgRole enum. See
// src/lib/lead-status.ts for why this can't just be imported from
// @prisma/client in a file that renders in the browser.
export const ORG_ROLE_VALUES = ["owner", "admin", "agent", "cp_admin", "cp_agent"] as const;

export type OrgRoleValue = (typeof ORG_ROLE_VALUES)[number];

export const ORG_ROLE_LABELS: Record<OrgRoleValue, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
  cp_admin: "CP Admin",
  cp_agent: "CP Agent",
};
