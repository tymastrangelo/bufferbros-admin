// Transactional email via Resend (fetch, no SDK). Server-side only.
// Voice ported verbatim from the website: plain, friendly, signed "Buffer Bros".
import "server-only";

const FOOTER_TEXT = "Questions? Call or text us at (239) 293-8511.";

function shell(body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a0e14;max-width:560px;margin:0 auto;padding:24px 16px">
${body}
<p style="margin:24px 0 0">— Buffer Bros</p>
<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280">${FOOTER_TEXT}</p>
</div>`;
}

export type EmailResult = { ok: boolean; skipped?: boolean; error?: string };

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, skipped: true, error: "RESEND_API_KEY / EMAIL_FROM not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface JobEmailInfo {
  name: string;
  when: string; // "Wednesday, June 6, 2026 at 9:00 AM"
  address?: string | null;
  serviceName: string;
  addons?: { name: string }[];
  price?: number | null;
}

function jobDetails(info: JobEmailInfo): string {
  const rows = [
    ["What", info.serviceName + (info.addons?.length ? ` + ${info.addons.map((a) => a.name).join(", ")}` : "")],
    ["When", info.when],
    ...(info.address ? [["Where", info.address]] : []),
    ...(info.price ? [["Quoted", `$${info.price}`]] : []),
  ];
  return `<table style="border-collapse:collapse;margin:16px 0">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;vertical-align:top">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>`
    )
    .join("")}</table>`;
}

export function confirmedEmail(info: JobEmailInfo): { subject: string; html: string } {
  return {
    subject: "Your Buffer Bros appointment is confirmed",
    html: shell(
      `<p>Hi ${esc(info.name)},</p>
<p>Your Buffer Bros appointment is confirmed.</p>
${jobDetails(info)}
<p>The time may be an arrival window, and final pricing is confirmed on site.</p>`
    ),
  };
}

export function updatedEmail(info: JobEmailInfo & { oldWhen: string }): { subject: string; html: string } {
  return {
    subject: "Your Buffer Bros appointment was updated",
    html: shell(
      `<p>Hi ${esc(info.name)},</p>
<p>Your appointment time has changed.</p>
<p style="color:#6b7280"><s>${esc(info.oldWhen)}</s></p>
<p><strong>Now: ${esc(info.when)}</strong></p>
${jobDetails(info)}
<p>The time may be an arrival window, and final pricing is confirmed on site.</p>`
    ),
  };
}

export function paymentRequestEmail(info: {
  name: string;
  amount: number;
  what: string; // "The Standard Detail on July 20" / "Maintenance plan — 6 visits prepaid"
  url: string;
}): { subject: string; html: string } {
  return {
    subject: `Buffer Bros — pay $${info.amount} online`,
    html: shell(
      `<p>Hi ${esc(info.name)},</p>
<p>Here's your secure payment link for <strong>${esc(info.what)}</strong>.</p>
<p style="margin:24px 0">
  <a href="${info.url}" style="background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;display:inline-block">Pay $${info.amount}</a>
</p>
<p style="font-size:13px;color:#6b7280">Card, Apple Pay, and more — handled securely by Stripe. Prefer cash, Zelle, or Venmo? That works too, just ignore this link.</p>`
    ),
  };
}

export function cancelledEmail(info: { name: string; when: string }): { subject: string; html: string } {
  return {
    subject: "Your Buffer Bros appointment was cancelled",
    html: shell(
      `<p>Hi ${esc(info.name)},</p>
<p>Your appointment on ${esc(info.when)} has been cancelled.</p>
<p>Want to rebook? Visit <a href="https://bufferbros.org" style="color:#2563eb">bufferbros.org</a> or call us and we will find a new time.</p>`
    ),
  };
}
