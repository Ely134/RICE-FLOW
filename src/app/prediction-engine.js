/**
 * RiceFlow Prediction Engine
 * Capstone: "An Intelligent Rice Ordering and FIFO Queue Management System
 * with AI-Based Stock Availability and Service Time Prediction"
 *
 * This module provides:
 * 1. Service Time Prediction: Multi-variable Ridge Regression (L2-regularized)
 *    trained on genuine completed order preparation timestamps (createdAt -> preparedAt) with LOOCV.
 * 2. Stock Availability Prediction: Empirical Restock Interval Analysis with FIFO Queue Absorption
 *    (Statistical Baseline Heuristic derived from observed replenishment deliveries; not a trained ML model).
 *
 * Designed to run in-memory without mutating any business records, live databases,
 * or violating protected workflow rules.
 */

// ============================================================================
// 1. LINEAR ALGEBRA UTILITIES (PURE NUMERICAL SOLVER)
// ============================================================================

/**
 * Invert an n x n matrix using Gauss-Jordan elimination with partial pivoting.
 * Throws an error if the matrix is singular.
 * @param {number[][]} M - Square matrix
 * @returns {number[][]} Inverted matrix
 */
export function invertMatrix(M) {
  const n = M.length;
  const A = M.map(row => [...row]);
  const I = Array.from({ length: n }, (_, i) => 
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    let maxVal = Math.abs(A[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxVal) {
        maxVal = Math.abs(A[k][i]);
        maxRow = k;
      }
    }

    if (maxVal < 1e-12) {
      throw new Error(`Matrix inversion error: singular matrix at column ${i}`);
    }

    if (maxRow !== i) {
      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      [I[i], I[maxRow]] = [I[maxRow], I[i]];
    }

    const pivot = A[i][i];
    const invPivot = 1 / pivot;
    for (let j = 0; j < n; j++) {
      A[i][j] *= invPivot;
      I[i][j] *= invPivot;
    }

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = A[k][i];
        for (let j = 0; j < n; j++) {
          A[k][j] -= factor * A[i][j];
          I[k][j] -= factor * I[i][j];
        }
      }
    }
  }

  return I;
}

/**
 * Multiply two matrices A (m x p) and B (p x n) -> (m x n)
 */
export function multiplyMatrices(A, B) {
  const m = A.length;
  const p = A[0].length;
  const n = B[0].length;
  const C = Array.from({ length: m }, () => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < p; k++) {
        sum += A[i][k] * B[k][j];
      }
      C[i][j] = sum;
    }
  }
  return C;
}

// ============================================================================
// 2. SERVICE TIME PREDICTION: RIDGE REGRESSION ENGINE
// ============================================================================

export const SERVICE_TIME_FEATURE_NAMES = [
  'Bias / Intercept (hours)',
  'Total Sacks Ordered',
  'Variety Count (Complexity)',
  'Fulfillment Mode (1 = Pickup, 0 = Delivery)',
  'Hour of Placement (0-23)',
  'Day of Week (0 = Sun, 6 = Sat)'
];

/**
 * Extract clean feature vector from an order record for service time prediction.
 * Features strictly use information available at the time of order placement (NO LEAKAGE).
 * @param {Object} order - Order record
 * @returns {number[]} Raw unnormalized features [totalSacks, varietyCount, isPickup, hour, dow]
 */
export function extractOrderPlacementFeatures(order) {
  if (!order) return [1, 1, 0, 12, 1];
  
  const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [];
  const totalSacks = items.length > 0 
    ? items.reduce((s, it) => s + (Number(it?.quantity) || 1), 0)
    : (Number(order.quantity) || 1);
  
  const varietyCount = items.length > 0 ? items.length : 1;
  const isPickup = (order.deliveryOption === 'pickup' || order.fulfillmentMethod === 'pickup') ? 1 : 0;
  
  const createdDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const validCreated = !isNaN(createdDate.getTime()) ? createdDate : new Date();
  const hour = validCreated.getHours();
  const dow = validCreated.getDay();

  return [totalSacks, varietyCount, isPickup, hour, dow];
}

/**
 * Train a Multi-Variable Ridge Regression Model on historical orders.
 * Performs Leave-One-Out Cross-Validation (LOOCV) to compute unbiased out-of-sample metrics.
 * 
 * @param {Array<Object>} orders - Historical order records
 * @param {Object} [options] - Configuration parameters
 * @returns {Object} Trained model object with weights, normalization stats, and validation metrics
 */
export function trainServiceTimeRidgeRegression(orders, options = {}) {
  const lambda = typeof options.lambda === 'number' ? options.lambda : 1.5; // L2 penalty
  const minSamplesRequired = 5;

  // 1. Extract valid training examples with non-leaking actual duration
  const rawExamples = [];
  const seenIds = new Set();
  let excludedBatchClicks = 0;
  let excludedHolds = 0;

  if (Array.isArray(orders)) {
    orders.forEach(o => {
      if (!o || o.status === 'cancelled') return;
      if (!o.preparedAt) return;

      const orderId = String(o.id || o.orderId || '').trim();
      if (orderId && seenIds.has(orderId)) return; // Prevent duplicate records

      const tPrep = new Date(o.preparedAt).getTime();
      const rawCreate = o.createdAt || o.date || o.timestamp;
      if (!rawCreate) return;
      const tCreate = new Date(rawCreate).getTime();
      if (isNaN(tPrep) || isNaN(tCreate) || tPrep <= tCreate) return;

      const durationHours = (tPrep - tCreate) / 3600000;

      // Anomaly filtering:
      // < 0.033 hrs (2 minutes) = Batch click / testing / instant admin toggling
      // > 168 hrs (7 days) = Administrative hold / forgotten click / dispute
      if (durationHours < 0.033) {
        excludedBatchClicks++;
        return;
      }
      if (durationHours > 168) {
        excludedHolds++;
        return;
      }

      if (orderId) seenIds.add(orderId);

      rawExamples.push({
        id: orderId || 'order-' + Math.random().toString(36).substr(2, 5),
        y: durationHours,
        x: extractOrderPlacementFeatures(o)
      });
    });
  }

  const totalExcluded = excludedBatchClicks + excludedHolds;

  // Fallback state if insufficient genuine training records
  if (rawExamples.length < minSamplesRequired) {
    return {
      status: 'insufficient_data',
      modelVersion: 'ridge-v1.0-unfitted',
      sampleCount: rawExamples.length,
      excludedAnomalies: totalExcluded,
      excludedBatchClicks,
      excludedHolds,
      minSamplesRequired,
      weights: null,
      means: null,
      stds: null,
      cvMAE: null,
      cvRMSE: null,
      r2Score: null,
      message: `Insufficient valid historical records (${rawExamples.length}/${minSamplesRequired}). Awaiting more completed order preparation milestones.`
    };
  }

  const numFeatures = rawExamples[0].x.length;

  // 2. Perform Leave-One-Out Cross-Validation (LOOCV) to measure generalization error
  const cvPredictions = [];

  for (let testIdx = 0; testIdx < rawExamples.length; testIdx++) {
    const trainData = rawExamples.filter((_, i) => i !== testIdx);
    const testSample = rawExamples[testIdx];

    // Compute normalization statistics on training fold ONLY (prevents data leakage)
    const foldMeans = [];
    const foldStds = [];
    for (let f = 0; f < numFeatures; f++) {
      const vals = trainData.map(d => d.x[f]);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
      const std = Math.sqrt(v);
      foldMeans.push(m);
      foldStds.push(std > 1e-6 ? std : 1); // Protect against constant/near-constant features
    }

    // Build design matrix X with bias column (x0 = 1)
    const X_fold = trainData.map(d => [1, ...d.x.map((val, f) => (val - foldMeans[f]) / foldStds[f])]);
    const y_fold = trainData.map(d => d.y);
    const dCols = X_fold[0].length;

    // Compute XtX = X^T * X
    const XtX = Array.from({ length: dCols }, () => Array(dCols).fill(0));
    for (let r = 0; r < X_fold.length; r++) {
      for (let i = 0; i < dCols; i++) {
        for (let j = 0; j < dCols; j++) {
          XtX[i][j] += X_fold[r][i] * X_fold[r][j];
        }
      }
    }

    // Apply L2 penalty (skip bias term at index 0)
    for (let i = 1; i < dCols; i++) {
      XtX[i][i] += lambda;
    }

    // Compute Xty = X^T * y
    const Xty = Array(dCols).fill(0);
    for (let r = 0; r < X_fold.length; r++) {
      for (let i = 0; i < dCols; i++) {
        Xty[i] += X_fold[r][i] * y_fold[r];
      }
    }

    let betaFold;
    try {
      const invXtX = invertMatrix(XtX);
      betaFold = Array(dCols).fill(0);
      for (let i = 0; i < dCols; i++) {
        for (let j = 0; j < dCols; j++) {
          betaFold[i] += invXtX[i][j] * Xty[j];
        }
      }
    } catch {
      // Numerical fallback if matrix is ill-conditioned
      betaFold = [y_fold.reduce((a, b) => a + b, 0) / y_fold.length, ...Array(numFeatures).fill(0)];
    }

    // Predict on held-out test sample
    const testNormX = [1, ...testSample.x.map((val, f) => (val - foldMeans[f]) / foldStds[f])];
    const yHat = testNormX.reduce((sum, val, idx) => sum + val * betaFold[idx], 0);
    cvPredictions.push({
      id: testSample.id,
      actual: testSample.y,
      predicted: Math.max(0.5, yHat) // Clamp negative predictions
    });
  }

  // Calculate CV Metrics
  const cvErrors = cvPredictions.map(p => Math.abs(p.actual - p.predicted));
  const cvMAE = cvErrors.reduce((a, b) => a + b, 0) / cvErrors.length;
  const cvRMSE = Math.sqrt(
    cvPredictions.map(p => (p.actual - p.predicted) ** 2).reduce((a, b) => a + b, 0) / cvPredictions.length
  );

  // 3. Train final model on 100% of available data
  const finalMeans = [];
  const finalStds = [];
  for (let f = 0; f < numFeatures; f++) {
    const vals = rawExamples.map(d => d.x[f]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    const std = Math.sqrt(v);
    finalMeans.push(m);
    finalStds.push(std > 1e-6 ? std : 1);
  }

  const X_full = rawExamples.map(d => [1, ...d.x.map((val, f) => (val - finalMeans[f]) / finalStds[f])]);
  const y_full = rawExamples.map(d => d.y);
  const dCols = X_full[0].length;

  const XtX_full = Array.from({ length: dCols }, () => Array(dCols).fill(0));
  for (let r = 0; r < X_full.length; r++) {
    for (let i = 0; i < dCols; i++) {
      for (let j = 0; j < dCols; j++) {
        XtX_full[i][j] += X_full[r][i] * X_full[r][j];
      }
    }
  }
  for (let i = 1; i < dCols; i++) {
    XtX_full[i][i] += lambda;
  }

  const Xty_full = Array(dCols).fill(0);
  for (let r = 0; r < X_full.length; r++) {
    for (let i = 0; i < dCols; i++) {
      Xty_full[i] += X_full[r][i] * y_full[r];
    }
  }

  let finalBeta;
  try {
    const inv = invertMatrix(XtX_full);
    finalBeta = Array(dCols).fill(0);
    for (let i = 0; i < dCols; i++) {
      for (let j = 0; j < dCols; j++) {
        finalBeta[i] += inv[i][j] * Xty_full[j];
      }
    }
  } catch {
    finalBeta = [y_full.reduce((a, b) => a + b, 0) / y_full.length, ...Array(numFeatures).fill(0)];
  }

  // Calculate training R^2
  const yMean = y_full.reduce((a, b) => a + b, 0) / y_full.length;
  const ssTotal = y_full.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const trainPredictions = X_full.map(row => row.reduce((sum, val, idx) => sum + val * finalBeta[idx], 0));
  const ssRes = y_full.reduce((sum, y, idx) => sum + (y - trainPredictions[idx]) ** 2, 0);
  const r2Score = ssTotal > 0 ? Math.max(0, 1 - (ssRes / ssTotal)) : 0;

  return {
    status: 'trained',
    modelVersion: 'ridge-v1.0-fitted',
    sampleCount: rawExamples.length,
    excludedAnomalies: totalExcluded,
    excludedBatchClicks,
    excludedHolds,
    lambda,
    weights: finalBeta.map(w => Math.round(w * 1000) / 1000),
    means: finalMeans.map(m => Math.round(m * 100) / 100),
    stds: finalStds.map(s => Math.round(s * 100) / 100),
    featureNames: SERVICE_TIME_FEATURE_NAMES,
    cvMAE: Math.round(cvMAE * 100) / 100,
    cvRMSE: Math.round(cvRMSE * 100) / 100,
    r2Score: Math.round(r2Score * 1000) / 1000,
    baselineMeanHours: Math.round(yMean * 10) / 10,
    validationMethod: `Leave-One-Out Cross-Validation (LOOCV, N=${rawExamples.length})`,
    trainedAt: new Date().toISOString()
  };
}

/**
 * Compute a deterministic, privacy-safe fingerprint of training records.
 * Captures all fields that affect eligibility, input features, and duration targets.
 * Sorts records by orderId to ensure array ordering alone does not cause cache inconsistency.
 * Does not include any sensitive customer PII (no names, phones, emails, or addresses).
 * 
 * @param {Array<Object>} orders - Orders dataset
 * @param {number} lambda - Regularization parameter
 * @returns {string} Deterministic cache fingerprint
 */
export function computeServiceTrainingFingerprint(orders, lambda = 1.5) {
  if (!Array.isArray(orders) || orders.length === 0) return `lambda=${lambda}:empty`;

  const signatures = [];
  const seenIds = new Set();

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (!o) continue;

    const orderId = String(o.id || o.orderId || `order_${i}`).trim();
    if (orderId && seenIds.has(orderId)) continue;
    if (orderId) seenIds.add(orderId);

    // Cancelled records affect eligibility
    if (o.status === 'cancelled') {
      signatures.push(`${orderId}:status=cancelled`);
      continue;
    }

    // Only orders with preparedAt and valid creation time can be eligible
    if (!o.preparedAt) continue;
    const tPrep = new Date(o.preparedAt).getTime();
    const rawCreate = o.createdAt || o.date || o.timestamp;
    if (!rawCreate) continue;
    const tCreate = new Date(rawCreate).getTime();
    if (isNaN(tPrep) || isNaN(tCreate) || tPrep <= tCreate) continue;

    const durationHours = (tPrep - tCreate) / 3600000;
    // Anomaly filtering thresholds
    const isAnomaly = durationHours < 0.033 || durationHours > 168;

    // Feature vector values (totalSacks, varietyCount, isPickup, hour, dow)
    const feats = extractOrderPlacementFeatures(o);

    // Deterministic signature: ID, rounded duration (0.001 hr precision), anomaly flag, and placement features
    signatures.push(
      `${orderId}:dur=${Math.round(durationHours * 1000) / 1000}:anom=${isAnomaly ? 1 : 0}:feats=${feats.join(',')}`
    );
  }

  // Sort signatures deterministically so record order alone does not alter cache key
  signatures.sort();

  return `lambda=${lambda}:count=${signatures.length}:${signatures.join(';')}`;
}

// In-memory cache for trained Ridge Regression model to prevent repeated fitting
let cachedServiceRidgeModel = null;
let cachedOrderFingerprint = null;

/**
 * Predict preparation readiness duration for an order using trained Ridge Regression.
 * 
 * @param {Object} orderOrParams - Order object or placement parameters
 * @param {Object} [model] - Optional pre-trained model (trains on fly if omitted)
 * @param {Array<Object>} [historicalOrders] - Orders array to train on if model not cached
 * @returns {Object} Structured prediction result
 */
export function predictServiceReadinessML(orderOrParams, model = null, historicalOrders = []) {
  let activeModel = model;
  if (!activeModel || activeModel.status !== 'trained') {
    const ordersList = Array.isArray(historicalOrders) ? historicalOrders : [];
    const fingerprint = computeServiceTrainingFingerprint(ordersList, 1.5);
    if (cachedServiceRidgeModel && cachedOrderFingerprint === fingerprint && cachedServiceRidgeModel.status === 'trained') {
      activeModel = cachedServiceRidgeModel;
    } else {
      activeModel = trainServiceTimeRidgeRegression(ordersList);
      if (activeModel && activeModel.status === 'trained') {
        cachedServiceRidgeModel = activeModel;
        cachedOrderFingerprint = fingerprint;
      }
    }
  }

  if (!activeModel || activeModel.status !== 'trained') {
    return {
      status: 'fallback',
      modelType: 'Ridge Regression (L2)',
      predictedHours: null,
      displayTime: '1 to 2 business days',
      sampleCount: activeModel?.sampleCount || 0,
      excludedBatchClicks: activeModel?.excludedBatchClicks || 0,
      excludedHolds: activeModel?.excludedHolds || 0,
      isFallback: true,
      reason: activeModel?.message || 'Insufficient training records for service-time regression model.'
    };
  }

  const rawFeatures = extractOrderPlacementFeatures(orderOrParams);
  const normFeatures = [1];
  for (let f = 0; f < rawFeatures.length; f++) {
    const mean = activeModel.means[f] || 0;
    const std = activeModel.stds[f] || 1;
    normFeatures.push((rawFeatures[f] - mean) / std);
  }

  let predictedHours = 0;
  for (let i = 0; i < normFeatures.length; i++) {
    predictedHours += normFeatures[i] * (activeModel.weights[i] || 0);
  }

  // Bounds clamping to sensible operational values (0.5 hours to 168 hours / 7 days)
  predictedHours = Math.max(0.5, Math.min(168, predictedHours));
  const roundedHours = Math.round(predictedHours * 10) / 10;

  // Format display string
  let displayTime = '';
  if (roundedHours < 24) {
    displayTime = `~${Math.round(roundedHours)} hours`;
  } else {
    const days = Math.round(roundedHours / 24);
    displayTime = days === 1 ? '~1 business day' : `~${days} business days`;
  }

  return {
    status: 'predicted',
    modelType: 'Ridge Regression (L2 Regularized)',
    modelVersion: activeModel.modelVersion,
    predictedHours: roundedHours,
    displayTime,
    sampleCount: activeModel.sampleCount,
    excludedBatchClicks: activeModel.excludedBatchClicks,
    excludedHolds: activeModel.excludedHolds,
    cvMAE: activeModel.cvMAE,
    cvRMSE: activeModel.cvRMSE,
    r2Score: activeModel.r2Score,
    isFallback: false,
    confidenceNote: `Trained Ridge Regression model (LOOCV MAE: ${activeModel.cvMAE} hrs cross-validation error, N=${activeModel.sampleCount}).`,
    featureContributions: {
      totalSacks: rawFeatures[0],
      varietyCount: rawFeatures[1],
      isPickup: rawFeatures[2] === 1,
      placementHour: rawFeatures[3],
      dayOfWeek: rawFeatures[4]
    }
  };
}

// ============================================================================
// 3. STOCK AVAILABILITY & RESTOCK PREDICTION: TRAINED RIDGE REGRESSION & FIFO QUEUE ABSORPTION
// ============================================================================

export const STOCK_AVAILABILITY_FEATURE_NAMES = [
  'Bias / Intercept (days)',
  'Requested Sacks',
  'FIFO Reservation Queue Position',
  'Fulfillment Mode (1 = Pickup, 0 = Delivery)',
  'Hour of Placement (0-23)',
  'Day of Week (0 = Sun, 6 = Sat)'
];

/**
 * Identify if an inventory history entry represents an order cancellation stock return
 * rather than a genuine supplier replenishment delivery.
 * @param {Object} h - Inventory history record
 * @returns {boolean} True if entry is an order cancellation return
 */
export function isCancellationReturn(h) {
  if (!h) return false;
  const rem = String(h.remarks || '').toLowerCase();
  const typ = String(h.type || '').toLowerCase();
  return rem.includes('returned/restored from cancelled') || 
         rem.includes('order cancellation') || 
         typ === 'cancellation_return' ||
         typ === 'initial_stock' ||
         typ === 'admin_stock_adjustment' ||
         rem.includes('initial stock') ||
         rem.includes('stock adjustment') ||
         rem.includes('admin adjustment') ||
         rem.includes('physical stock updated') ||
         rem.includes('product editing');
}

/**
 * Identifies if an inventory history entry represents a genuine supplier replenishment delivery.
 * Excludes initial stock, administrative adjustments, and order cancellation returns.
 * Accepts genuine 'restock_delivery', 'manual_stock_addition', and verified legacy supplier delivery records.
 * @param {Object} h - Inventory history record
 * @returns {boolean} True if entry is a genuine supplier delivery
 */
export function isGenuineRestockDelivery(h) {
  if (!h) return false;
  const qty = Number(h.quantityAdded !== undefined ? h.quantityAdded : (h.qty !== undefined ? h.qty : h.quantity)) || 0;
  if (qty <= 0) return false;

  const typ = String(h.type || '').toLowerCase().trim();
  const rem = String(h.remarks || '').toLowerCase().trim();

  // Exclude non-delivery events:
  // 1. Initial stock seeding
  if (typ === 'initial_stock' || rem.includes('initial stock')) return false;
  // 2. Admin stock adjustments / physical inventory corrections / product editing
  if (typ === 'admin_stock_adjustment' || rem.includes('stock adjustment') || rem.includes('admin adjustment') || rem.includes('physical stock updated') || rem.includes('product editing')) return false;
  // 3. Customer order cancellation returns
  if (typ === 'cancellation_return' || rem.includes('returned/restored from cancelled') || rem.includes('order cancellation')) return false;
  // 4. Sales deductions or fulfillment releases
  if (typ === 'order_placed_deduction' || typ === 'fulfillment_release' || rem.includes('order placed') || rem.includes('fulfillment release')) return false;

  // Accept genuine supplier deliveries:
  // - Explicit modern types
  if (typ === 'restock_delivery' || typ === 'manual_stock_addition') return true;
  // - Verified legacy supplier replenishment records
  if (rem.includes('replenishment') || rem.includes('supplier delivery') || rem.includes('harvest delivery') || rem.includes('restock delivery') || rem.includes('manual stock replenishment')) {
    return true;
  }

  return false;
}

/**
 * Extract clean feature vector from a reservation/order for stock availability prediction.
 * Strictly uses information available at order placement (NO DATA LEAKAGE).
 * @param {Object} orderOrParams - Order or placement parameters
 * @returns {number[]} Feature vector [requestedSacks, queuePos, isPickup, hour, dow]
 */
export function extractStockPlacementFeatures(orderOrParams) {
  if (!orderOrParams) return [1, 1, 0, 12, 1];
  const items = Array.isArray(orderOrParams.items) && orderOrParams.items.length > 0 ? orderOrParams.items : [];
  const requestedSacks = items.length > 0
    ? items.reduce((s, it) => s + (Number(it?.quantity) || 1), 0)
    : (Number(orderOrParams.quantity || orderOrParams.sacks) || 1);
  const queuePos = Number(orderOrParams.queuePosition || orderOrParams.queueDepth) || 1;
  const isPickup = (orderOrParams.deliveryOption === 'pickup' || orderOrParams.fulfillmentMethod === 'pickup') ? 1 : 0;
  const createdDate = orderOrParams.createdAt ? new Date(orderOrParams.createdAt) : new Date();
  const validCreated = !isNaN(createdDate.getTime()) ? createdDate : new Date();
  const hour = validCreated.getHours();
  const dow = validCreated.getDay();
  return [requestedSacks, queuePos, isPickup, hour, dow];
}

/**
 * Train a Multi-Variable Ridge Regression Model on historical stock replenishment & reservation fulfillment milestones.
 * Evaluates with Leave-One-Out Cross-Validation (LOOCV) for out-of-sample prediction error.
 * 
 * @param {Array<Object>} orders - Historical order records
 * @param {Object} [options] - Configuration parameters (lambda)
 * @returns {Object} Trained model object with weights, normalization stats, and validation metrics
 */
export function trainStockAvailabilityRidgeRegression(orders, options = {}) {
  const lambda = typeof options.lambda === 'number' ? options.lambda : 1.5;
  const minSamplesRequired = 5;

  const rawExamples = [];
  const seenIds = new Set();
  let excludedAnomalies = 0;

  if (Array.isArray(orders)) {
    orders.forEach(o => {
      if (!o || o.status === 'cancelled') return;
      const isRes = o.isPreOrder || (Array.isArray(o.items) && o.items.some(i => i && i.isReservation));
      if (!isRes) return;

      const orderId = String(o.id || o.orderId || '').trim();
      if (orderId && seenIds.has(orderId)) return;

      const tRestock = o.actualRestockDate
        ? new Date(o.actualRestockDate).getTime()
        : (o.stockAllocatedAt ? new Date(o.stockAllocatedAt).getTime() : NaN);
      const rawCreate = o.createdAt || o.date || o.timestamp;
      if (!rawCreate) return;
      const tCreate = new Date(rawCreate).getTime();
      if (isNaN(tRestock) || isNaN(tCreate) || tRestock <= tCreate) return;

      const waitDays = (tRestock - tCreate) / (1000 * 60 * 60 * 24);
      if (waitDays < 0.05 || waitDays > 30) {
        excludedAnomalies++;
        return;
      }

      if (orderId) seenIds.add(orderId);

      rawExamples.push({
        id: orderId || 'res-' + Math.random().toString(36).substr(2, 5),
        y: waitDays,
        x: extractStockPlacementFeatures(o)
      });
    });
  }

  if (rawExamples.length < minSamplesRequired) {
    return {
      status: 'insufficient_data',
      modelVersion: 'stock-ridge-v1.0-unfitted',
      sampleCount: rawExamples.length,
      excludedAnomalies,
      minSamplesRequired,
      weights: null,
      means: null,
      stds: null,
      cvMAE: null,
      cvRMSE: null,
      r2Score: null,
      message: `Insufficient valid reservation fulfillment milestones (${rawExamples.length}/${minSamplesRequired}). Awaiting more completed restocked reservation fulfillments.`
    };
  }

  const numFeatures = rawExamples[0].x.length;
  const cvPredictions = [];

  // Leave-One-Out Cross-Validation (LOOCV)
  for (let testIdx = 0; testIdx < rawExamples.length; testIdx++) {
    const trainData = rawExamples.filter((_, i) => i !== testIdx);
    const testSample = rawExamples[testIdx];

    const foldMeans = [];
    const foldStds = [];
    for (let f = 0; f < numFeatures; f++) {
      const vals = trainData.map(d => d.x[f]);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
      const std = Math.sqrt(v);
      foldMeans.push(m);
      foldStds.push(std > 1e-6 ? std : 1);
    }

    const X_fold = trainData.map(d => [1, ...d.x.map((val, f) => (val - foldMeans[f]) / foldStds[f])]);
    const y_fold = trainData.map(d => d.y);
    const dCols = X_fold[0].length;

    const XtX = Array.from({ length: dCols }, () => Array(dCols).fill(0));
    for (let r = 0; r < X_fold.length; r++) {
      for (let i = 0; i < dCols; i++) {
        for (let j = 0; j < dCols; j++) {
          XtX[i][j] += X_fold[r][i] * X_fold[r][j];
        }
      }
    }
    for (let i = 1; i < dCols; i++) {
      XtX[i][i] += lambda;
    }

    const Xty = Array(dCols).fill(0);
    for (let r = 0; r < X_fold.length; r++) {
      for (let i = 0; i < dCols; i++) {
        Xty[i] += X_fold[r][i] * y_fold[r];
      }
    }

    let betaFold;
    try {
      const invXtX = invertMatrix(XtX);
      betaFold = Array(dCols).fill(0);
      for (let i = 0; i < dCols; i++) {
        for (let j = 0; j < dCols; j++) {
          betaFold[i] += invXtX[i][j] * Xty[j];
        }
      }
    } catch {
      betaFold = [y_fold.reduce((a, b) => a + b, 0) / y_fold.length, ...Array(numFeatures).fill(0)];
    }

    const testNormX = [1, ...testSample.x.map((val, f) => (val - foldMeans[f]) / foldStds[f])];
    const yHat = testNormX.reduce((sum, val, idx) => sum + val * betaFold[idx], 0);
    cvPredictions.push({
      id: testSample.id,
      actual: testSample.y,
      predicted: Math.max(0.1, yHat)
    });
  }

  const cvErrors = cvPredictions.map(p => Math.abs(p.actual - p.predicted));
  const cvMAE = cvErrors.reduce((a, b) => a + b, 0) / cvErrors.length;
  const cvRMSE = Math.sqrt(
    cvPredictions.map(p => (p.actual - p.predicted) ** 2).reduce((a, b) => a + b, 0) / cvPredictions.length
  );

  // Train final model on full dataset
  const finalMeans = [];
  const finalStds = [];
  for (let f = 0; f < numFeatures; f++) {
    const vals = rawExamples.map(d => d.x[f]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    const std = Math.sqrt(v);
    finalMeans.push(m);
    finalStds.push(std > 1e-6 ? std : 1);
  }

  const X_full = rawExamples.map(d => [1, ...d.x.map((val, f) => (val - finalMeans[f]) / finalStds[f])]);
  const y_full = rawExamples.map(d => d.y);
  const dCols = X_full[0].length;

  const XtX_full = Array.from({ length: dCols }, () => Array(dCols).fill(0));
  for (let r = 0; r < X_full.length; r++) {
    for (let i = 0; i < dCols; i++) {
      for (let j = 0; j < dCols; j++) {
        XtX_full[i][j] += X_full[r][i] * X_full[r][j];
      }
    }
  }
  for (let i = 1; i < dCols; i++) {
    XtX_full[i][i] += lambda;
  }

  const Xty_full = Array(dCols).fill(0);
  for (let r = 0; r < X_full.length; r++) {
    for (let i = 0; i < dCols; i++) {
      Xty_full[i] += X_full[r][i] * y_full[r];
    }
  }

  let finalBeta;
  try {
    const inv = invertMatrix(XtX_full);
    finalBeta = Array(dCols).fill(0);
    for (let i = 0; i < dCols; i++) {
      for (let j = 0; j < dCols; j++) {
        finalBeta[i] += inv[i][j] * Xty_full[j];
      }
    }
  } catch {
    finalBeta = [y_full.reduce((a, b) => a + b, 0) / y_full.length, ...Array(numFeatures).fill(0)];
  }

  const yMean = y_full.reduce((a, b) => a + b, 0) / y_full.length;
  const ssTotal = y_full.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const trainPredictions = X_full.map(row => row.reduce((sum, val, idx) => sum + val * finalBeta[idx], 0));
  const ssRes = y_full.reduce((sum, y, idx) => sum + (y - trainPredictions[idx]) ** 2, 0);
  const r2Score = ssTotal > 0 ? Math.max(0, 1 - (ssRes / ssTotal)) : 0;

  return {
    status: 'trained',
    modelVersion: 'stock-ridge-v1.0-fitted',
    sampleCount: rawExamples.length,
    excludedAnomalies,
    lambda,
    weights: finalBeta.map(w => Math.round(w * 1000) / 1000),
    means: finalMeans.map(m => Math.round(m * 100) / 100),
    stds: finalStds.map(s => Math.round(s * 100) / 100),
    featureNames: STOCK_AVAILABILITY_FEATURE_NAMES,
    cvMAE: Math.round(cvMAE * 100) / 100,
    cvRMSE: Math.round(cvRMSE * 100) / 100,
    r2Score: Math.round(r2Score * 1000) / 1000,
    baselineMeanDays: Math.round(yMean * 10) / 10,
    validationMethod: `Leave-One-Out Cross-Validation (LOOCV, N=${rawExamples.length})`,
    trainedAt: new Date().toISOString()
  };
}

// In-memory cache for trained stock availability Ridge model
let cachedStockRidgeModel = null;
let cachedStockFingerprint = null;

export function computeStockTrainingFingerprint(orders, lambda = 1.5) {
  if (!Array.isArray(orders) || orders.length === 0) return `lambda=${lambda}:empty`;
  const signatures = [];
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (!o) continue;
    const isRes = o.isPreOrder || (Array.isArray(o.items) && o.items.some(it => it && it.isReservation));
    if (!isRes) continue;
    const id = o.id || `res_${i}`;
    const tRestock = o.actualRestockDate || o.stockAllocatedAt || '';
    signatures.push(`${id}:${tRestock}`);
  }
  signatures.sort();
  return `lambda=${lambda}:${signatures.join(';')}`;
}

/**
 * Evaluates whether genuine historical inventory history contains sufficient
 * time-series records to train a machine learning stock prediction model.
 *
 * @param {Array<Object>} inventoryHistory
 * @param {Array<Object>} products
 * @param {Array<Object>} orders
 * @returns {Object} Data sufficiency assessment and evaluation metrics
 */
export function evaluateStockAvailabilityDataSufficiency(inventoryHistory = [], products = [], orders = []) {
  const historyList = Array.isArray(inventoryHistory) ? inventoryHistory : [];
  
  const positiveRestocks = historyList.filter(h => isGenuineRestockDelivery(h));

  const productList = Array.isArray(products) ? products : [];
  const varietyBreakdown = {};

  positiveRestocks.forEach(h => {
    let key = String(h.productId || '').trim();
    if (!key || key === 'undefined' || key === 'null') {
      const hName = String(h.productName || h.name || '').toLowerCase().trim();
      const match = productList.find(p => String(p.name || '').toLowerCase().trim() === hName);
      key = match ? String(match.id) : (hName || 'unknown');
    }
    if (!varietyBreakdown[key]) varietyBreakdown[key] = [];
    varietyBreakdown[key].push(h);
  });

  const minRequiredPerVariety = 15;
  const varietyAssessments = [];

  for (const [vKey, list] of Object.entries(varietyBreakdown)) {
    const intervals = [];
    const sorted = [...list].sort((a, b) => {
      const tA = new Date(a.date || a.timestamp || 0).getTime();
      const tB = new Date(b.date || b.timestamp || 0).getTime();
      return tA - tB;
    });

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].date || sorted[i - 1].timestamp || 0).getTime();
      const curr = new Date(sorted[i].date || sorted[i].timestamp || 0).getTime();
      const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diffDays > 0.05) intervals.push(diffDays);
    }

    const matchedProd = productList.find(p => String(p.id) === String(vKey));
    const varietyName = matchedProd ? matchedProd.name : vKey;

    varietyAssessments.push({
      varietyIdOrName: vKey,
      varietyName,
      restockCount: list.length,
      intervalCount: intervals.length,
      hasSufficientDataForML: intervals.length >= minRequiredPerVariety,
      hasSufficientDataForEmpirical: intervals.length >= 1 && list.length >= 2
    });
  }

  const overallSufficient = varietyAssessments.some(v => v.hasSufficientDataForML);

  return {
    hasSufficientDataForML: overallSufficient,
    totalGenuineRestocks: positiveRestocks.length,
    minRequiredPerVariety,
    varietyAssessments,
    status: overallSufficient ? 'sufficient' : 'insufficient_for_ml',
    recommendedAction: overallSufficient
      ? 'Train time-series/supervised ML model'
      : 'Maintain empirical restock interval analysis with FIFO queue absorption fallback; avoid fabricating training records',
    missingDataSummary: 'Historical data lacks sufficient continuous replenishment cycles (minimum 15-20 deliveries per variety required for cross-validated supervised or time-series ML models).'
  };
}

/**
 * Predict upcoming stock replenishment window using trained Ridge Regression (L2 regularized)
 * and FIFO Queue Demand Absorption.
 * 
 * If historical replenishment milestones are insufficient (< 5), gracefully falls back to
 * the empirical statistical baseline and explicitly reports missing data.
 * 
 * Strictly advisory and read-only: does not allocate stock, modify queue position, or mutate records.
 * 
 * @param {string|number} productIdOrName - Target rice variety identifier
 * @param {Array<Object>} inventoryHistory - Historical inventory records
 * @param {Array<Object>} products - Catalog products
 * @param {Array<Object>} orders - Current orders in FIFO queue
 * @returns {Object} Structured stock prediction result
 */
export function predictStockAvailabilityML(productIdOrName, inventoryHistory = [], products = [], orders = []) {
  const fallbackResult = {
    status: 'insufficient_data',
    displayDate: 'Waiting for Restock',
    predictedDate: null,
    predictedWindowStart: null,
    predictedWindowEnd: null,
    isPreliminary: true,
    observationCount: 0,
    intervalCount: 0,
    averageIntervalDays: null,
    meanIntervalDays: null,
    stdIntervalDays: null,
    method: 'Empirical Restock Interval Analysis with FIFO Queue Absorption',
    modelCategory: 'Empirical Statistical Baseline',
    isStatisticalEstimate: true,
    dataSufficiency: {
      status: 'insufficient_historical_data',
      sampleCount: 0,
      intervalCount: 0,
      minRequiredForML: 5,
      missingData: 'Requires at least 2 genuine restock deliveries to compute an empirical replenishment interval, and >=5 reservation fulfillment milestones to train an ML model.'
    },
    targetVariety: String(productIdOrName || 'Unknown'),
    publicAvailabilityStatus: 'Awaiting Physical Restock Delivery',
    reservedQueueSacks: 0,
    avgBatchSacks: 0,
    confidenceNote: 'Preliminary: Insufficient genuine restock records (<2) recorded for this variety. Awaiting future supplier restock deliveries.',
    disclaimer: 'Statistical projection only. Does not allocate stock, promise delivery dates, or override authoritative FIFO inventory queues.'
  };

  if (!productIdOrName) return fallbackResult;

  const productList = Array.isArray(products) ? products : [];
  const normTarget = String(productIdOrName).toLowerCase().trim();
  const product = productList.find(p => p && String(p.id) === String(productIdOrName)) ||
                  productList.find(p => p && p.name && String(p.name).toLowerCase().trim() === normTarget);

  const pId = product ? String(product.id) : String(productIdOrName || '');
  const pName = product && product.name ? String(product.name) : (typeof productIdOrName === 'string' ? productIdOrName : 'Rice Variety');
  const normPName = pName.toLowerCase().trim();
  fallbackResult.targetVariety = pName;

  // 1. Filter genuine positive restock additions (excluding customer cancellation returns and non-deliveries)
  const historyList = Array.isArray(inventoryHistory) ? inventoryHistory : [];
  const positiveRestocks = historyList
    .filter(h => {
      if (!isGenuineRestockDelivery(h)) return false;

      const hPid = String(h.productId || '').trim();
      const hName = String(h.productName || h.name || '').toLowerCase().trim();

      if (pId && hPid && hPid === pId) return true;
      if (hName && normPName && hName === normPName) return true;
      return false;
    })
    .map(h => {
      const qty = Number(h.quantityAdded !== undefined ? h.quantityAdded : (h.qty !== undefined ? h.qty : h.quantity)) || 0;
      const datePart = h.date || (h.timestamp ? h.timestamp.split('T')[0] : '');
      const timePart = h.time || '00:00';
      const parsed = h.timestamp ? new Date(h.timestamp) : new Date(`${datePart}T${timePart}`);
      return {
        ...h,
        quantity: qty,
        parsedDate: !isNaN(parsed.getTime()) ? parsed : null
      };
    })
    .filter(h => h.parsedDate !== null)
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

  // 2. Evaluate active FIFO reservation queue depth for target variety (advisory and read-only)
  const ordersList = Array.isArray(orders) ? orders : [];
  const pendingReservations = ordersList.filter(o => {
    if (!o || o.status === 'cancelled' || o.status === 'completed' || o.status === 'delivered') return false;
    const isRes = o.isPreOrder || o.status === 'pre-order' || (Array.isArray(o.items) && o.items.some(it => it && it.isReservation));
    if (!isRes) return false;
    return Array.isArray(o.items) && o.items.some(it => {
      const itPid = String(it.productId || it.product?.id || '').trim();
      const itPname = String(it.productName || it.product?.name || '').toLowerCase().trim();
      return (pId && itPid === pId) || (itPname && normPName && itPname === normPName);
    });
  });

  const reservedQueueSacks = pendingReservations.reduce((sum, o) => {
    const item = (o.items || []).find(it => {
      const itPid = String(it.productId || it.product?.id || '').trim();
      const itPname = String(it.productName || it.product?.name || '').toLowerCase().trim();
      return (pId && itPid === pId) || (itPname && normPName && itPname === normPName);
    });
    return sum + (Number(item?.quantity) || 0);
  }, 0);

  // 3. Compute empirical intervals between consecutive replenishment deliveries in chronological order
  const intervalsInDays = [];
  for (let i = 1; i < positiveRestocks.length; i++) {
    const prev = positiveRestocks[i - 1].parsedDate.getTime();
    const curr = positiveRestocks[i].parsedDate.getTime();
    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diffDays > 0.05) {
      intervalsInDays.push(diffDays);
    }
  }

  // Strict Data Sufficiency Gate:
  // Never generate an empirical restock date when there are fewer than two genuine restock events
  // or zero valid inter-arrival intervals. FIFO queue depth must not substitute for missing delivery history.
  // Explicitly return insufficient-data result instead of using hardcoded medians to fabricate a forecast.
  if (positiveRestocks.length < 2 || intervalsInDays.length === 0) {
    fallbackResult.status = 'insufficient_data';
    fallbackResult.displayDate = 'Restock Schedule Pending';
    fallbackResult.predictedDate = null;
    fallbackResult.predictedWindowStart = null;
    fallbackResult.predictedWindowEnd = null;
    fallbackResult.isPreliminary = true;
    fallbackResult.observationCount = positiveRestocks.length;
    fallbackResult.intervalCount = intervalsInDays.length;
    fallbackResult.averageIntervalDays = null;
    fallbackResult.meanIntervalDays = null;
    fallbackResult.stdIntervalDays = null;
    fallbackResult.minIntervalDays = null;
    fallbackResult.maxIntervalDays = null;
    fallbackResult.method = 'Transparent Method Selection: Insufficient Historical Evidence';
    fallbackResult.modelType = 'None (Data Insufficient)';
    fallbackResult.modelCategory = 'None';
    fallbackResult.isStatisticalEstimate = false;
    fallbackResult.dataSufficiency = {
      status: 'insufficient_historical_data',
      sampleCount: positiveRestocks.length,
      intervalCount: intervalsInDays.length,
      minRequiredForEmpirical: 2,
      minRequiredForML: 10,
      missingData: positiveRestocks.length === 1
        ? `Only 1 replenishment delivery logged for ${pName}. Inter-arrival interval calculation requires at least 2 deliveries.`
        : `No genuine replenishment delivery records found for ${pName}. Awaiting supplier restock deliveries.`
    };
    fallbackResult.confidenceNote = positiveRestocks.length === 1
      ? `Preliminary: Only 1 delivery recorded for ${pName}. At least 2 past deliveries are required to compute inter-arrival intervals.`
      : `Preliminary: No delivery records found for ${pName}. Awaiting supplier restock deliveries.`;
    fallbackResult.reservedQueueSacks = reservedQueueSacks;
    fallbackResult.publicAvailabilityStatus = reservedQueueSacks > 0
      ? `Restock schedule pending. ${reservedQueueSacks} sacks currently reserved in active FIFO queue.`
      : 'Awaiting Physical Restock Delivery';
    fallbackResult.disclaimer = 'Estimates are not supplier guarantees. Restock schedules will automatically calculate once sufficient genuine deliveries are recorded.';
    return fallbackResult;
  }

  // 4. Transparent Model Selection:
  // - Validated ML model available: use ML only if an actual trained model exists and passes defined data-quality and validation criteria.
  // - ML unavailable or fails validation: automatically fall back to the empirical statistical forecast.
  let stockModel = null;
  const stockFp = computeStockTrainingFingerprint(ordersList, 1.5);
  if (cachedStockRidgeModel && cachedStockFingerprint === stockFp && cachedStockRidgeModel.status === 'trained') {
    stockModel = cachedStockRidgeModel;
  } else {
    stockModel = trainStockAvailabilityRidgeRegression(ordersList);
    if (stockModel && stockModel.status === 'trained') {
      cachedStockRidgeModel = stockModel;
      cachedStockFingerprint = stockFp;
    }
  }

  const isMLValidated = Boolean(
    stockModel &&
    stockModel.status === 'trained' &&
    stockModel.sampleCount >= 10 &&
    typeof stockModel.cvMAE === 'number' &&
    !isNaN(stockModel.cvMAE) &&
    stockModel.cvMAE > 0 &&
    stockModel.cvMAE < 10 &&
    typeof stockModel.r2Score === 'number' &&
    stockModel.r2Score > 0
  );

  const sortedIntervals = [...intervalsInDays].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
  const minInterval = sortedIntervals[0];
  const maxInterval = sortedIntervals[sortedIntervals.length - 1];
  const sumIntervals = intervalsInDays.reduce((a, b) => a + b, 0);
  const meanInterval = sumIntervals / intervalsInDays.length;
  const varianceInterval = intervalsInDays.reduce((sum, val) => sum + (val - meanInterval) ** 2, 0) / intervalsInDays.length;
  const stdInterval = Math.sqrt(varianceInterval);

  let predictedLeadDays = medianInterval;
  let isTrainedML = false;

  if (isMLValidated) {
    isTrainedML = true;
    const rawFeats = [
      Math.max(1, reservedQueueSacks || 1), // requested sacks / demand
      Math.max(1, pendingReservations.length || 1), // queue depth
      0, // delivery
      new Date().getHours(),
      new Date().getDay()
    ];
    let normX = [1];
    for (let f = 0; f < rawFeats.length; f++) {
      const mean = stockModel.means[f] || 0;
      const std = stockModel.stds[f] || 1;
      normX.push((rawFeats[f] - mean) / std);
    }
    let mlY = 0;
    for (let i = 0; i < normX.length; i++) {
      mlY += normX[i] * (stockModel.weights[i] || 0);
    }
    // Clamping to operational bounds (0.5 to 14 days)
    predictedLeadDays = Math.max(0.5, Math.min(14, mlY));
  }

  const stepDays = Math.max(1, Math.round(predictedLeadDays));

  // 5. Project physical delivery date from the latest actual restock (or today if none)
  const latestRestock = positiveRestocks[positiveRestocks.length - 1].parsedDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let projectedArrival = new Date(latestRestock.getTime() + stepDays * 24 * 60 * 60 * 1000);
  while (projectedArrival < today) {
    projectedArrival = new Date(projectedArrival.getTime() + stepDays * 24 * 60 * 60 * 1000);
  }

  const avgBatchSacks = Math.max(1, Math.round(positiveRestocks.reduce((s, h) => s + h.quantity, 0) / positiveRestocks.length));

  // FIFO Queue Absorption: if queue demand exceeds 1 batch, project subsequent batches
  let batchesNeeded = 1;
  if (avgBatchSacks > 0 && reservedQueueSacks >= avgBatchSacks) {
    batchesNeeded = Math.ceil((reservedQueueSacks + 1) / avgBatchSacks);
    for (let b = 1; b < batchesNeeded; b++) {
      projectedArrival = new Date(projectedArrival.getTime() + stepDays * 24 * 60 * 60 * 1000);
    }
  }

  // Prediction window calculation based on observed interval dispersion
  const windowPaddingDays = Math.max(1, Math.round((maxInterval - minInterval) / 2) || Math.round(stdInterval) || 2);
  const windowStart = new Date(projectedArrival.getTime() - Math.min(windowPaddingDays, 2) * 24 * 60 * 60 * 1000);
  if (windowStart < today) windowStart.setTime(today.getTime());
  const windowEnd = new Date(projectedArrival.getTime() + windowPaddingDays * 24 * 60 * 60 * 1000);

  let publicStatus = 'Projected Available for Public Purchase';
  if (reservedQueueSacks >= avgBatchSacks) {
    publicStatus = `FIFO Queue Absorption: Next ${batchesNeeded} batches (~${avgBatchSacks * batchesNeeded} sacks) allocated to ${reservedQueueSacks} reserved sacks in queue.`;
  } else if (reservedQueueSacks > 0) {
    publicStatus = `Partial Queue Allocation: ${reservedQueueSacks} sacks allocated to queue; surplus (~${Math.max(0, avgBatchSacks - reservedQueueSacks)} sacks) available for checkout.`;
  }

  const formatDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const displayDate = windowStart.getTime() === windowEnd.getTime()
    ? formatDate(projectedArrival)
    : `${formatDate(windowStart)} – ${formatDate(windowEnd)}`;

  const roundedAvgInterval = Math.round(predictedLeadDays * 10) / 10;

  return {
    status: 'predicted',
    displayDate,
    predictedDate: projectedArrival.toISOString().split('T')[0],
    predictedWindowStart: windowStart.toISOString().split('T')[0],
    predictedWindowEnd: windowEnd.toISOString().split('T')[0],
    isPreliminary: true,
    observationCount: positiveRestocks.length,
    intervalCount: intervalsInDays.length,
    averageIntervalDays: roundedAvgInterval,
    meanIntervalDays: Math.round(meanInterval * 10) / 10,
    stdIntervalDays: Math.round(stdInterval * 10) / 10,
    minIntervalDays: Math.round(minInterval * 10) / 10,
    maxIntervalDays: Math.round(maxInterval * 10) / 10,
    method: isTrainedML
      ? 'Ridge Regression (L2) & FIFO Queue Absorption'
      : 'Empirical Restock Interval Analysis with FIFO Queue Absorption',
    modelType: isTrainedML
      ? 'Ridge Regression (L2 Regularized) with FIFO Queue Absorption'
      : 'Empirical Statistical Baseline',
    modelCategory: isTrainedML ? 'Trained Machine Learning Model' : 'Empirical Statistical Baseline',
    isStatisticalEstimate: !isTrainedML,
    sampleCount: isTrainedML ? stockModel.sampleCount : positiveRestocks.length,
    cvMAE: isTrainedML ? stockModel.cvMAE : null,
    cvRMSE: isTrainedML ? stockModel.cvRMSE : null,
    r2Score: isTrainedML ? stockModel.r2Score : null,
    weights: isTrainedML ? stockModel.weights : null,
    dataSufficiency: {
      status: isTrainedML ? 'sufficient_trained_ml' : 'empirical_baseline_sufficient',
      sampleCount: isTrainedML ? stockModel.sampleCount : positiveRestocks.length,
      intervalCount: intervalsInDays.length,
      minRequiredForML: 10,
      missingData: isTrainedML
        ? null
        : `Replenishment milestones for ${pName} are below the threshold for individual SKU ML training. Operating on preliminary empirical restock interval baseline.`
    },
    targetVariety: pName,
    publicAvailabilityStatus: publicStatus,
    reservedQueueSacks,
    avgBatchSacks,
    batchesNeeded,
    confidenceNote: isTrainedML
      ? `Trained Ridge ML model (LOOCV MAE: ${stockModel.cvMAE} days cross-validation error, N=${stockModel.sampleCount} fulfillment milestones) with FIFO queue absorption.`
      : `Preliminary: Empirical statistical estimate derived from ${intervalsInDays.length} observed restock intervals with FIFO queue absorption.`,
    disclaimer: 'Statistical projection only. Estimates are preliminary and not supplier guarantees. Does not allocate stock or override authoritative FIFO inventory queues.'
  };
}
