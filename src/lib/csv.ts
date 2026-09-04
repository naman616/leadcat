/**
 * Minimal CSV parser handling quoted fields — embedded commas, embedded
 * newlines, escaped `""` — the shapes Excel/Google Sheets actually export.
 * No external dependency: bulk lead upload deliberately supports CSV only
 * (see docs/specs), so a parsing library wasn't worth adding for one format.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }

  // Files without a trailing newline still have one unflushed field/row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Inverse of parseCsv above: turns rows of plain values into CSV text. A
 * field is only quoted when it actually needs it (contains a comma, quote,
 * or newline), with embedded quotes doubled — the same shape parseCsv (and
 * Excel/Sheets) round-trip correctly. \r\n line endings to match
 * LEAD_IMPORT_TEMPLATE_CSV.
 */
export function stringifyCsv(rows: (string | number | null | undefined)[][]): string {
  const escapeField = (value: string | number | null | undefined): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
