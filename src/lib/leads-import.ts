import { z } from "zod";
import { parseCsv } from "./csv";

/**
 * Bulk lead upload uses a fixed column template rather than a column-
 * mapping UI — a no-code mapping builder is explicitly cut from v1 (see the
 * build plan's "what to deliberately cut" list). Headers are matched
 * case-insensitively so "phone" / "Phone" / " Phone " all work, but the
 * column set itself isn't configurable.
 */
export const LEAD_IMPORT_COLUMNS = [
  { key: "fullName", header: "Full Name", required: true },
  { key: "phone", header: "Phone", required: true },
  { key: "email", header: "Email", required: false },
  { key: "source", header: "Source", required: false },
  { key: "subSource", header: "Sub Source", required: false },
  { key: "project", header: "Project", required: false },
  { key: "budget", header: "Budget", required: false },
  { key: "requirement", header: "Requirement", required: false },
  { key: "city", header: "City", required: false },
  { key: "assignedToEmail", header: "Assigned To Email", required: false },
] as const;

type LeadImportKey = (typeof LEAD_IMPORT_COLUMNS)[number]["key"];

export const LEAD_IMPORT_TEMPLATE_CSV =
  LEAD_IMPORT_COLUMNS.map((c) => c.header).join(",") +
  "\r\n" +
  "Asha Rao,9876543210,asha@example.com,Website,,Skyline Residences,80L-1Cr,3BHK,Pune,\r\n";

const leadImportRowSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  phone: z.string().min(1, "Phone is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  source: z.string().optional(),
  subSource: z.string().optional(),
  project: z.string().optional(),
  budget: z.string().optional(),
  requirement: z.string().optional(),
  city: z.string().optional(),
  assignedToEmail: z.string().email("Invalid assignee email").optional().or(z.literal("")),
});

export type LeadImportRow = z.infer<typeof leadImportRowSchema>;

export type ParsedLeadImportRow = {
  /** 1-based spreadsheet row number, including the header row. */
  line: number;
  raw: Record<string, string>;
  data: LeadImportRow | null;
  errors: string[];
};

// Per-file cap keeps a bulk import inside one Prisma transaction
// (withUserContext) at a size that comfortably fits a pooled connection's
// statement timeout — well past a typical single spreadsheet for a first
// cut. Larger imports are a later "split into batches" problem, not this
// slice's.
export const LEAD_IMPORT_MAX_ROWS = 500;

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

const HEADER_LOOKUP = new Map<string, LeadImportKey>(
  LEAD_IMPORT_COLUMNS.map((c) => [normalizeHeader(c.header), c.key]),
);

export function parseLeadImportCsv(text: string): {
  rows: ParsedLeadImportRow[];
  fileError: string | null;
} {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], fileError: "The file is empty." };
  }

  const [headerRow, ...dataRows] = table;
  const columnKeys = headerRow!.map((h) => HEADER_LOOKUP.get(normalizeHeader(h)) ?? null);

  const missingRequired = LEAD_IMPORT_COLUMNS.filter(
    (c) => c.required && !columnKeys.includes(c.key),
  );
  if (missingRequired.length > 0) {
    return {
      rows: [],
      fileError: `Missing required column${missingRequired.length > 1 ? "s" : ""}: ${missingRequired
        .map((c) => c.header)
        .join(", ")}. Download the template below and match its headers.`,
    };
  }

  if (dataRows.length > LEAD_IMPORT_MAX_ROWS) {
    return {
      rows: [],
      fileError: `This file has ${dataRows.length} rows — upload ${LEAD_IMPORT_MAX_ROWS} or fewer at a time.`,
    };
  }

  const rows: ParsedLeadImportRow[] = [];
  dataRows.forEach((cells, idx) => {
    const raw: Record<string, string> = {};
    columnKeys.forEach((key, colIdx) => {
      if (key) raw[key] = (cells[colIdx] ?? "").trim();
    });

    // Blank trailing lines are a common CSV export artifact, not a row the
    // user meant to submit.
    if (Object.values(raw).every((v) => v === "")) return;

    const result = leadImportRowSchema.safeParse(raw);
    rows.push({
      line: idx + 2, // +1 for 0-index, +1 to account for the header row
      raw,
      data: result.success ? result.data : null,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    });
  });

  return { rows, fileError: null };
}
