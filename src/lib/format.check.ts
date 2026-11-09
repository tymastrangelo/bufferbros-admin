// npx tsx src/lib/format.check.ts — open-redirect guard for ?next= (login + auth callback).
import assert from "node:assert/strict";
import { safeNext } from "./format";

const o = "https://admin.bufferbros.org";
assert.equal(safeNext("/calendar?view=day", o), "/calendar?view=day");
assert.equal(safeNext(null, o), "/");
for (const bad of ["javascript:alert(1)", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com/x", "/.//evil.com", "http://[", " //evil.com"]) {
  const got = safeNext(bad, o);
  assert.ok(new URL(got, o).origin === o && got.startsWith("/") && !got.startsWith("//"), `${JSON.stringify(bad)} -> ${got}`);
}
console.log("format.check: ok");
