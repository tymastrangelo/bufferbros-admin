// For each customer whose card is out of date, give Claude Code (Tyler's own plan, headless) the
// thread + their CRM record + timing, and save the "What we know" card and a drafted next text to
// customer_insights. A card is out of date when there are newer texts, or a one-off detail was
// completed / a non-plan visit booked since it was written. Otherwise nothing runs (no credits).
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
    suggestion: {
      type: "object",
      additionalProperties: false,
      required: ["goal", "send_on", "text", "why"],
      properties: {
        goal: { enum: ["reply", "rebook", "review", "check_in", "none"] },
        send_on: { type: "string" },
        text: { type: "string" },
        why: { type: "string" },
      },
    },
  },
};
const REVIEW_LINK = "https://g.page/r/CXiiEGVufNEdEAE/review";

const SYSTEM = `You read the text messages between Tyler, who owns Buffer Bros (mobile car and boat detailing on Marco Island and in Naples, Florida), and one customer, together with that customer's CRM record. Write what Tyler should know about this relationship.

Rules:
- Use only what the texts and the record say. Never guess or invent; leave out anything not stated.
- summary: 2 or 3 plain sentences. Who they are to the business, how it's going, anything notable.
- facts: up to 8 short, durable, useful facts as {label, value}: vehicles or boats, where the car is and how to get in, timing preferences, when they're in town, pets or kids that matter on a job, how they like to pay, products or requests they care about. Skip one-off chatter.
- open_items: things they asked for or Tyler promised that the texts don't show as done or answered. since = the date it came up (YYYY-MM-DD). Empty if none.
- sentiment: "happy", "neutral", or "at_risk" (a complaint, an unanswered request, or the relationship cooling).
- next_step: one concrete thing Tyler should do next, or "Nothing needed right now".
- suggestion: the single most useful text Tyler could send this customer next. Use the Timing block.
  goal:
  - "reply": they asked or said something that still needs Tyler's answer.
  - "rebook": nothing is booked and it's time to come back (past their usual gap, a plan lapsed, visits were cancelled, or they just haven't been on the schedule in a while). When it fits naturally, invite them onto a recurring plan (weekly, every other week, or monthly) so they stay booked without thinking about it.
  - "review": they have had a detail done and haven't left a Google review. Best a day or two after a fresh detail, but any happy past customer who never reviewed is worth one gentle ask. If they were asked before, only nudge again if it was over a month ago, and gently.
  - "check_in": a seasonal resident coming back, or a relationship going quiet.
  - "none": they have a visit booked and nothing is pending, Tyler texted them very recently, they declined, or they're do_not_contact.
  send_on: YYYY-MM-DD. Today if it fits now; otherwise the best future day (when they're due again, back in town, or a day or two after a detail for a review).
  text: what Tyler would actually send. Match how Tyler writes in these texts (length, tone, capitalization, punctuation, emoji or not). Short, warm, specific to them (their car or last visit if it fits naturally), one clear ask. For a review include ${REVIEW_LINK}. For rebooking, offer to set a time or share bufferbros.org/booking (exactly that link), and when it fits suggest a recurring plan so they stay on the schedule. Never promise specific openings; if they said which days work for them, mention those days. Never invent prices, discounts, dates or facts. Empty string when goal is "none".
  why: one short sentence on why this text, now.
Write in plain, short sentences. No em dashes.`;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** The proactive ask a client is due for with no new texts needed: a Google review (any past
 *  customer who never left one), or a rebook (active, nothing booked, gone quiet). Review wins so
 *  the one-time ask goes out before the recurring rebook nudge. Pure; pinned by summarize.check.mjs. */
export function proactiveGoal(c, { lastDetail, hasNextVisit, today }) {
  if (c.archived || c.outreach_status === "do_not_contact") return null;
  const since = (d) => (d ? daysBetween(d, today) : Infinity);
  if (lastDetail && !c.review_left_on && since(c.review_asked_on) > 30) return "review";
  if (!hasNextVisit && c.outreach_status === "active" && lastDetail && since(lastDetail) >= 30 && since(c.last_contacted_on) >= 30 && (!c.resume_on || c.resume_on <= today))
    return "rebook";
  return null;
}

/** Plain-English timing facts Claude needs to pick when (and whether) to text. */
function timing({ today, appts, plans, c }) {
  const done = appts.filter((a) => a.status === "completed").map((a) => a.date).sort();
  const last = done.at(-1);
  const gaps = done.slice(1).map((d, i) => daysBetween(done[i], d)).filter((g) => g > 0).sort((a, b) => a - b);
  const next = appts.filter((a) => a.status === "scheduled" && a.date >= today).map((a) => a.date).sort()[0];
  const active = plans.find((p) => p.status === "active");
  const cancelled = appts.filter((a) => a.status === "cancelled" && (!last || a.date > last)).length;
  return [
    last ? `last completed detail ${last} (${daysBetween(last, today)} days ago)` : "no completed detail on record",
    gaps.length ? `usual gap between their details about ${gaps[Math.floor(gaps.length / 2)]} days` : "usual gap unknown",
    next ? `next visit booked ${next}` : "nothing booked",
    active ? `on a ${active.cadence} plan` : plans.length ? "had a plan, not active now" : "no plan",
    cancelled ? `${cancelled} cancelled visit(s) since the last detail` : null,
    c.review_left_on ? `left a Google review ${c.review_left_on}` : c.review_asked_on ? `asked for a review ${c.review_asked_on}, none left` : "never asked for a review",
    c.outreach_status !== "active" ? `outreach status ${c.outreach_status}${c.resume_on ? ` until ${c.resume_on}` : ""}` : null,
    c.last_contacted_on ? `Tyler last reached out ${c.last_contacted_on}` : null,
    "snowbird season on Marco Island and Naples runs November to April",
  ]
    .filter(Boolean)
    .join("; ");
}

/** @returns {Promise<{ updated: number, due: number, failed: number }>} */
export async function summarizeChanged(call, { limit = 40, only = null, log = console.log } = {}) {
  const [msgs, insights, oneOffs, custs, visits] = await Promise.all([
    getAll(call, `customer_messages?select=customer_id,sent_at&order=sent_at.desc${only ? `&customer_id=eq.${only}` : ""}`),
    getAll(call, "customer_insights?select=customer_id,through_message_at,updated_at,suggestion_goal,suggestion_done_at"),
    // one-off visits only: weekly plan washes shouldn't re-read a customer every week
    getAll(call, "appointments?select=customer_id,created_at,completed_at,source&plan_id=is.null&customer_id=not.is.null"),
    // active clients + their visits, so we also draft for anyone owed a review or a rebook even
    // when they have no new texts — every active client gets a text to send, not just texters.
    getAll(call, "customers?select=id,archived,outreach_status,resume_on,last_contacted_on,review_asked_on,review_left_on&archived=eq.false"),
    getAll(call, "appointments?select=customer_id,date,status&customer_id=not.is.null"),
  ]);
  const newest = new Map();
  const counts = new Map();
  for (const m of msgs) {
    if (!newest.has(m.customer_id)) newest.set(m.customer_id, m.sent_at);
    counts.set(m.customer_id, (counts.get(m.customer_id) ?? 0) + 1);
  }
  const card = new Map(insights.map((i) => [i.customer_id, i]));
  // CRM changes that make a card's timing stale: a one-off detail completed, or a visit booked by hand/web.
  const crmChangedAfter = new Map();
  for (const a of oneOffs) {
    const at = [a.completed_at, a.source !== "recurring" ? a.created_at : null].filter(Boolean).sort().pop();
    if (at && at > (crmChangedAfter.get(a.customer_id) ?? "")) crmChangedAfter.set(a.customer_id, at);
  }
  const stale = (id, newestText) => {
    const c = card.get(id);
    if (!c) return true;
    if (!c.through_message_at || new Date(newestText) > new Date(c.through_message_at)) return true; // new texts
    const crm = crmChangedAfter.get(id);
    return !!crm && new Date(crm) > new Date(c.updated_at); // new detail or booking since the card
  };
  // Last completed detail + whether anything's booked, per customer, for the proactive asks.
  const todayStr = day(new Date().toISOString());
  const lastDetail = new Map();
  const nextVisit = new Set();
  for (const a of visits) {
    if (a.status === "completed" && a.date > (lastDetail.get(a.customer_id) ?? "")) lastDetail.set(a.customer_id, a.date);
    if (a.status === "scheduled" && a.date >= todayStr) nextVisit.add(a.customer_id);
  }
  const hasPendingDraft = (id) => {
    const c = card.get(id);
    return !!c && c.suggestion_goal && c.suggestion_goal !== "none" && !c.suggestion_done_at;
  };
  // New texts or a CRM change → always refresh. Plus anyone owed a review or a rebook who doesn't
  // already have a drafted text waiting. Capped by limit; cycles through over nightly runs.
  const textStale = [...newest].filter(([id, at]) => only || stale(id, at)).map(([id]) => id);
  const proactive = only
    ? []
    : custs
        .filter((c) => !hasPendingDraft(c.id) && proactiveGoal(c, { lastDetail: lastDetail.get(c.id) ?? null, hasNextVisit: nextVisit.has(c.id), today: todayStr }))
        .map((c) => c.id);
  const ids = (only ? [only] : [...new Set([...textStale, ...proactive])]).slice(0, limit);
  const due = ids.map((id) => [id, newest.get(id) ?? null]);

  const work = mkdtempSync(join(tmpdir(), "bb-texts-")); // empty cwd: no project context for Claude
  let updated = 0;
  for (const [customerId, through] of due) {
    const [[c], vehicles, appts, plans, thread] = await Promise.all([
      call(`customers?id=eq.${customerId}&select=name,notes,tags,outreach_status,resume_on,last_contacted_on,review_asked_on,review_left_on,acquired_via`),
      call(`vehicles?customer_id=eq.${customerId}&select=kind,year,make,model,color,size_id,length_ft,notes`),
      call(`appointments?customer_id=eq.${customerId}&select=date,status,service_name,size_label,price,plan_id&order=date.desc&limit=30`),
      call(`plans?customer_id=eq.${customerId}&select=cadence,status,per_visit_price,starts_on`),
      call(`customer_messages?customer_id=eq.${customerId}&select=sent_at,from_me,body,has_attachment&order=sent_at.desc&limit=200`),
    ]);
    const first = c.name.split(/\s+/)[0];
    const lines = thread
      .reverse()
      .map((m) => `${stamp(m.sent_at)} ${m.from_me ? "Tyler" : first}: ${(m.body ?? "").slice(0, 1000)}${m.has_attachment ? " [photo or file]" : ""}`);
    const today = day(new Date().toISOString());
    const input = [
      `Today is ${today}.`,
      `Timing: ${timing({ today, appts, plans, c })}`,
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
    const { suggestion: s, ...rest } = card;
    s.text = s.text.replace(/bufferbros\.org\/book(?!ing)/g, "bufferbros.org/booking"); // the model sometimes shortens the link
    const sendOn = /^\d{4}-\d{2}-\d{2}$/.test(s.send_on) ? s.send_on : today;
    await call("customer_insights?on_conflict=customer_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        customer_id: customerId,
        updated_at: new Date().toISOString(),
        through_message_at: through,
        message_count: counts.get(customerId) ?? 0,
        ...rest,
        suggestion_goal: s.goal,
        suggestion_text: s.goal === "none" ? null : s.text.trim() || null,
        suggestion_why: s.why || null,
        suggest_on: s.goal === "none" ? null : sendOn,
        suggestion_done_at: null, // a fresh draft is unsent
      },
    });
    updated++;
  }
  return { updated, due: due.length, failed: due.length - updated };
}
