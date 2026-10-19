// Duplicate-customer detection (Apple Contacts-style "Duplicates found").
// Two customers match on the same phone (last 10 digits), the same email, or the
// same name (case/spacing/punctuation-insensitive). Matches chain into groups —
// A~B by phone and B~C by name puts all three in one group — except across pairs
// the owner already answered "not duplicates" for. The merge itself is SQL
// (merge_customers, migration 0021); previewMerge mirrors its field rules.
// Check: `npx tsx src/lib/duplicates.check.ts`
import { normalizeEmail, phoneDigits } from "./format";

export type DupReason = "phone" | "email" | "name";

export interface DupCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addresses: { label: string; address: string }[];
  tags: string[];
  created_at: string;
  archived: boolean;
  /** appointments + ledger rows — the busiest record is the natural keeper */
  activity: number;
}

export interface DupGroup {
  ids: string[];
  /** suggested record to keep */
  keepId: string;
  reasons: DupReason[];
  /** both records carry a phone (or email) and they differ — maybe two people */
  conflict: boolean;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const normName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Higher = better keeper: real history first, then filled-in contact info, then age. */
function keeperScore(c: DupCandidate) {
  return c.activity * 10 + (c.phone ? 3 : 0) + (c.email ? 3 : 0) + c.addresses.length + (c.archived ? -50 : 0);
}

export function pickKeeper(cands: DupCandidate[]): string {
  return [...cands].sort((a, b) => keeperScore(b) - keeperScore(a) || a.created_at.localeCompare(b.created_at))[0].id;
}

export function findDuplicates(customers: DupCandidate[], dismissed: Iterable<string> = []): DupGroup[] {
  const no = new Set(dismissed);
  const parent = new Map(customers.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const edges: { a: string; b: string; why: DupReason }[] = [];

  // Bucket by each signal; every pair inside a bucket is an edge.
  const buckets: [DupReason, (c: DupCandidate) => string][] = [
    ["phone", (c) => (phoneDigits(c.phone).length >= 7 ? phoneDigits(c.phone) : "")],
    ["email", (c) => normalizeEmail(c.email) ?? ""],
    ["name", (c) => normName(c.name)],
  ];
  for (const [why, key] of buckets) {
    const by = new Map<string, string[]>();
    for (const c of customers) {
      const k = key(c);
      if (k) by.set(k, [...(by.get(k) ?? []), c.id]);
    }
    for (const ids of by.values()) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) if (!no.has(pairKey(ids[i], ids[j]))) edges.push({ a: ids[i], b: ids[j], why });
    }
  }
  for (const e of edges) parent.set(find(e.a), find(e.b));

  const byId = new Map(customers.map((c) => [c.id, c]));
  const groups = new Map<string, Set<string>>();
  for (const e of edges) {
    const root = find(e.a);
    groups.set(root, (groups.get(root) ?? new Set()).add(e.a).add(e.b));
  }
  return [...groups.entries()]
    .map(([root, idSet]) => {
      const cands = [...idSet].map((id) => byId.get(id)!);
      const reasons = [...new Set(edges.filter((e) => find(e.a) === root).map((e) => e.why))];
      const distinct = (vals: (string | null)[]) => new Set(vals.filter(Boolean)).size > 1;
      return {
        ids: cands.sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => c.id),
        keepId: pickKeeper(cands),
        reasons: (["phone", "email", "name"] as DupReason[]).filter((r) => reasons.includes(r)),
        conflict:
          distinct(cands.map((c) => (phoneDigits(c.phone).length >= 7 ? phoneDigits(c.phone) : null))) ||
          distinct(cands.map((c) => normalizeEmail(c.email))),
      };
    })
    .sort((a, b) => b.ids.length - a.ids.length);
}

/** What the keeper ends up with — same fill/union rules as merge_customers(). */
export function previewMerge(cands: DupCandidate[], keepId: string) {
  const keep = cands.find((c) => c.id === keepId)!;
  const others = cands.filter((c) => c.id !== keepId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ordered = [keep, ...others];
  const seen = new Set<string>();
  const addresses = ordered
    .flatMap((c) => c.addresses)
    .filter((a) => {
      const k = a.address.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return {
    name: keep.name,
    phone: keep.phone ?? others.find((c) => c.phone)?.phone ?? null,
    email: keep.email ?? others.find((c) => c.email)?.email ?? null,
    addresses,
    tags: [...new Set(ordered.flatMap((c) => c.tags))].sort(),
    activity: ordered.reduce((s, c) => s + c.activity, 0),
  };
}
