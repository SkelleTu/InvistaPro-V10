import assert from "node:assert/strict";
import {
  AdvancedLearningSystem,
  DEFAULT_ADVANCED_CONFIG,
} from "../server/services/advanced-learning-system.js";

const system = new AdvancedLearningSystem(DEFAULT_ADVANCED_CONFIG);
const report = await system.generatePerformanceInsights("TEST_SYMBOL", "day");

assert.equal(report.metrics.sampleSize, 0);
assert.equal(report.metrics.accuracy, 0);
assert.equal(report.metrics.profitability, 0);
assert.equal(report.metrics.sharpeRatio, 0);
assert.equal(report.metrics.maxDrawdown, 0);
assert.equal(report.metrics.winRate, 0);
assert.equal(report.metrics.avgReturn, 0);
assert.equal(report.metrics.volatility, 0);
assert.equal(report.insights.performance_trend, "insufficient_data");
assert.equal(report.insights.risk_level, "unknown");
assert.equal(report.insights.opportunity_score, 0);
assert.equal(report.recommendations.weight_adjustments, "do_not_adjust_without_evidence");
assert.equal(report.recommendations.risk_management, "keep_live_execution_disabled_until_independently_validated");

console.log("OK: AI analytics never invent performance when no outcomes exist");
