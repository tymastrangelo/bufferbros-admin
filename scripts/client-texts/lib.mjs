// Shared pieces for the client-texts sync (runs on Tyler's Mac, not on Vercel).
// Pure functions are checked by lib.check.mjs: `node scripts/client-texts/lib.check.mjs`.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** Sync watermark + run lock live here (outside the repo). */
export const STATE_DIR = join(homedir(), "Library/Application Support/BufferBros");

/** Messages stores dates as time since 2001-01-01 UTC: nanoseconds on modern macOS, seconds before. */
export function appleDateToISO(v) {
  const n = Number(v);
  const seconds = n > 1e11 ? n / 1e9 : n;
  return new Date((seconds + 978307200) * 1000).toISOString();
}

/** Newer macOS leaves message.text empty and keeps the words in attributedBody (an
 *  NSAttributedString "typedstream"): the string follows the NSString class marker, after
 *  5 header bytes and a length (1 byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE). */
export function decodeAttributedBody(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  const marker = buf.indexOf("NSString");
  if (marker < 0) return null;
  let i = marker + "NSString".length + 5;
  let len = buf[i++];
  if (len === 0x81) {
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = buf.readUInt32LE(i);
    i += 4;
  }
  if (!len || i + len > buf.length) return null;
  return buf.subarray(i, i + len).toString("utf8");
}

/** Message text with the attachment placeholder (U+FFFC) stripped; null when nothing's left. */
export function cleanBody(text) {
  const t = (text ?? "").replace(/￼/g, "").trim();
  return t || null;
}

/** "+1 (239) 555-0100", "2395550100", "+12395550100" → "2395550100"; emails/short codes → null. */
export function phoneKey(p) {
  const d = String(p ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

/** NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the admin repo's .env.local. */
export function supabaseEnv() {
  const env = {};
  for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  if (!/\.supabase\.co\/?$/.test(url)) throw new Error(`.env.local points at ${new URL(url).host}, not the production project`);
  return { url: url.replace(/\/$/, ""), key };
}

/** Tiny PostgREST client with the service role (bypasses RLS; stays on this Mac). */
export function rest({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
  return async function call(path, { method = "GET", body, prefer } = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer && { Prefer: prefer }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    return res.status === 204 || prefer?.includes("return=minimal") ? null : res.json();
  };
}

/** Read every page of a GET (PostgREST caps responses at 1000 rows). */
export async function getAll(call, path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await call(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${from}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
