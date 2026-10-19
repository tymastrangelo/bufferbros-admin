// Phone push via ntfy.sh — Tyler and each worker subscribe to private topics in the
// ntfy app. The topic name IS the secret (NTFY_TOPIC_OWNER / NTFY_TOPIC_WASHER).
//
// Two kinds of push:
//  - notify(): system events (digest, Stripe, schedule changes for the crew).
//  - logActivity(): a WORKER did something in the CRM → Tyler hears exactly what,
//    from the action itself ("Gabe completed Janet's detail · $229 · collected $229 cash").
//    No-op when Tyler acts. Every exported server action must either call it or carry an
//    `// activity: <why not>` marker — `npx tsx src/lib/actions/activity.check.ts` enforces it.
//
// Delivery is fire-and-forget with one retry: a dead notification must never fail
// (or slow) the action that triggered it — callers schedule it with after().
import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

const APP_URL = "https://admin.bufferbros.org";

export type NotifyTarget = "owner" | "washer" | "both";

/** ntfy priority: 3 = default; 4 = needs attention soon (cancellations, deletions); 5 = urgent (disputes). */
export type Priority = 1 | 2 | 3 | 4 | 5;

export interface PushOpts {
  /** ntfy emoji tags, e.g. "white_check_mark" — shown before the title. */
  tags?: string[];
  priority?: Priority;
}

const TOPICS: Record<"owner" | "washer", string | undefined> = {
  owner: process.env.NTFY_TOPIC_OWNER,
  washer: process.env.NTFY_TOPIC_WASHER,
};

async function deliver(target: string, payload: Record<string, unknown>) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch("https://ntfy.sh", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return;
      // 4xx (bad topic, payload too big) won't fix itself — only retry rate limits / server errors.
      if (res.status !== 429 && res.status < 500) {
        console.error(`ntfy ${target}: ${res.status} ${await res.text()}`);
        return;
      }
      if (attempt === 2) console.error(`ntfy ${target}: ${res.status} after retry`);
    } catch (e) {
      if (attempt === 2) console.error(`ntfy ${target}:`, e);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

export async function notify(to: NotifyTarget, title: string, message: string, path = "/", opts: PushOpts = {}) {
  const targets = to === "both" ? (["owner", "washer"] as const) : ([to] as const);
  await Promise.all(
    targets.map((t) => {
      const topic = TOPICS[t];
      if (!topic) return; // not configured (e.g. local dev): silently skip
      return deliver(t, {
        topic,
        title: title.slice(0, 250),
        message: message.slice(0, 3500) || " ",
        click: `${APP_URL}${path}`,
        tags: opts.tags ?? ["oncoming_automobile"],
        priority: opts.priority ?? 3,
      });
    })
  );
}

export interface Actor {
  role: "owner" | "washer";
  /** Worker's name from the Team page; "Tyler" stays implicit for the owner. */
  name: string;
}

/** Who is performing the current request. */
export async function getActor(): Promise<Actor> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user?.app_metadata?.role === "owner") return { role: "owner", name: "You" };
  const { data: emp } = user
    ? await db.from("employees").select("name").eq("user_id", user.id).maybeSingle()
    : { data: null };
  return { role: "washer", name: emp?.name ?? user?.email?.split("@")[0] ?? "A worker" };
}

/**
 * A worker changed something → push Tyler the specifics. `what` reads after the
 * worker's name ("completed Janet's detail"); `facts` become one line each — falsy
 * entries drop out, so callers can inline conditionals.
 */
export async function logActivity(
  what: string,
  facts: (string | false | null | undefined)[] = [],
  path = "/",
  opts: PushOpts = {}
) {
  const who = await getActor();
  if (who.role === "owner") return;
  const message = facts.filter(Boolean).join("\n");
  after(() => notify("owner", `${who.name} ${what}`, message, path, { tags: ["bust_in_silhouette"], ...opts }));
}

// ── Formatting helpers shared by activity messages ─────────────────────────────

export const usd = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

/** "price $229 → $249" — or null when nothing changed, so it drops out of `facts`. */
export function change(label: string, before: unknown, after: unknown, fmt: (v: unknown) => string = (v) => String(v ?? "—")) {
  const a = before ?? null;
  const b = after ?? null;
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a == null || a === "") return `${label}: ${fmt(b)}`;
  if (b == null || b === "") return `${label} removed (was ${fmt(a)})`;
  return `${label}: ${fmt(a)} → ${fmt(b)}`;
}

export async function customerName(id: string | null | undefined): Promise<string> {
  if (!id) return "a customer";
  const db = await createClient();
  const { data } = await db.from("customers").select("name").eq("id", id).maybeSingle();
  return data?.name ?? "a customer";
}
