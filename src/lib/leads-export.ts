import { neutralizeFormula } from "./csv";

interface ExportableLead {
  contact: { fullName: string; phone: string | null; email: string | null; city: string | null };
  status: string;
  subStatus: string | null;
  source: string | null;
  subSource: string | null;
  project: string | null;
  budget: string | null;
  requirement: string | null;
  assignee: { fullName: string | null } | null;
  createdAt: Date;
}

const safe = (v: string | null) => (v === null ? null : neutralizeFormula(v));

/**
 * One CSV row per lead. Free-text columns (many arrive via the public website
 * form) go through neutralizeFormula; phone, status and the timestamp are
 * left as-is so "+91…" numbers stay intact.
 */
export function toLeadExportRow(l: ExportableLead): (string | null)[] {
  return [
    neutralizeFormula(l.contact.fullName),
    l.contact.phone,
    safe(l.contact.email),
    safe(l.contact.city),
    l.status,
    safe(l.subStatus),
    safe(l.source),
    safe(l.subSource),
    safe(l.project),
    safe(l.budget),
    safe(l.requirement),
    neutralizeFormula(l.assignee?.fullName ?? ""),
    l.createdAt.toISOString(),
  ];
}
