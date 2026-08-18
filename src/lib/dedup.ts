// Pure functions — no Prisma import, safe for both server files
// (src/lib/dedup.server.ts) and, if ever needed, the browser. See
// docs/specs/03-dedup.md for the normalization rules and why grouping
// happens in memory rather than via a raw-SQL query.

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// India-specific heuristic — see docs/specs/03-dedup.md. Strips everything
// but digits, then keeps only the last 10 so "+91 98765 43210",
// "091-98765-43210", and "9876543210" all normalize to the same key. Fewer
// than 10 digits produces no key at all rather than matching on a short,
// low-entropy string.
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export type DedupContact = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  createdAt: Date | string;
  leadCount: number;
};

export type DuplicateGroup = {
  matchedOn: ("phone" | "email")[];
  contacts: DedupContact[];
};

/**
 * Union-find over two normalized keys (phone, email) so transitively
 * linked contacts — A matches B on phone, B matches C on email — land in
 * one group, not two overlapping pairs. Groups of size 1 (no match) are
 * dropped. `matchedOn` reports which key(s) actually have a repeated
 * value *within* the final group, not merely "someone in the group has
 * a phone" — a group joined only via email doesn't claim a phone match.
 */
export function groupDuplicateContacts(contacts: DedupContact[]): DuplicateGroup[] {
  const parent = new Map<string, string>();
  for (const c of contacts) parent.set(c.id, c.id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let curr = id;
    while (parent.get(curr) !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const byPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();

  for (const c of contacts) {
    const phoneKey = normalizePhone(c.phone);
    if (phoneKey) {
      for (const otherId of byPhone.get(phoneKey) ?? []) union(c.id, otherId);
      byPhone.set(phoneKey, [...(byPhone.get(phoneKey) ?? []), c.id]);
    }
    const emailKey = normalizeEmail(c.email);
    if (emailKey) {
      for (const otherId of byEmail.get(emailKey) ?? []) union(c.id, otherId);
      byEmail.set(emailKey, [...(byEmail.get(emailKey) ?? []), c.id]);
    }
  }

  const groups = new Map<string, DedupContact[]>();
  for (const c of contacts) {
    const root = find(c.id);
    const arr = groups.get(root) ?? [];
    arr.push(c);
    groups.set(root, arr);
  }

  const result: DuplicateGroup[] = [];
  for (const groupContacts of groups.values()) {
    if (groupContacts.length < 2) continue;

    const hasSharedPhone = hasRepeatedKey(groupContacts, (c) => normalizePhone(c.phone));
    const hasSharedEmail = hasRepeatedKey(groupContacts, (c) => normalizeEmail(c.email));

    const matchedOn: ("phone" | "email")[] = [];
    if (hasSharedPhone) matchedOn.push("phone");
    if (hasSharedEmail) matchedOn.push("email");

    result.push({
      matchedOn,
      contacts: [...groupContacts].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    });
  }

  result.sort(
    (a, b) =>
      new Date(a.contacts[0]!.createdAt).getTime() - new Date(b.contacts[0]!.createdAt).getTime(),
  );

  return result;
}

function hasRepeatedKey<T>(items: T[], keyOf: (item: T) => string | null): boolean {
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (seen.get(key)! > 1) return true;
  }
  return false;
}
