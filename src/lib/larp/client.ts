// Read-only stand-ins for the Supabase client, used by LARP mode (fake dataset) and
// "view as" mode (real data, no writes). Isomorphic — the server client and the
// browser client both wrap themselves with these.
//
// fakeQuery() implements just the PostgREST surface this app uses: select with `*`,
// column lists and one-level-deep embeds (customers(name), plan_vehicles(vehicles(*))),
// eq/neq/gt/gte/lt/lte/in/is/not/ilike, or("a.eq.1,and(b.gte.2,c.eq.x)"), order,
// limit, range, single/maybeSingle, count/head. Writes always fail politely.
// ponytail: O(n) scans over in-memory arrays — fine for ~20k demo rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FAKE_TABLES, larpDataset, type CrewMember, type Dataset } from "./data";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code: string } | null; count: number | null };

export const LARP_COOKIE = "bb_larp";
export const VIEW_AS_COOKIE = "bb_view_as";

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** A thenable that swallows any chain (.select().single()…) and resolves to an error. */
function refused(message: string): unknown {
  const res: Result = { data: null, error: { message, code: "READ_ONLY" }, count: null };
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad) : () => chain),
    apply: () => chain,
  });
  return chain;
}

// ── select parsing ───────────────────────────────────────────────────────────

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const singular = (t: string) => (t.endsWith("s") ? t.slice(0, -1) : t);

function project(data: Dataset, table: string, row: Row, select: string): Row {
  const items = splitTop(select || "*");
  let out: Row = {};
  for (const item of items) {
    const m = item.match(/^(\w+)\(([\s\S]*)\)$/);
    if (item === "*") out = { ...row, ...out };
    else if (m) {
      const [, rel, inner] = m;
      const fk = `${singular(rel)}_id`;
      const relRows = data[rel] ?? [];
      if (fk in row) {
        const hit = relRows.find((x) => x.id === row[fk]);
        out[rel] = hit ? project(data, rel, hit, inner) : null;
      } else {
        const back = `${singular(table)}_id`;
        out[rel] = relRows.filter((x) => x[back] === row.id).map((x) => project(data, rel, x, inner));
      }
    } else out[item.trim()] = row[item.trim()];
  }
  return out;
}

// ── filters ──────────────────────────────────────────────────────────────────

type Pred = (r: Row) => boolean;

function coerce(sample: unknown, v: unknown): unknown {
  if (v === "null") return null;
  if (typeof sample === "number") return Number(v);
  if (typeof sample === "boolean") return v === true || v === "true";
  return v;
}
function cmp(op: string, a: unknown, raw: unknown): boolean {
  const b = coerce(a, raw);
  switch (op) {
    case "eq":
      return a === b || String(a) === String(b);
    case "neq":
      return !(a === b || String(a) === String(b));
    case "gt":
      return a != null && (a as number) > (b as number);
    case "gte":
      return a != null && (a as number) >= (b as number);
    case "lt":
      return a != null && (a as number) < (b as number);
    case "lte":
      return a != null && (a as number) <= (b as number);
    case "is":
      return b == null ? a == null : a === b;
    case "in":
      return (b as unknown[]).some((x) => String(x) === String(a));
    case "ilike":
    case "like": {
      const re = new RegExp(`^${String(raw).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, op === "ilike" ? "i" : "");
      return a != null && re.test(String(a));
    }
  }
  return true;
}

/** PostgREST logic-tree string: "a.eq.1,b.ilike.%x%,and(c.gte.2,d.is.null)" */
function parseLogic(s: string, all = false): Pred {
  const preds = splitTop(s).map((term): Pred => {
    const nest = term.match(/^(and|or)\(([\s\S]*)\)$/);
    if (nest) return parseLogic(nest[2], nest[1] === "and");
    const [col, op, ...rest] = term.split(".");
    const val = rest.join(".");
    if (op === "in") return (r) => cmp("in", r[col], val.replace(/^\(|\)$/g, "").split(","));
    return (r) => cmp(op, r[col], val);
  });
  return all ? (r) => preds.every((p) => p(r)) : (r) => preds.some((p) => p(r));
}

export function fakeQuery(getData: () => Promise<Dataset>, table: string) {
  const preds: Pred[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let selectStr = "*";
  let limitN: number | null = null;
  let rangeFrom = 0;
  let mode: "many" | "single" | "maybe" = "many";
  let count = false;
  let head = false;

  const q = {
    select(s = "*", opts?: { count?: string; head?: boolean }) {
      selectStr = s;
      count = !!opts?.count;
      head = !!opts?.head;
      return q;
    },
    eq: (c: string, v: unknown) => (preds.push((r) => cmp("eq", r[c], v)), q),
    neq: (c: string, v: unknown) => (preds.push((r) => cmp("neq", r[c], v)), q),
    gt: (c: string, v: unknown) => (preds.push((r) => cmp("gt", r[c], v)), q),
    gte: (c: string, v: unknown) => (preds.push((r) => cmp("gte", r[c], v)), q),
    lt: (c: string, v: unknown) => (preds.push((r) => cmp("lt", r[c], v)), q),
    lte: (c: string, v: unknown) => (preds.push((r) => cmp("lte", r[c], v)), q),
    in: (c: string, v: unknown[]) => (preds.push((r) => cmp("in", r[c], v)), q),
    is: (c: string, v: unknown) => (preds.push((r) => cmp("is", r[c], v)), q),
    ilike: (c: string, v: string) => (preds.push((r) => cmp("ilike", r[c], v)), q),
    not: (c: string, op: string, v: unknown) => (preds.push((r) => !cmp(op, r[c], v)), q),
    or: (s: string) => (preds.push(parseLogic(s)), q),
    order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((limitN = n), q),
    range: (a: number, b: number) => ((rangeFrom = a), (limitN = b - a + 1), q),
    single: () => ((mode = "single"), q),
    maybeSingle: () => ((mode = "maybe"), q),
    async run(): Promise<Result> {
      const data = await getData();
      let rows = (data[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (orders.length) {
        rows = [...rows].sort((a, b) => {
          for (const { col, asc } of orders) {
            const x = a[col] as string | number | null;
            const y = b[col] as string | number | null;
            if (x === y) continue;
            if (x == null) return 1;
            if (y == null) return -1;
            return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      const total = rows.length;
      if (limitN != null || rangeFrom) rows = rows.slice(rangeFrom, rangeFrom + (limitN ?? rows.length));
      const shaped = head ? null : rows.map((r) => project(data, table, r, selectStr));
      if (mode !== "many") {
        const one = shaped?.[0] ?? null;
        if (!one && mode === "single") return { data: null, error: { message: "Row not found", code: "PGRST116" }, count: null };
        return { data: one, error: null, count: count ? total : null };
      }
      return { data: shaped, error: null, count: count ? total : null };
    },
    then(ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) {
      return q.run().then(ok, bad);
    },
  };
  return new Proxy(q, {
    get: (t, k: string) => (WRITE_METHODS.has(k) ? () => refused(LARP_REFUSAL) : (t as Record<string, unknown>)[k]),
  });
}

export const LARP_REFUSAL = "Demo data is on — changes aren't saved. Turn it off in Settings → Account.";
export const VIEW_AS_REFUSAL = "You're previewing a worker's view — switch back to yourself to make changes.";

/** Real reads, every write refused (view-as preview, and the passthrough tables under LARP). */
function readOnlyBuilder<B extends object>(builder: B, message: string): B {
  return new Proxy(builder, {
    get: (t, k: string) => (WRITE_METHODS.has(k) ? () => refused(message) : Reflect.get(t, k)),
  });
}

/**
 * Wrap a Supabase client. `larp`: faked tables come from the demo dataset (catalog,
 * settings, hours, employees and auth stay real). `readOnly`: every write is refused.
 */
export function wrapClient<C extends SupabaseClient>(real: C, opts: { larp: boolean; readOnly: boolean }): C {
  if (!opts.larp && !opts.readOnly) return real;
  const message = opts.larp ? LARP_REFUSAL : VIEW_AS_REFUSAL;
  let dataset: Promise<Dataset> | null = null;
  const getData = () =>
    (dataset ??= (async () => {
      const [{ data: emps }, { data: ceo }] = await Promise.all([
        real.from("employees").select("id,split_pct").eq("active", true),
        real.from("settings").select("value").eq("key", "split_ceo_pct").maybeSingle(),
      ]);
      return larpDataset((emps ?? []) as CrewMember[], Number((ceo as { value?: string } | null)?.value ?? 10));
    })());

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          if (opts.larp && (FAKE_TABLES as readonly string[]).includes(table)) return fakeQuery(getData, table);
          return readOnlyBuilder(target.from(table), message);
        };
      }
      if (prop === "rpc") {
        // Availability is a pure read — keep it live so the slot finder still works.
        return (fn: string, args?: object) => (fn === "get_available_slots" ? target.rpc(fn, args) : refused(message));
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as C;
}
