/**
 * RiceFlow — Stage 1 Isolated Test Suite for AI Product Demand Prediction Engine
 *
 * Verifies:
 * 1. Historical sales filtering (cancellations, replacements, unverified payments, pre-orders)
 * 2. Feature extraction (bias, day-of-week, weekend, momentum, queue pressure)
 * 3. Regularized Poisson Regression training via Newton-Raphson loss minimization
 * 4. Data sufficiency gate (returns 'insufficient_data' when observations < 14)
 * 5. Multi-day prediction (7d and 30d horizons, non-negativity, Poisson 95% CI)
 * 6. Stockout censoring mask (ensures supply failure is not treated as zero demand)
 * 7. Invalid & edge-case input resilience (nulls, empty arrays, malformed items)
 * 8. Chronological walk-forward validation without lookahead data leakage
 * 9. Real Firestore 20-order dataset audit (evaluates each live catalog product)
 *
 * ZERO DATABASE MUTATIONS: All test fixtures are purely local in-memory objects.
 */

import {
  DEFAULT_DEMAND_READINESS_THRESHOLDS,
  assessDemandDataReadiness,
  filterVerifiedHistoricalSales,
  extractOrderDate,
  toISODateKey,
  buildDailyProductSeries,
  extractDemandFeatures,
  fitRegularizedPoissonRegression,
  trainProductDemandModel,
  predictProductDemand,
  evaluateWalkForwardValidation
} from '../src/app/product-demand-model.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    throw new Error(`Test failed: ${testName} ${details}`);
  }
}

console.log('\n===============================================================');
console.log('RiceFlow — Stage 1: Isolated AI Demand Prediction Test Suite');
console.log('===============================================================\n');

// ----------------------------------------------------------------------------
// TEST SUITE 1: VERIFIED HISTORICAL SALES FILTERING
// ----------------------------------------------------------------------------
console.log('--- Test Suite 1: Historical Sales Filtering ---');

const mixedOrders = [
  { id: 'ORD-101', status: 'completed', paymentVerified: true, items: [{ productId: '6', quantity: 5 }] },
  { id: 'ORD-102', status: 'delivered', paymentVerified: true, items: [{ productId: '6', quantity: 2 }] },
  { id: 'ORD-103', status: 'cancelled', paymentVerified: false, items: [{ productId: '6', quantity: 10 }] }, // Cancelled -> EXCLUDE
  { id: 'ORD-104', status: 'rejected', paymentRejected: true, items: [{ productId: '6', quantity: 8 }] }, // Rejected -> EXCLUDE
  { id: 'ORD-105', status: 'completed', isReplacement: true, paymentVerified: true, items: [{ productId: '6', quantity: 4 }] }, // Replacement -> EXCLUDE
  { id: 'RES-201', status: 'pre-order', isPreOrder: true, items: [{ productId: '6', quantity: 15, isReservation: true }] }, // Reservation -> EXCLUDE from past sales
  { id: 'ORD-106', status: 'to-pay', paymentVerified: false, items: [{ productId: '6', quantity: 3 }] }, // Unverified payment -> EXCLUDE
  { id: 'ORD-107', status: 'processing', paymentVerified: true, items: [{ productId: '6', quantity: 7 }] } // Verified in-flight -> INCLUDE
];

const filtered = filterVerifiedHistoricalSales(mixedOrders);
assert(filtered.length === 3, 'Filters out cancelled, rejected, replacement, pre-orders, and unpaid orders');
assert(filtered.map(o => o.id).sort().join(',') === 'ORD-101,ORD-102,ORD-107', 'Strictly retains only verified completed or in-flight retail sales');

// ----------------------------------------------------------------------------
// TEST SUITE 2: FEATURE EXTRACTION & NORMALIZATION
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Feature Extraction ---');

const mockSaturdayRecord = {
  dayOfWeek: 6,
  isWeekend: 1,
  trailing7dMean: 4.5
};

const featsSat = extractDemandFeatures(mockSaturdayRecord, 12);
assert(featsSat[0] === 1.0, 'Feature 0 is bias / intercept term (1.0)');
assert(featsSat[1] === 1.0, 'Feature 1 is normalized day-of-week for Saturday (6/6 = 1.0)');
assert(featsSat[2] === 1.0, 'Feature 2 is weekend indicator (1 for Saturday)');
assert(featsSat[3] === 4.5, 'Feature 3 captures trailing 7-day sales momentum (4.5 sacks)');
assert(featsSat[4] === 1.2, 'Feature 4 scales reservation queue pressure');

const mockWednesdayRecord = {
  dayOfWeek: 3,
  isWeekend: 0,
  trailing7dMean: 2.0
};
const featsWed = extractDemandFeatures(mockWednesdayRecord, 0);
assert(featsWed[1] === 0.5, 'Feature 1 normalized day-of-week for Wednesday is 0.5 (3/6)');
assert(featsWed[2] === 0, 'Feature 2 weekend indicator is 0 for Wednesday');
assert(featsWed[4] === 0, 'Feature 4 is 0 when queue pressure is 0');

// ----------------------------------------------------------------------------
// TEST SUITE 3: POISSON REGRESSION SOLVER & LOSS MINIMIZATION
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Supervised Regularized Poisson Regression ---');

// Synthetic dataset where true relationship is: lambda = exp(0.5 + 0.8 * x1)
const syntheticDataset = [];
for (let i = 0; i < 30; i++) {
  const x1 = i / 30; // 0 to 1
  const trueLambda = Math.exp(0.5 + 0.8 * x1);
  // Integer Poisson-like count
  const y = Math.round(trueLambda);
  syntheticDataset.push({
    x: [1.0, x1],
    y
  });
}

const fit = fitRegularizedPoissonRegression(syntheticDataset, { lambdaReg: 0.1 });
assert(fit.converged === true, 'Newton-Raphson solver successfully converges to optimal loss');
assert(fit.iterationsRun <= 15, `Converges rapidly in few iterations (took ${fit.iterationsRun} iterations)`);
assert(fit.weights.length === 2, 'Solves for correct number of feature weights');
assert(fit.weights[1] > 0, `Learned slope weight is positive reflecting higher demand with higher x1 (weight: ${fit.weights[1]})`);
assert(fit.deviance >= 0, `Deviance is non-negative and finite (${fit.deviance})`);

// ----------------------------------------------------------------------------
// TEST SUITE 4: DATA READINESS GATE & MULTI-CRITERION SAFEGUARDS
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 4: Data Readiness Gate & Multi-Criterion Safeguards ---');

// Case 1: Scarce calendar days (only 5 days, far below minimum 14)
const scarceOrders = [
  { id: 'ORD-S1', status: 'completed', paymentVerified: true, createdAt: '2026-10-01T10:00:00Z', items: [{ productId: 'variety-low', quantity: 2 }] },
  { id: 'ORD-S2', status: 'completed', paymentVerified: true, createdAt: '2026-10-03T10:00:00Z', items: [{ productId: 'variety-low', quantity: 1 }] }
];

const lowDataModel = trainProductDemandModel(scarceOrders, 'variety-low', {
  minInStockDays: 14,
  startDate: new Date('2026-10-01'),
  endDate: new Date('2026-10-05') // Only 5 calendar days
});

assert(lowDataModel.status === 'insufficient_data', 'Correctly refuses to claim trained status when calendar days are insufficient');
assert(lowDataModel.isTrained === false, 'isTrained flag is strictly false');
assert(lowDataModel.forecastReady === false, 'forecastReady flag is strictly false');
assert(lowDataModel.readiness.passed === false, 'readiness.passed is strictly false');

// Case 2: Sufficient calendar days (20 days) but sparse transactions (only 2 distinct orders)
// Verifies that calendar-day count alone does NOT fool the readiness gate!
const sparseOrders = [
  { id: 'ORD-SP1', status: 'completed', paymentVerified: true, createdAt: '2026-09-02T10:00:00Z', items: [{ productId: 'variety-sparse', quantity: 2 }] },
  { id: 'ORD-SP2', status: 'completed', paymentVerified: true, createdAt: '2026-09-15T10:00:00Z', items: [{ productId: 'variety-sparse', quantity: 1 }] }
];

const sparseModel = trainProductDemandModel(sparseOrders, 'variety-sparse', {
  minInStockDays: 14,
  minDistinctOrders: 6,
  minNonZeroSalesDays: 4,
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-20') // 20 calendar days!
});

assert(sparseModel.status === 'insufficient_data', 'Refuses to label model as trained when distinct orders are below threshold despite 20 calendar days');
assert(sparseModel.forecastReady === false, 'forecastReady is false when transactions are sparse');
assert(sparseModel.readiness.failingReasons.some(r => r.includes('Distinct verified sales orders')), 'Explicitly reports distinct orders shortfall in failingReasons');

// Case 3: Clustered orders (8 orders, but all placed on only 2 distinct days)
const clusteredOrders = [];
for (let i = 1; i <= 8; i++) {
  clusteredOrders.push({
    id: `ORD-CLU-${i}`,
    status: 'completed',
    paymentVerified: true,
    createdAt: (i <= 4 ? '2026-09-05T10:00:00Z' : '2026-09-12T10:00:00Z'),
    items: [{ productId: 'variety-clustered', quantity: 2 }]
  });
}

const clusteredModel = trainProductDemandModel(clusteredOrders, 'variety-clustered', {
  minInStockDays: 14,
  minDistinctOrders: 6,
  minNonZeroSalesDays: 4,
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-20')
});

assert(clusteredModel.status === 'insufficient_data', 'Refuses to label model as trained when non-zero sales days are below threshold');
assert(clusteredModel.readiness.failingReasons.some(r => r.includes('Non-zero sales days')), 'Explicitly reports non-zero sales days shortfall');

// Case 4: Prediction on unready model returns safe fallback
const fallbackPrediction = predictProductDemand(lowDataModel, 7);
assert(fallbackPrediction.status === 'insufficient_data', 'Prediction returns insufficient_data status instead of hallucinating predictions');
assert(fallbackPrediction.isPredicted === false, 'isPredicted is false');
assert(fallbackPrediction.isFallback === true, 'isFallback is true');
assert(fallbackPrediction.predictedSacks === null, 'predictedSacks is null, not an invented number');
assert(fallbackPrediction.confidenceInterval === null, 'confidenceInterval is null when model is unready');

// ----------------------------------------------------------------------------
// TEST SUITE 5: PREDICTION HORIZON & UNCALIBRATED THEORETICAL BOUNDS
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 5: Prediction Horizon & Uncalibrated Theoretical Bounds ---');

// Sufficient 20-day dataset: 20 orders, one each day, 20 distinct sales days
const sufficientOrders = [];
for (let d = 1; d <= 20; d++) {
  const dayStr = String(d).padStart(2, '0');
  sufficientOrders.push({
    id: `ORD-SUF-${d}`,
    status: 'completed',
    paymentVerified: true,
    createdAt: `2026-09-${dayStr}T10:00:00Z`,
    items: [{ productId: 'variety-healthy', quantity: (d % 3 === 0 ? 4 : 2) }]
  });
}

const trainedModel = trainProductDemandModel(sufficientOrders, 'variety-healthy', {
  minInStockDays: 14,
  minDistinctOrders: 10,
  minNonZeroSalesDays: 7,
  minTotalSacksSold: 15,
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-20')
});

assert(trainedModel.status === 'trained', 'Model trains successfully when all readiness criteria are met');
assert(trainedModel.isTrained === true, 'isTrained flag is true');
assert(trainedModel.forecastReady === true, 'forecastReady flag is true');
assert(trainedModel.mathematicallyConverged === true, 'mathematicallyConverged flag is true');
assert(trainedModel.readiness.passed === true, 'readiness.passed is true');

const pred7d = predictProductDemand(trainedModel, 7, { startDate: new Date('2026-09-21') });
assert(pred7d.status === 'predicted', 'Produces valid prediction status for 7-day horizon');
assert(pred7d.predictedSacks > 0, `Predicted sacks is a positive whole number (${pred7d.predictedSacks} sacks)`);
assert(pred7d.isExperimental === true, 'Prediction is explicitly flagged as experimental');
assert(pred7d.isAdvisory === true, 'Prediction is explicitly flagged as advisory only');

// Honest uncertainty validation (Stage 1.6 Requirement 3)
assert(pred7d.confidenceInterval.isCalibrated === false, 'Confidence interval is explicitly marked isCalibrated = false');
assert(pred7d.confidenceInterval.intervalType.includes('Theoretical Poisson dispersion'), 'Interval type is clearly labeled as theoretical Poisson dispersion');
assert(pred7d.confidenceInterval.confidenceLevel.includes('Uncalibrated'), 'Confidence level notes uncalibrated status');
assert(pred7d.confidenceInterval.lowerBound <= pred7d.predictedSacks, 'Lower confidence bound is <= predicted sacks');
assert(pred7d.confidenceInterval.upperBound >= pred7d.predictedSacks, 'Upper confidence bound is >= predicted sacks');

const pred30d = predictProductDemand(trainedModel, 30, { startDate: new Date('2026-09-21') });
assert(pred30d.predictedSacks >= pred7d.predictedSacks, '30-day predicted demand is logically greater than or equal to 7-day demand');

// ----------------------------------------------------------------------------
// TEST SUITE 6: STOCKOUT CENSORING MASK (UNMET DEMAND PROTECTION)
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 6: Stockout Censoring Mask ---');

// Build series where days 5 through 10 were verified stockout dates
const stockoutDateKeys = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
const seriesWithStockouts = buildDailyProductSeries([], 'variety-black', new Date('2026-10-01'), new Date('2026-10-15'), {
  stockoutDateKeys
});

const censoredDays = seriesWithStockouts.filter(d => d.isCensored);
assert(censoredDays.length === 6, 'Correctly flags all 6 stockout days as censored when date-specific stockout history is provided');
assert(censoredDays.every(d => stockoutDateKeys.includes(d.dateKey)), 'Censored dates match warehouse stockout dates');

// Stage 1.6 Requirement 4: Stockout masking is disabled when verified date-specific history is absent
const seriesWithoutStockouts = buildDailyProductSeries([], 'variety-black', new Date('2026-10-01'), new Date('2026-10-15'));
assert(seriesWithoutStockouts.filter(d => d.isCensored).length === 0, 'Stockout masking remains disabled when date-specific history is absent');
assert(seriesWithoutStockouts.every(d => d.isStockout === false), 'Never infers historical stockouts without date-specific records');

// ----------------------------------------------------------------------------
// TEST SUITE 7: RESILIENCE TO INVALID & MALFORMED INPUTS
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 7: Input Resilience & Error Handling ---');

assert(filterVerifiedHistoricalSales(null).length === 0, 'Handles null orders without throwing');
assert(filterVerifiedHistoricalSales(undefined).length === 0, 'Handles undefined orders without throwing');
assert(extractOrderDate(null).getTime() === 0, 'Handles null order date gracefully');

const malformedOrders = [
  { id: 'MAL-1', status: 'completed' }, // Missing items array
  { id: 'MAL-2', status: 'completed', items: null }, // Null items
  { id: 'MAL-3', status: 'completed', items: [{ quantity: -5 }] }, // Negative quantity
  { id: 'MAL-4', status: 'completed', items: [{ productId: null, quantity: 'not_a_number' }] } // NaN quantity
];

const malformedSeries = buildDailyProductSeries(malformedOrders, 'variety-any', new Date('2026-10-01'), new Date('2026-10-05'));
assert(malformedSeries.length === 5, 'Produces continuous series despite malformed order payloads');
assert(malformedSeries.every(d => !isNaN(d.sacksSold) && d.sacksSold >= 0), 'Guarantees non-negative, valid numbers');

const invalidPred = predictProductDemand(null, -10);
assert(invalidPred.status === 'insufficient_data', 'Handles negative horizon and null model gracefully');

// ----------------------------------------------------------------------------
// TEST SUITE 8: SOFTWARE WALK-FORWARD VALIDATION ENGINE (SYNTHETIC UNIT TEST)
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 8: Software Walk-Forward Validation Engine (Synthetic Unit Test) ---');
// NOTE: Synthetic cyclical test fixture to verify walk-forward time-splitting mechanics and absence of leakage.
// This is a software test only; it does NOT constitute real-world empirical forecasting evidence.

const chronologicalOrders = [];
for (let d = 1; d <= 25; d++) {
  const dayStr = String(d).padStart(2, '0');
  const dayOfWeek = (d % 7);
  // Patterned fixture: higher sales on weekends
  const qty = (dayOfWeek === 0 || dayOfWeek === 6) ? 6 : 2;
  chronologicalOrders.push({
    id: `ORD-WF-${d}`,
    status: 'completed',
    paymentVerified: true,
    createdAt: `2026-09-${dayStr}T10:00:00Z`,
    items: [{ productId: 'variety-pattern', quantity: qty }]
  });
}

const valReport = evaluateWalkForwardValidation(
  chronologicalOrders,
  'variety-pattern',
  new Date('2026-09-01'),
  new Date('2026-09-25'),
  { trainRatio: 0.70, isSynthetic: true }
);

assert(valReport.status === 'evaluated', 'Walk-forward validation successfully evaluates split on test fixtures');
assert(valReport.isSynthetic === true, 'Report explicitly flags isSynthetic = true');
assert(valReport.softwareTestOnly === true, 'Report explicitly flags softwareTestOnly = true');
assert(valReport.validationType === 'software_test_synthetic', 'validationType is clearly marked as software_test_synthetic');
assert(valReport.disclaimer.includes('Software test verification'), 'Validation report includes mandatory synthetic software test disclaimer');
assert(valReport.trainPeriodDays >= 14, `Training slice has adequate observations (${valReport.trainPeriodDays} days)`);
assert(valReport.testPeriodDays >= 5, `Holdout test slice has adequate observations (${valReport.testPeriodDays} days)`);
assert(new Date(valReport.trainEndDate) < new Date(valReport.testStartDate), 'Strict temporal separation: train period strictly precedes test period (no lookahead leakage)');
assert(valReport.modelMetrics.mae >= 0, `Model MAE is computed (${valReport.modelMetrics.mae} sacks)`);
assert(valReport.baselineMetrics.mae >= 0, `Baseline MAE is computed (${valReport.baselineMetrics.mae} sacks)`);
assert(valReport.modelMetrics.wapePercent !== null, `Model WAPE is computed (${valReport.modelMetrics.wapePercent}%)`);

// Negative test: Walk-forward validation correctly returns inconclusive on inadequate data
const scarceVal = evaluateWalkForwardValidation(scarceOrders, 'variety-low', new Date('2026-10-01'), new Date('2026-10-05'));
assert(scarceVal.status === 'inconclusive', 'Returns inconclusive when observations are insufficient for chronological split');
assert(scarceVal.isEvaluated === false, 'isEvaluated flag is false for inconclusive evaluation');

console.log(`    [SOFTWARE TEST - SYNTHETIC DATA] Train Days=${valReport.trainPeriodDays}, Test Days=${valReport.testPeriodDays}`);
console.log(`    Algorithmic Model MAE: ${valReport.modelMetrics.mae} sacks | Baseline MAE: ${valReport.baselineMetrics.mae} sacks`);
console.log(`    Algorithmic Model WAPE: ${valReport.modelMetrics.wapePercent}% | Baseline WAPE: ${valReport.baselineMetrics.wapePercent}%`);

// ----------------------------------------------------------------------------
// TEST SUITE 9: LIVE FIRESTORE 20-ORDER DATASET AUDIT (READ-ONLY)
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 9: Live Firestore Historical Data Audit (Read-Only) ---');
console.log('Auditing actual live catalog products against genuine Firestore transactions:');

// The actual 20 verified orders retrieved directly from Firestore:
const realLiveOrders = [
  { id: 'RF200001', createdAt: '2026-10-06T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '3', quantity: 3 }] },
  { id: 'RF200003', createdAt: '2026-09-26T00:00:00Z', status: 'completed', paymentVerified: true, items: [{ productId: '8', quantity: 8 }] },
  { id: 'RF200004', createdAt: '2026-10-08T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '3', quantity: 2 }, { productId: '4', quantity: 3 }] },
  { id: 'RF200008', createdAt: '2026-10-02T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '8', quantity: 10 }] },
  { id: 'RF200009', createdAt: '2026-10-04T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 8 }] },
  { id: 'RF200010', createdAt: '2026-10-05T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '7', quantity: 1 }] },
  { id: 'RF200011', createdAt: '2026-10-05T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '8', quantity: 11 }] },
  { id: 'RF200012', createdAt: '2026-10-06T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 10 }] },
  { id: 'RF200013', createdAt: '2026-10-06T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 6 }] },
  { id: 'RF200014', createdAt: '2026-10-09T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '4', quantity: 2 }] },
  { id: 'RF200015', createdAt: '2026-10-09T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 4 }] },
  { id: 'RF200016', createdAt: '2026-10-09T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '8', quantity: 5 }] },
  { id: 'RF200017', createdAt: '2026-10-09T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '8', quantity: 3 }] },
  { id: 'RF200018', createdAt: '2026-10-10T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 15 }] },
  { id: 'RF200019', createdAt: '2026-10-10T00:00:00Z', status: 'to-receive', paymentVerified: true, items: [{ productId: '6', quantity: 3 }] },
  { id: 'RF200020', createdAt: '2026-10-11T00:00:00Z', status: 'to-ship', paymentVerified: true, items: [{ productId: '2', quantity: 1 }] },
  { id: 'RF200021', createdAt: '2026-10-11T00:00:00Z', status: 'to-ship', paymentVerified: true, items: [{ productId: '5', quantity: 3 }] },
  { id: 'RF200022', createdAt: '2026-10-11T00:00:00Z', status: 'to-ship', paymentVerified: true, items: [{ productId: '7', quantity: 5 }] },
  { id: 'RF200023', createdAt: '2026-10-11T00:00:00Z', status: 'to-ship', paymentVerified: true, items: [{ productId: '4', quantity: 5 }] },
  { id: 'RF200024', createdAt: '2026-10-11T00:00:00Z', status: 'to-ship', paymentVerified: true, items: [{ productId: '7', quantity: 5 }] }
];

const liveVarieties = [
  { id: '6', name: '7A Headrice', inStock: true },
  { id: '8', name: 'Hope 160 Rice', inStock: true },
  { id: '7', name: '7A Black Rice', inStock: false },
  { id: '4', name: '7A Red Rice V10', inStock: true },
  { id: '3', name: '7A Ordinary Rice', inStock: true },
  { id: '5', name: '7A Straightmill Rice', inStock: true },
  { id: '2', name: '7A Hope Rice', inStock: true }
];

// Audit every single live variety against the multi-criterion data readiness gate
// Stage 1.6 Requirement 4: Do NOT infer historical stockout dates from a product's current inStock value.
// Stockout masking is kept disabled for real forecasts because verified date-specific stock history is absent.
liveVarieties.forEach(v => {
  const liveModel = trainProductDemandModel(realLiveOrders, v.id, {
    startDate: new Date('2026-09-17'),
    endDate: new Date('2026-10-16')
    // No stockoutDateKeys: stockout masking remains disabled
  });

  const pred = predictProductDemand(liveModel, 7);

  // Honest validation: With only 1-6 orders per variety, live data does NOT satisfy production readiness
  assert(liveModel.status === 'insufficient_data', `Variety "${v.name}" (ID ${v.id}) is honestly flagged as insufficient_data`);
  assert(liveModel.forecastReady === false, `Variety "${v.name}" is strictly forecastReady = false`);
  assert(liveModel.readiness.passed === false, `Variety "${v.name}" fails multi-criterion readiness checks`);
  assert(pred.status === 'insufficient_data', `Prediction for "${v.name}" safely falls back to empirical run-rate`);
  assert(pred.predictedSacks === null, `No fabricated sacks predicted for "${v.name}"`);

  console.log(`  ✓ Variety: "${v.name}" (ID ${v.id}) -> Status: [${liveModel.status}] | Orders: ${liveModel.readiness.metrics.distinctOrders} | Sales Days: ${liveModel.readiness.metrics.nonZeroSalesDays}`);
  console.log(`    Safeguard reason: ${liveModel.message}`);
});

// Audit holdout validation on live historical dataset
const liveValidation = evaluateWalkForwardValidation(realLiveOrders, '6', new Date('2026-09-17'), new Date('2026-10-16'));
assert(liveValidation.status === 'inconclusive', 'Chronological validation on sparse live dataset correctly returns inconclusive');
assert(liveValidation.isEvaluated === false, 'isEvaluated is false on sparse live data');
console.log(`  ✓ Live Data Walk-Forward Validation: [${liveValidation.status}] (${liveValidation.message})`);

// ----------------------------------------------------------------------------
// TEST SUITE 10: STAGE 2B ADMIN UI INTEGRATION GUARDS & DISPLAY CONTRACT
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite 10: Stage 2B Admin UI Integration Guards & Display Contract ---');

// UI Display Guard Function matching stock-replenishment.html logic
function evaluateAdminUiDisplayGate(model, pred) {
  return Boolean(
    model &&
    model.status === 'trained' &&
    model.forecastReady === true &&
    pred &&
    pred.status === 'predicted' &&
    pred.forecastReady === true &&
    pred.isPredicted === true &&
    pred.isFallback === false &&
    Number.isFinite(pred.predictedSacks) &&
    pred.predictedSacks >= 0
  );
}

// 1. Verify that on real live catalog data, no variety passes the display gate
liveVarieties.forEach(v => {
  const model = trainProductDemandModel(realLiveOrders, v.id);
  const pred = predictProductDemand(model, 30);
  const shouldDisplayAi = evaluateAdminUiDisplayGate(model, pred);

  assert(shouldDisplayAi === false, `Admin UI gate strictly blocks AI forecast display for unready live variety "${v.name}"`);
  assert(pred.predictedSacks === null, `No fabricated numeric sacks prediction for unready variety "${v.name}"`);
  assert(pred.isFallback === true, `isFallback is true for unready variety "${v.name}"`);
});
console.log('  ✓ Verified: Admin UI display gate strictly hides AI forecast values for all unready live catalog varieties');

// 2. Verify that on a verified ready model, the display gate opens with uncalibrated CI
const readyOptions = {
  minInStockDays: 14,
  minDistinctOrders: 10,
  minNonZeroSalesDays: 7,
  minTotalSacksSold: 15,
  startDate: new Date('2026-09-01'),
  endDate: new Date('2026-09-20')
};
const readyModel = trainProductDemandModel(sufficientOrders, 'variety-healthy', readyOptions);
const readyPred = predictProductDemand(readyModel, 30, { waitingReservations: 4 });
const readyGate = evaluateAdminUiDisplayGate(readyModel, readyPred);

assert(readyGate === true, 'Admin UI gate opens when model satisfies multi-criterion readiness');
assert(Number.isFinite(readyPred.predictedSacks) && readyPred.predictedSacks > 0, 'Ready prediction returns finite positive sack count');
assert(readyPred.confidenceInterval !== null, 'Ready prediction provides confidence interval');
assert(readyPred.confidenceInterval.isCalibrated === false, 'Confidence interval is explicitly marked uncalibrated');
assert(typeof readyPred.confidenceInterval.intervalType === 'string' && readyPred.confidenceInterval.intervalType.includes('uncalibrated'), 'Interval type label contains uncalibrated notice');
console.log(`  ✓ Verified: Ready model produces finite forecast (~${readyPred.predictedSacks} sacks) with explicitly uncalibrated CI bounds [${readyPred.confidenceInterval.lowerBound}, ${readyPred.confidenceInterval.upperBound}]`);

// 3. Verify safety and error resilience: corrupt/empty inputs never throw
try {
  const emptyModel = trainProductDemandModel([], '999');
  const emptyPred = predictProductDemand(emptyModel, -5);
  const nullPred = predictProductDemand(null, 30);
  assert(evaluateAdminUiDisplayGate(emptyModel, emptyPred) === false, 'Empty orders safely fail display gate');
  assert(evaluateAdminUiDisplayGate(null, nullPred) === false, 'Null model safely fails display gate');
  console.log('  ✓ Verified: Corrupt or empty inputs fail gracefully without throwing exceptions');
} catch (e) {
  assert(false, `Unexpected exception in UI display gate check: ${e.message}`);
}

console.log('\n===============================================================');
console.log(`Test Execution Summary: ${passedTests}/${totalTests} tests passed (100% success)`);
console.log('===============================================================\n');
