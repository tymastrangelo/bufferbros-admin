// Runnable check for job checklists: `npx tsx src/lib/checklist.check.ts`
import assert from "node:assert/strict";
import { checklistProgress, reseedChecklist, seedChecklist } from "./checklist";

const steps = ["Vacuum", "Hand wash"];
const seeded = seedChecklist(steps, [{ id: "pet-hair", name: "Pet Hair Removal" }]);
assert.deepEqual(seeded, [
  { id: "svc:0", name: "Vacuum", done: false },
  { id: "svc:1", name: "Hand wash", done: false },
  { id: "addon:pet-hair", name: "Pet Hair Removal", done: false },
]);
// Boat components come last, one each.
assert.deepEqual(seedChecklist([], [], [{ id: "wax-ft", name: "Wax" }]).map((i) => i.id), ["boat:wax-ft"]);

// Add-ons change after booking: ticked survivors stay ticked, new items arrive unticked, gone items vanish.
const current = [
  { id: "svc:0", name: "Vacuum", done: true },
  { id: "svc:1", name: "Hand wash", done: false },
  { id: "addon:pet-hair", name: "Pet Hair Removal", done: true },
];
const next = seedChecklist(steps, [{ id: "odor", name: "Odor / Ozone Treatment" }]);
assert.deepEqual(reseedChecklist(current, next), [
  { id: "svc:0", name: "Vacuum", done: true },
  { id: "svc:1", name: "Hand wash", done: false },
  { id: "addon:odor", name: "Odor / Ozone Treatment", done: false },
]);

assert.deepEqual(checklistProgress(current), { done: 2, total: 3 });
assert.deepEqual(checklistProgress([]), { done: 0, total: 0 });

console.log("checklist.check ok");
