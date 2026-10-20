// For each customer whose texts are newer than their card, give Claude Code (Tyler's own plan,
// headless) the thread + their CRM record and save the "What we know" card to customer_insights.
// Customers with no new texts are skipped, so a run costs nothing when nothing changed.
// Called by run.mjs. Claude runs isolated: no tools, no MCP servers, no user/plugin settings,
// empty working dir.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAll } from "./lib.mjs";

const CLAUDE = process.env.CLAUDE_BIN || join(homedir(), ".local/bin/claude");

const tz = { timeZone: "America/New_York" };
const day = (iso) => new Date(iso).toLocaleDateString("en-CA", tz);
const stamp = (iso) => `${day(iso)} ${new Date(iso).toLocaleTimeString("en-US", { ...tz, hour: "numeric", minute: "2-digit" })}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "facts", "open_items", "sentiment", "next_step"],
  properties: {
    summary: { type: "string" },
    facts: {
      type: "array",
      maxItems: 8,
      items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } },
    },
    open_items: {
      type: "array",
      maxItems: 5,
      items: { type: "object", additionalProperties: false, required: ["text", "since"], properties: { text: { type: "string" }, since: { type: "string" } } },
    },
    sentiment: { enum: ["happy", "neutral", "at_risk"] },
    next_step: { type: "string" },
  },
};

const SYSTEM = `You read the text messages between Tyler, who owns Buffer Bros (mobile car and boat detailing on Marco Island and in Naples, Florida), and one customer, together with that customer's CRM record. Write what Tyler should know about this relationship.

Rules:
- Use only what the texts and the record say. Never guess or invent; leave out anything not stated.
- summary: 2 or 3 plain sentences. Who they are to the business, how it's going, anything notable.
- facts: up to 8 short, durable, useful facts as {label, value}: vehicles or boats, where the car is and how to get in, timing preferences, when they're in town, pets or kids that matter on a job, how they like to pay, products or requests they care about. Skip one-off chatter.
- open_items: things they asked for or Tyler promised that the texts don't show as done or answered. since = the date it came up (YYYY-MM-DD). Empty if none.
- sentiment: "happy", "neutral", or "at_risk" (a complaint, an unanswered request, or the relationship cooling).
- next_step: one concrete thing Tyler should do next, or "Nothing needed right now".
Write in plain, short sentences. No em dashes.`;

/** @returns {Promise<{ updated: number, due: number, failed: number }>} */
export async function summarizeChanged(call, { limit = 40, only = null, log = console.log } = {}) {
  const [msgs, insights] = await Promise.all([
    getAll(call, `customer_messages?select=customer_id,sent_at&order=sent_at.desc${only ? `&customer_id=eq.${only}` : ""}`),
    getAll(call, "customer_insights?select=customer_id,through_message_at"),
  ]);
  const newest = new Map();
  const counts = new Map();
  for (const m of msgs) {
    if (!newest.has(m.customer_id)) newest.set(m.customer_id, m.sent_at);
    counts.set(m.customer_id, (counts.get(m.customer_id) ?? 0) + 1);
  }
  const doneThrough = new Map(insights.map((i) => [i.customer_id, i.through_message_at]));
  // Only customers with texts newer than their card (or no card yet).
  const due = [...newest]
    .filter(([id, at]) => only || !doneThrough.get(id) || new Date(at) > new Date(doneThrough.get(id)))
    .slice(0, limit);

  const work = mkdtempSync(join(tmpdir(), "bb-texts-")); // empty cwd: no project context for Claude
  let updated = 0;
  for (const [customerId, through] of due) {
    const [[c], vehicles, appts, plans, thread] = await Promise.all([
      call(`customers?id=eq.${customerId}&select=name,notes,tags,outreach_status,resume_on,last_contacted_on,review_asked_on,review_left_on,acquired_via`),
      call(`vehicles?customer_id=eq.${customerId}&select=kind,year,make,model,color,size_id,length_ft,notes`),
      call(`appointments?customer_id=eq.${customerId}&select=date,status,service_name,size_label,price&order=date.desc&limit=20`),
      call(`plans?customer_id=eq.${customerId}&select=cadence,status,per_visit_price,starts_on`),
      call(`customer_messages?customer_id=eq.${customerId}&select=sent_at,from_me,body,has_attachment&order=sent_at.desc&limit=200`),
    ]);
    const first = c.name.split(/\s+/)[0];
    const lines = thread
      .reverse()
      .map((m) => `${stamp(m.sent_at)} ${m.from_me ? "Tyler" : first}: ${(m.body ?? "").slice(0, 1000)}${m.has_attachment ? " [photo or file]" : ""}`);
    const input = [
      `Today is ${day(new Date().toISOString())}.`,
      `CRM record: ${JSON.stringify({ customer: c, vehicles, plans, recent_jobs: appts })}`,
      `Text messages, oldest first (${lines.length} most recent):`,
      ...lines,
    ].join("\n");

    const run = spawnSync(
      CLAUDE,
      ["-p", "--model", "sonnet", "--tools", "", "--strict-mcp-config", "--setting-sources", "local", "--no-session-persistence",
        "--system-prompt", SYSTEM, "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)],
      { input, cwd: work, encoding: "utf8", timeout: 240000, maxBuffer: 16 * 1024 * 1024 }
    );
    let card;
    try {
      const res = JSON.parse(run.stdout);
      if (res.is_error || !res.structured_output) throw new Error(res.result || res.subtype);
      card = res.structured_output;
    } catch (e) {
      log(`card failed for ${c.name}: ${e.message || run.stderr || run.error?.message || "no output from claude"}`);
      continue;
    }
    await call("customer_insights?on_conflict=customer_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { customer_id: customerId, updated_at: new Date().toISOString(), through_message_at: through, message_count: counts.get(customerId) ?? 0, ...card },
    });
    updated++;
  }
  return { updated, due: due.length, failed: due.length - updated };
}
