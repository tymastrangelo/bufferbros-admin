// vCard (.vcf) and CSV contact parsing — pure functions, run client-side on import.

export interface ParsedContact {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  extraPhones: string[];
  extraEmails: string[];
}

const unescapeV = (s: string) =>
  s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();

function decodeQP(s: string): string {
  // quoted-printable: soft breaks (=\n) then =XX hex bytes (decoded as UTF-8)
  const joined = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return joined;
  }
}

export function parseVcf(text: string): ParsedContact[] {
  // unfold continuation lines (RFC 6350)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const out: ParsedContact[] = [];

  for (const card of cards) {
    let fn = "";
    let n = "";
    let org = "";
    let note = "";
    const phones: { value: string; pref: boolean }[] = [];
    const emails: string[] = [];
    const addresses: string[] = [];

    for (const rawLine of card.split(/\r?\n/)) {
      const idx = rawLine.indexOf(":");
      if (idx < 0) continue;
      const keyPart = rawLine.slice(0, idx);
      let value = rawLine.slice(idx + 1);
      const key = keyPart.split(";")[0].replace(/^item\d+\./i, "").toUpperCase();
      const params = keyPart.toUpperCase();
      if (params.includes("QUOTED-PRINTABLE")) value = decodeQP(value);
      if (!value.trim()) continue;

      switch (key) {
        case "FN":
          fn = unescapeV(value);
          break;
        case "N": {
          const parts = value.split(";").map(unescapeV);
          n = [parts[1], parts[2], parts[0]].filter(Boolean).join(" ").trim();
          break;
        }
        case "ORG":
          org = unescapeV(value.split(";")[0]);
          break;
        case "TEL":
          phones.push({
            value: value.trim(),
            pref: /CELL|MOBILE|PREF/.test(params),
          });
          break;
        case "EMAIL":
          emails.push(unescapeV(value).toLowerCase());
          break;
        case "ADR": {
          const p = value.split(";").map(unescapeV);
          // po box; extended; street; city; region; zip; country
          const addr = [p[2], p[3], p[4], p[5]].filter(Boolean).join(", ");
          if (addr) addresses.push(addr);
          break;
        }
        case "NOTE":
          note = unescapeV(value);
          break;
      }
    }

    const name = fn || n || org;
    if (!name) continue;
    const sorted = [...phones.filter((p) => p.pref), ...phones.filter((p) => !p.pref)].map((p) => p.value);
    const uniquePhones = [...new Set(sorted)];
    const uniqueEmails = [...new Set(emails)];
    out.push({
      name,
      phone: uniquePhones[0] ?? null,
      email: uniqueEmails[0] ?? null,
      address: addresses[0] ?? null,
      notes: note || null,
      extraPhones: uniquePhones.slice(1),
      extraEmails: uniqueEmails.slice(1),
    });
  }
  return out;
}

/** Minimal quote-aware CSV row splitter. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function parseCsv(text: string): ParsedContact[] {
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...terms: string[]) =>
    headers.findIndex((h) => terms.some((t) => h.includes(t)));

  const iName = find("full name", "name");
  const iFirst = find("first name", "given name");
  const iLast = find("last name", "family name");
  const iPhone = find("phone", "mobile", "cell", "tel");
  const iEmail = find("e-mail", "email");
  const iAddress = find("address");
  const iNotes = find("note");

  const out: ParsedContact[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name = get(iName) || [get(iFirst), get(iLast)].filter(Boolean).join(" ");
    if (!name) continue;
    out.push({
      name,
      phone: get(iPhone) || null,
      email: get(iEmail).toLowerCase() || null,
      address: get(iAddress).replace(/\n/g, ", ") || null,
      notes: get(iNotes) || null,
      extraPhones: [],
      extraEmails: [],
    });
  }
  return out;
}

export function parseContactsFile(filename: string, text: string): ParsedContact[] {
  if (/\.vcf$/i.test(filename) || /BEGIN:VCARD/i.test(text.slice(0, 200))) return parseVcf(text);
  return parseCsv(text);
}
