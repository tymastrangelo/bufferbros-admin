// Copies 1:1 text threads with CRM customers from this Mac's Messages database into
// customer_messages. Called by run.mjs. Only threads whose phone number matches a customer are
// kept; nobody else's texts leave the Mac. Needs Full Disk Access for the node binary.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STATE_DIR, appleDateToISO, cleanBody, decodeAttributedBody, getAll, phoneKey } from "./lib.mjs";

const STATE = join(STATE_DIR, "texts-state.json");
const CHAT_DB = join(homedir(), "Library/Messages/chat.db");

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return { lastRowId: 0, knownKeys: [] };
  }
}

/** @returns {Promise<{ synced: number, customers: number, scanned: number }>} */
export async function syncTexts(call, { dryRun = false } = {}) {
  const state = readState();

  // phone → customer (oldest record wins if two share a number; merging fixes that)
  const customers = await getAll(call, "customers?select=id,phone,created_at&phone=not.is.null&order=created_at");
  const byKey = new Map();
  for (const c of customers) {
    const k = phoneKey(c.phone);
    if (k && !byKey.has(k)) byKey.set(k, c.id);
  }
  const newKeys = [...byKey.keys()].filter((k) => !state.knownKeys.includes(k));

  let db;
  try {
    db = new DatabaseSync(CHAT_DB, { readOnly: true });
  } catch (e) {
    throw new Error(`Can't open Messages (${e.message}). Give ${process.execPath} Full Disk Access: System Settings → Privacy & Security → Full Disk Access.`);
  }

  // 1:1 chats only (style 45); skip tapbacks/reactions (associated_message_type) and group events
  // (item_type). Dates are converted to seconds in SQL: modern macOS stores nanoseconds since 2001,
  // which overflow a JS number (node:sqlite throws ERR_OUT_OF_RANGE on them).
  const rows = (sinceRowId) =>
    db
      .prepare(
        `select m.ROWID as rowid, m.guid, m.text, m.attributedBody as attributed,
                case when m.date > 100000000000 then m.date / 1000000000 else m.date end as dateSec,
                m.is_from_me as fromMe, m.service, m.cache_has_attachments as hasAttachment, c.chat_identifier as ident
           from message m
           join chat_message_join cmj on cmj.message_id = m.ROWID
           join chat c on c.ROWID = cmj.chat_id
          where m.ROWID > ? and c.style = 45 and m.associated_message_type = 0 and m.item_type = 0
          order by m.ROWID`
      )
      .all(sinceRowId);

  const fresh = rows(state.lastRowId);
  // A customer added since the last run gets their whole history once.
  const backfill = newKeys.length && state.lastRowId > 0 ? rows(0).filter((r) => newKeys.includes(phoneKey(r.ident))) : [];
  const maxRowId = fresh.reduce((m, r) => Math.max(m, Number(r.rowid)), state.lastRowId); // no spread: first run can be 100k rows
  db.close();

  const out = [];
  for (const r of [...backfill, ...fresh]) {
    const customerId = byKey.get(phoneKey(r.ident));
    if (!customerId) continue;
    const body = cleanBody(r.text) ?? cleanBody(decodeAttributedBody(r.attributed));
    if (!body && !r.hasAttachment) continue;
    out.push({
      guid: r.guid,
      customer_id: customerId,
      sent_at: appleDateToISO(r.dateSec),
      from_me: r.fromMe === 1,
      body,
      service: r.service ?? null,
      has_attachment: r.hasAttachment === 1,
    });
  }
  const result = { synced: out.length, customers: new Set(out.map((m) => m.customer_id)).size, scanned: fresh.length + backfill.length };
  if (dryRun) return result;

  // Oldest first so the touch trigger sees history in order; already-synced guids are skipped.
  out.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  for (let i = 0; i < out.length; i += 500) {
    await call("customer_messages?on_conflict=guid", { method: "POST", body: out.slice(i, i + 500), prefer: "resolution=ignore-duplicates,return=minimal" });
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify({ lastRowId: maxRowId, knownKeys: [...byKey.keys()], syncedAt: new Date().toISOString() }));
  return result;
}
