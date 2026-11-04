import assert from "node:assert/strict";
import { calculateMt5PositionHardStop } from "../server/services/mt5-position-risk";

assert.equal(calculateMt5PositionHardStop(9696.4, 0.01), -0.2);
assert.equal(calculateMt5PositionHardStop(10000, 1), -20);
assert.equal(calculateMt5PositionHardStop(10000, 2), -25);
assert.equal(calculateMt5PositionHardStop(0, 0.01), -0.2);
assert.equal(calculateMt5PositionHardStop(10000, 0), -0.2);

console.log("MT5 position hard-stop sizing validated.");
