// Currency, phone and link formatting. Whole dollars unless cents exist (spec §10).

export function money(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

/** Digits only, with US country code stripped: "+1 (239) 293-8511" -> "2392938511" */
export function phoneDigits(p: string | null | undefined): string {
  if (!p) return "";
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/** "2392938511" -> "(239) 293-8511"; anything unparseable passes through untouched. */
export function fmtPhone(p: string | null | undefined): string {
  const d = phoneDigits(p);
  if (d.length !== 10) return p ?? "";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Normalize to E.164 where possible for storage/dedupe. */
export function normalizePhone(p: string | null | undefined): string | null {
  const d = phoneDigits(p);
  return d.length === 10 ? `+1${d}` : p?.trim() || null;
}

export const telHref = (p: string) => `tel:+1${phoneDigits(p)}`;
export const smsHref = (p: string) => `sms:+1${phoneDigits(p)}`;
export const mapsHref = (address: string) => `https://maps.apple.com/?q=${encodeURIComponent(address)}`;

export function normalizeEmail(e: string | null | undefined): string | null {
  const v = e?.trim().toLowerCase();
  return v || null;
}
