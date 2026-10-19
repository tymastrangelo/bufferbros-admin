// Runnable check for duplicate detection: `npx tsx src/lib/duplicates.check.ts`
import assert from "node:assert/strict";
import { findDuplicates, pairKey, previewMerge, type DupCandidate } from "./duplicates";

const c = (id: string, over: Partial<DupCandidate> = {}): DupCandidate => ({
  id,
  name: "Someone " + id,
  phone: null,
  email: null,
  addresses: [],
  tags: [],
  created_at: `2026-01-0${id.length}`,
  archived: false,
  activity: 0,
  ...over,
});

// Three Janets, one with a phone and history → one group, that one kept.
const janets = [
  c("a", { name: "Janet", created_at: "2026-03-01" }),
  c("b", { name: "janet ", phone: "+12392852086", activity: 4, created_at: "2026-02-01" }),
  c("c", { name: "Janet.", created_at: "2026-01-01" }),
  c("z", { name: "Bob" }),
];
let g = findDuplicates(janets);
assert.equal(g.length, 1);
assert.deepEqual(g[0].ids, ["c", "b", "a"]); // oldest first
assert.equal(g[0].keepId, "b");
assert.deepEqual(g[0].reasons, ["name"]);
assert.equal(g[0].conflict, false);

// Chaining: A~B by phone (formatting differs), B~C by email.
g = findDuplicates([
  c("a", { name: "Kat", phone: "(239) 555-0100" }),
  c("b", { name: "Katherine", phone: "+1 239 555 0100", email: "K@x.com" }),
  c("c", { name: "K. Smith", email: "k@x.com " }),
]);
assert.equal(g.length, 1);
assert.equal(g[0].ids.length, 3);
assert.deepEqual(g[0].reasons, ["phone", "email"]);

// Same name, different phones → still suggested, flagged as a possible two-people case.
g = findDuplicates([c("a", { name: "Mike", phone: "2395550001" }), c("b", { name: "Mike", phone: "2395550002" })]);
assert.equal(g[0].conflict, true);

// "Not duplicates" answers are respected.
assert.equal(findDuplicates([c("a", { name: "Mike" }), c("b", { name: "Mike" })], [pairKey("b", "a")]).length, 0);

// Archived records lose the keeper vote; blanks never match each other.
g = findDuplicates([c("a", { name: "Ann", archived: true, activity: 3 }), c("b", { name: "Ann" })]);
assert.equal(g[0].keepId, "b");
assert.equal(findDuplicates([c("a", { name: "" }), c("b", { name: "  " })]).length, 0);

// Preview mirrors the SQL: keeper wins, blanks fill, addresses dedupe case-insensitively.
const p = previewMerge(
  [
    c("k", { name: "Janet", phone: "+12392852086", addresses: [{ label: "Home", address: "1 Main St" }], tags: ["vip"], activity: 2 }),
    c("d", { name: "Janet", email: "j@x.com", addresses: [{ label: "Home", address: " 1 main st" }, { label: "Work", address: "9 Bay" }], tags: ["weekly", "vip"], activity: 1 }),
  ],
  "k"
);
assert.equal(p.phone, "+12392852086");
assert.equal(p.email, "j@x.com");
assert.deepEqual(p.addresses.map((a) => a.address), ["1 Main St", "9 Bay"]);
assert.deepEqual(p.tags, ["vip", "weekly"]);
assert.equal(p.activity, 3);

console.log("duplicates.check: ok");
