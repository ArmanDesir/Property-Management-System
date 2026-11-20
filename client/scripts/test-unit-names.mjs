import assert from "node:assert/strict";
import { generateUnitNames, maximumBulkUnits } from "../src/features/properties/unit-names.ts";

assert.deepEqual(generateUnitNames("001-R", 3), {
  names: ["001-R", "002-R", "003-R"],
  error: null,
});
assert.deepEqual(generateUnitNames("BLD-009-R", 3).names, [
  "BLD-009-R",
  "BLD-010-R",
  "BLD-011-R",
]);
assert.deepEqual(generateUnitNames("001-VIP", 2).names, ["001-VIP", "002-VIP"]);
assert.match(generateUnitNames("VIP", 2).error ?? "", /include a number/);
assert.match(generateUnitNames("001-R", maximumBulkUnits + 1).error ?? "", /between 1 and 500/);

console.log("Bulk unit naming tests passed.");
