// Runnable check: `node scripts/client-texts/lib.check.mjs`
import assert from "node:assert/strict";
import { appleDateToISO, cleanBody, decodeAttributedBody, phoneKey } from "./lib.mjs";

// Modern (nanoseconds) and legacy (seconds) Messages dates, both since 2001-01-01.
assert.equal(appleDateToISO(0), "2001-01-01T00:00:00.000Z");
assert.equal(appleDateToISO(800000000), "2026-05-09T06:13:20.000Z");
assert.equal(appleDateToISO(800000000 * 1e9), "2026-05-09T06:13:20.000Z");

// attributedBody: short (1-byte length) and long (0x81 + uint16) strings.
const blob = (text) => {
  const t = Buffer.from(text, "utf8");
  const len = t.length < 0x80 ? Buffer.from([t.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([t.length & 0xff, t.length >> 8])]);
  return Buffer.concat([Buffer.from("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString", "latin1"), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), len, t, Buffer.from([0x86, 0x84])]);
};
assert.equal(decodeAttributedBody(blob("Can you come Thursday?")), "Can you come Thursday?");
const long = "Thanks again! ".repeat(20);
assert.equal(decodeAttributedBody(blob(long)), long);
assert.equal(decodeAttributedBody(null), null);
assert.equal(decodeAttributedBody(Buffer.from("no marker here")), null);

assert.equal(cleanBody("￼"), null);
assert.equal(cleanBody(" ￼Looks great "), "Looks great");

assert.equal(phoneKey("+1 (239) 293-8511"), "2392938511");
assert.equal(phoneKey("2392938511"), "2392938511");
assert.equal(phoneKey("someone@icloud.com"), null);
assert.equal(phoneKey("55555"), null);

console.log("client-texts lib.check: ok");
