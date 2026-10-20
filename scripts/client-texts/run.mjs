#!/usr/bin/env node
// Entry point for the client-texts jobs on Tyler's Mac (installed by install.sh):
//   node run.mjs            one run now: sync new texts, then refresh the cards of customers who
//                           have new texts (the 4am nightly job; also fine to run by hand)
//   node run.mjs --listen   stay running and do a run whenever the dashboard's "Sync texts now"
//                           button inserts a pending text_sync_runs row (Supabase Realtime)
//   node run.mjs --dry-run  count what would sync; writes nothing, no Claude
// Every run is recorded in text_sync_runs so the dashboard can show its status. A lock file keeps
// the nightly job and the listener from ever running at the same time.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, rest, supabaseEnv } from "./lib.mjs";
import { summarizeChanged } from "./summarize.mjs";
import { syncTexts } from "./sync.mjs";

const env = supabaseEnv();
const call = rest(env);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const now = () => new Date().toISOString();

// ── one run at a time ────────────────────────────────────────────────────────
const LOCK = join(STATE_DIR, "run.lock");
function takeLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      process.kill(Number(readFileSync(LOCK, "utf8")), 0); // holder still alive → busy
      return false;
    } catch {
      unlinkSync(LOCK); // stale lock from a crashed run
      return takeLock();
    }
  }
}
const releaseLock = () => {
  try {
    unlinkSync(LOCK);
  } catch {}
};

const patchRuns = (ids, body) => call(`text_sync_runs?id=in.(${ids.join(",")})`, { method: "PATCH", body, prefer: "return=minimal" });

/** Sync + refresh cards, reported on the given run rows (or a new row for `source`). false = locked. */
async function runOnce(source, ids = []) {
  if (!takeLock()) return false;
  try {
    if (ids.length) await patchRuns(ids, { status: "running", started_at: now() });
    else {
      const [row] = await call("text_sync_runs", { method: "POST", body: { source, status: "running", started_at: now() }, prefer: "return=representation" });
      ids = [row.id];
    }
    try {
      const s = await syncTexts(call);
      const c = await summarizeChanged(call, { log });
      await patchRuns(ids, {
        status: "done",
        finished_at: now(),
        texts_synced: s.synced,
        cards_updated: c.updated,
        error: c.failed ? `${c.failed} card${c.failed === 1 ? "" : "s"} failed; see ~/Library/Logs/bufferbros-texts.log` : null,
      });
      log(`${source} run: ${s.synced} new texts (${s.customers} customers), ${c.updated}/${c.due} cards updated`);
    } catch (e) {
      await patchRuns(ids, { status: "error", finished_at: now(), error: String(e.message).slice(0, 500) });
      log(`${source} run failed: ${e.message}`);
    }
  } finally {
    releaseLock();
  }
  return true;
}

if (process.argv.includes("--dry-run")) {
  const s = await syncTexts(call, { dryRun: true });
  log(`dry run: ${s.synced} customer texts across ${s.customers} customers (scanned ${s.scanned})`);
} else if (process.argv.includes("--listen")) {
  let busy = false;
  let again = false;
  const drain = async () => {
    if (busy) return void (again = true);
    busy = true;
    try {
      do {
        again = false;
        const pending = await call("text_sync_runs?status=eq.pending&select=id&order=requested_at");
        if (pending.length && !(await runOnce("requested", pending.map((p) => p.id)))) setTimeout(drain, 60_000); // nightly run holds the lock
      } while (again);
    } catch (e) {
      log(`listener: ${e.message}`);
    } finally {
      busy = false;
    }
  };
  createClient(env.url, env.key, { auth: { persistSession: false } })
    .channel("text-sync-requests")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "text_sync_runs", filter: "status=eq.pending" }, drain)
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") log(`listener: ${status}`);
      drain(); // on connect, AND on every error/reconnect, so a flaky socket never strands a pending request
    });
  setInterval(drain, 2 * 60_000); // safety net: a button press lands within ~2 min even if Realtime is down
  log("listener: waiting for sync requests");
} else {
  const ok = await runOnce(process.argv.includes("--nightly") ? "nightly" : "manual");
  if (!ok) log("another run is in progress; skipped");
  process.exit(0);
}
