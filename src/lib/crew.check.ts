// Runnable check for crew helpers: `npx tsx src/lib/crew.check.ts`
import assert from "node:assert/strict";
import { hoursFor, lanesOf } from "./crew";

const biz = { enabled: true, open_min: 480, close_min: 1080 };
// No custom hours → business hours.
assert.deepEqual(hoursFor(null, 1, biz), [480, 1080]);
assert.deepEqual(hoursFor({}, 1, biz), [480, 1080]);
assert.deepEqual(hoursFor({ "1": null }, 1, biz), [480, 1080]);
// Explicit day off.
assert.equal(hoursFor({ "1": false }, 1, biz), null);
// Custom window wins.
assert.deepEqual(hoursFor({ "1": [540, 900] }, 1, biz), [540, 900]);
// Business closed that day and no custom entry → off.
assert.equal(hoursFor({ "1": null }, 1, { ...biz, enabled: false }), null);
assert.equal(hoursFor(null, 1, undefined), null);
// Custom window on a day the business is closed still counts (their own schedule).
assert.deepEqual(hoursFor({ "0": [600, 840] }, 0, { ...biz, enabled: false }), [600, 840]);

// Lanes: no assignees = the owner's lane; otherwise one lane per assignee.
assert.deepEqual(lanesOf([]), ["me"]);
assert.deepEqual(lanesOf(["a", "b"]), ["a", "b"]);

console.log("crew.check ok");
