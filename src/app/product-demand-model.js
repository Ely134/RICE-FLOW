/**
 * RiceFlow — Isolated AI Product Demand Prediction Engine
 * Capstone: "An Intelligent Rice Ordering and FIFO Queue Management System
 * with AI-Based Stock Availability and Service Time Prediction"
 *
 * STAGE 1: ISOLATED PRODUCT-DEMAND PREDICTION MODULE
 *
 * This module implements a mathematically grounded, supervised learning engine
 * specifically for product-level sack demand forecasting:
 * - Method: L2-Regularized Poisson Regression (Generalized Linear Model with Log-Link)
 * - Objective: Minimized Negative Log-Likelihood + Ridge L2 Penalty via Damped Newton-Raphson
 * - Feature Extraction: Supported historical observations (day-of-week, rolling momentum, queue pressure)
 * - Stockout Censoring Mask: Prevents stockout days from falsely suppressing customer demand
 * - Data Readiness Gate: Enforces minimum historical observation thresholds before marking models as trained
 * - Walk-Forward Chronological Validation: Evaluates out-of-sample MAE/WAPE vs 30-day baseline without lookahead leakage
 *
 * STRICT SAFETY BOUNDARY:
 * - Advisory only. Does NOT mutate inventory, database records, order flows, or FIFO allocations.
 * - Completely isolated from live checkout and admin dashboard views in Stage 1.
 */

import { invertMatrix } from './prediction-engine.js';

export const DEMAND_FEATURE_NAMES = [
  'Bias / Base Demand Intercept',
  'Day of Week Index (Normalized 0-1)',
  'Weekend Indicator (1 = Sat/Sun, 0 = Weekday)',
  'Trailing 7-Day In-Stock Sales Momentum',
  'Reservation Queue Pressure (Waiting Sacks)'
];

/**
 * Provisional minimum readiness thresholds for product-level demand model.
 * NOTE: Meeting these thresholds is a provisional software safeguard to prevent
 * fitting models on empty or single-event historical records; meeting these thresholds
 * is NOT mathematical or empirical proof of real-world forecast accuracy.
 */
export const DEFAULT_DEMAND_READINESS_THRESHOLDS = {
  minInStockDays: 14,          // Minimum usable in-stock calendar days in observation window
  minDistinctOrders: 10,       // Minimum distinct verified retail sales orders for this variety (exceeds 5 parameters)
  minNonZeroSalesDays: 7,      // Minimum days with observed sales > 0 sacks (exceeds 5 GLM feature parameters)
  minTotalSacksSold: 15        // Minimum total volume sold across observation window
};

export const MIN_OBSERVATIONS_FOR_DEMAND_ML = DEFAULT_DEMAND_READINESS_THRESHOLDS.minInStockDays;

/**
 * Filter verified customer sales orders strictly within historical dates.
 * Excludes cancelled, rejected, replacement, and unverified payment records.
 * Excludes pre-orders from retail sales velocity so queue waiting sacks do not distort past retail purchases.
 * 
 * @param {Array<Object>} orders - Raw orders from database
 * @returns {Array<Object>} Clean verified sales transactions
 */
export function filterVerifiedHistoricalSales(orders = []) {
  if (!Array.isArray(orders)) return [];

  return orders.filter(o => {
    if (!o || o.isReplacement) return false;

    // Exclude cancelled, rejected, or expired orders
    const statusClean = String(o.status || '').toLowerCase().replace(/_/g, '-').trim();
    if (['cancelled', 'rejected', 'expired'].includes(statusClean) || o.paymentRejected === true) {
      return false;
    }

    // Exclude pre-orders / reservations from past retail sales velocity
    const idStr = String(o.id || '').toUpperCase().replace(/^#/, '');
    if (idStr.startsWith('RES') || o.isPreOrder === true || o.orderType === 'reservation' || statusClean.includes('pre-order')) {
      return false;
    }
    if (Array.isArray(o.items) && o.items.some(i => i && i.isReservation === true)) {
      return false;
    }

    // Verified payment check
    const isVerifiedStatus = [
      'processing', 'to-ship', 'preparing', 'to-receive',
      'shipped', 'in-transit', 'delivered', 'completed', 'fulfilled',
      'ready_for_processing', 'ready-for-processing'
    ].includes(statusClean);

    const isVerifiedFlag = o.paymentVerified === true || o.isVerifiedPayment === true || o.paymentStatus === 'verified' || o.paymentStatus === 'paid';

    return isVerifiedStatus || isVerifiedFlag;
  });
}

/**
 * Parses timestamp string or Firestore date object into a clean standard Date object.
 * Checks milestone dates chronologically.
 * 
 * @param {Object} order - Order object
 * @returns {Date} Parsed Date
 */
export function extractOrderDate(order) {
  if (!order) return new Date(0);

  function parseRaw(val) {
    if (!val) return null;
    if (val instanceof Date) return !isNaN(val.getTime()) ? val : null;
    if (typeof val === 'object') {
      if (typeof val.toDate === 'function') {
        const d = val.toDate();
        return (d instanceof Date && !isNaN(d.getTime())) ? d : null;
      }
      if (typeof val.seconds === 'number') {
        const d = new Date(val.seconds * 1000);
        return !isNaN(d.getTime()) ? d : null;
      }
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
      if (dateOnlyMatch) {
        const yr = parseInt(dateOnlyMatch[1], 10);
        const mo = parseInt(dateOnlyMatch[2], 10) - 1;
        const da = parseInt(dateOnlyMatch[3], 10);
        const localDate = new Date(yr, mo, da, 0, 0, 0, 0);
        if (!isNaN(localDate.getTime())) return localDate;
      }
      const d = new Date(trimmed);
      return !isNaN(d.getTime()) ? d : null;
    }
    return null;
  }

  const candidates = [
    order.completedAt, order.completionDate, order.deliveredAt,
    order.createdAt, order.dateCreated, order.createdDate,
    order.date, order.timestamp
  ];

  for (let i = 0; i < candidates.length; i++) {
    const p = parseRaw(candidates[i]);
    if (p) return p;
  }

  return new Date(0);
}

/**
 * Format date as YYYY-MM-DD
 */
export function toISODateKey(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '1970-01-01';
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

/**
 * Builds daily continuous calendar time-series for a target rice product.
 * Identifies days when the product was in-stock vs out-of-stock (stockout censoring).
 * 
 * @param {Array<Object>} orders - Verified historical sales orders
 * @param {string|number} targetProductId - Target rice variety ID
 * @param {Date} startDate - Start of historical observation window
 * @param {Date} endDate - End of historical observation window
 * @param {Object} [options] - Optional inventory history or stockout indicators
 * @returns {Array<Object>} Daily observation records
 */
export function buildDailyProductSeries(orders, targetProductId, startDate, endDate, options = {}) {
  const cleanOrders = filterVerifiedHistoricalSales(orders);
  const targetIdStr = String(targetProductId).trim();

  // Stage 1.6 Requirement 4: Stockout masking is strictly disabled unless verified
  // date-specific stock history is explicitly provided. Never infer historical stockouts
  // from a product's current inStock boolean.
  const verifiedStockoutDates = Array.isArray(options.verifiedStockoutDates)
    ? options.verifiedStockoutDates
    : (Array.isArray(options.stockoutDateKeys) ? options.stockoutDateKeys : []);
  const stockoutDatesSet = new Set(verifiedStockoutDates);

  // 1. Accumulate verified sacks sold per calendar day
  const dailySacksMap = {};
  cleanOrders.forEach(order => {
    const oDate = extractOrderDate(order);
    if (oDate < startDate || oDate > endDate) return;

    const dateKey = toISODateKey(oDate);
    (order.items || []).forEach(item => {
      if (!item || item.isReservation) return;
      const rawId = item.product?.id ?? item.productId ?? item.id ?? '';
      if (String(rawId).trim() === targetIdStr) {
        const qty = Number(item.quantity || 0);
        if (qty > 0) {
          dailySacksMap[dateKey] = (dailySacksMap[dateKey] || 0) + qty;
        }
      }
    });
  });

  // 2. Build continuous daily sequence between startDate and endDate
  const series = [];
  const curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 12, 0, 0);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 12, 0, 0);

  while (curr.getTime() <= end.getTime()) {
    const dateKey = toISODateKey(curr);
    const dayOfWeek = curr.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0;
    const isStockout = stockoutDatesSet.has(dateKey);
    const sacksSold = dailySacksMap[dateKey] || 0;

    series.push({
      dateKey,
      date: new Date(curr),
      dayOfWeek,
      isWeekend,
      sacksSold,
      isStockout,
      // When a product is in a verified stockout, demand is unobservable (censored)
      isCensored: isStockout && sacksSold === 0
    });

    curr.setDate(curr.getDate() + 1);
  }

  // 3. Compute 7-day trailing momentum feature on in-stock observations
  for (let i = 0; i < series.length; i++) {
    let windowSum = 0;
    let windowCount = 0;
    for (let back = 1; back <= 7; back++) {
      const prevIdx = i - back;
      if (prevIdx >= 0) {
        if (!series[prevIdx].isCensored) {
          windowSum += series[prevIdx].sacksSold;
          windowCount++;
        }
      }
    }
    series[i].trailing7dMean = windowCount > 0 ? (windowSum / windowCount) : 0;
  }

  return series;
}

/**
 * Extracts normalized feature vector for a daily observation record.
 * Features:
 * x0 = Bias term (1.0)
 * x1 = Normalized Day of Week (0.0 to 1.0)
 * x2 = Weekend Indicator (1 = Weekend, 0 = Weekday)
 * x3 = Trailing 7-day sales momentum
 * x4 = Waiting reservation queue pressure
 * 
 * @param {Object} dailyRecord - Daily observation
 * @param {number} [waitingReservations=0] - Active unallocated queue sacks
 * @returns {number[]} Feature vector
 */
export function extractDemandFeatures(dailyRecord, waitingReservations = 0) {
  if (!dailyRecord) return [1, 0.5, 0, 0, 0];

  const x0_bias = 1;
  const x1_dow = Number(dailyRecord.dayOfWeek || 0) / 6;
  const x2_weekend = dailyRecord.isWeekend ? 1 : 0;
  const x3_momentum = Number(dailyRecord.trailing7dMean || 0);
  const x4_queue = Math.min(20, Math.max(0, Number(waitingReservations || 0))) / 10; // Scaled to reasonable range

  return [x0_bias, x1_dow, x2_weekend, x3_momentum, x4_queue];
}

/**
 * Fits an L2-Regularized Poisson Regression Model via Damped Newton-Raphson.
 * 
 * Target formulation:
 * ln(lambda_i) = w^T * x_i  =>  lambda_i = exp(w^T * x_i)
 * 
 * Negative Log-Likelihood objective with L2 ridge penalty:
 * L(w) = sum( exp(w^T * x_i) - y_i * (w^T * x_i) ) + 0.5 * lambda_reg * sum(w_j^2) [j > 0]
 * 
 * Gradient:
 * g(w) = sum( (exp(w^T * x_i) - y_i) * x_i ) + lambda_reg * [0, w1, ..., wP]^T
 * 
 * Hessian:
 * H(w) = sum( exp(w^T * x_i) * x_i * x_i^T ) + lambda_reg * I_{no_bias}
 * 
 * @param {Array<{x: number[], y: number}>} dataset - Clean training examples
 * @param {Object} [options] - Tuning parameters
 * @returns {Object} Solved weights, convergence details, and goodness of fit
 */
export function fitRegularizedPoissonRegression(dataset, options = {}) {
  const lambdaReg = typeof options.lambdaReg === 'number' ? options.lambdaReg : 1.0;
  const maxIterations = typeof options.maxIterations === 'number' ? options.maxIterations : 30;
  const tolerance = typeof options.tolerance === 'number' ? options.tolerance : 1e-6;

  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw new Error('Poisson regression error: training dataset is empty.');
  }

  const N = dataset.length;
  const P = dataset[0].x.length;

  // Initialize weights: bias = ln(mean(y) + 0.1), slopes = 0
  const yMean = dataset.reduce((s, d) => s + d.y, 0) / N;
  const w = Array(P).fill(0);
  w[0] = Math.log(Math.max(0.05, yMean));

  /**
   * Evaluates Negative Log-Likelihood objective function
   */
  function evaluateLoss(weights) {
    let loss = 0;
    for (let i = 0; i < N; i++) {
      const eta = weights.reduce((s, val, idx) => s + val * dataset[i].x[idx], 0);
      const clampedEta = Math.min(15, Math.max(-15, eta)); // Protect against overflow/underflow
      const mu = Math.exp(clampedEta);
      loss += mu - dataset[i].y * clampedEta;
    }
    // L2 regularization on non-intercept weights
    for (let j = 1; j < P; j++) {
      loss += 0.5 * lambdaReg * (weights[j] ** 2);
    }
    return loss;
  }

  let currentLoss = evaluateLoss(w);
  let converged = false;
  let iterationsRun = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun++;

    // 1. Compute Gradient and Hessian
    const grad = Array(P).fill(0);
    const H = Array.from({ length: P }, () => Array(P).fill(0));

    for (let i = 0; i < N; i++) {
      const xi = dataset[i].x;
      const yi = dataset[i].y;
      const eta = w.reduce((s, val, idx) => s + val * xi[idx], 0);
      const clampedEta = Math.min(15, Math.max(-15, eta));
      const mu = Math.exp(clampedEta);
      const diff = mu - yi;

      for (let j = 0; j < P; j++) {
        grad[j] += diff * xi[j];
        for (let k = 0; k < P; k++) {
          H[j][k] += mu * xi[j] * xi[k];
        }
      }
    }

    // Apply L2 regularization penalty to gradient & Hessian (skip bias at index 0)
    for (let j = 1; j < P; j++) {
      grad[j] += lambdaReg * w[j];
      H[j][j] += lambdaReg;
    }

    // Add small diagonal ridge buffer to protect against near-singular Hessian
    for (let j = 0; j < P; j++) {
      H[j][j] += 1e-5;
    }

    // 2. Solve Newton Step: delta = -H^{-1} * grad
    let delta = Array(P).fill(0);
    try {
      const invH = invertMatrix(H);
      for (let j = 0; j < P; j++) {
        let sum = 0;
        for (let k = 0; k < P; k++) {
          sum += invH[j][k] * grad[k];
        }
        delta[j] = -sum;
      }
    } catch {
      // Numerical fallback to gradient step if Hessian inversion fails
      for (let j = 0; j < P; j++) {
        delta[j] = -0.01 * grad[j];
      }
    }

    // 3. Backtracking Line Search (Armijo condition)
    let stepSize = 1.0;
    let newLoss = currentLoss;
    let candidateW = [...w];

    for (let stepIter = 0; stepIter < 8; stepIter++) {
      candidateW = w.map((val, idx) => val + stepSize * delta[idx]);
      newLoss = evaluateLoss(candidateW);
      if (newLoss < currentLoss || Math.abs(newLoss - currentLoss) < 1e-8) {
        break;
      }
      stepSize *= 0.5;
    }

    const stepNorm = Math.sqrt(delta.reduce((s, v) => s + (stepSize * v) ** 2, 0));
    w.splice(0, P, ...candidateW);

    if (Math.abs(currentLoss - newLoss) < tolerance || stepNorm < tolerance) {
      converged = true;
      currentLoss = newLoss;
      break;
    }

    currentLoss = newLoss;
  }

  // 4. Goodness of Fit: Deviance and Pearson Chi-Square
  let deviance = 0;
  let pearsonChi2 = 0;
  const predictions = [];

  for (let i = 0; i < N; i++) {
    const eta = w.reduce((s, val, idx) => s + val * dataset[i].x[idx], 0);
    const mu = Math.exp(Math.min(15, Math.max(-15, eta)));
    predictions.push(mu);

    const yi = dataset[i].y;
    if (yi > 0) {
      deviance += 2 * (yi * Math.log(yi / mu) - (yi - mu));
    } else {
      deviance += 2 * mu;
    }
    pearsonChi2 += ((yi - mu) ** 2) / Math.max(0.01, mu);
  }

  return {
    weights: w.map(val => Math.round(val * 10000) / 10000),
    converged,
    iterationsRun,
    finalLoss: Math.round(currentLoss * 100) / 100,
    deviance: Math.round(deviance * 100) / 100,
    pearsonChi2: Math.round(pearsonChi2 * 100) / 100,
    sampleCount: N,
    featureCount: P,
    trainingYMean: Math.round(yMean * 1000) / 1000
  };
}

/**
 * Assesses data readiness for supervised product-demand machine learning.
 * Evaluates usable in-stock days, distinct verified retail sales orders, non-zero sales days,
 * and total sales volume.
 * 
 * NOTE: Meeting these thresholds is a provisional software safeguard to prevent
 * training models on empty, sparse, or single-transaction records; meeting these thresholds
 * is NOT mathematical or empirical proof of real-world forecast accuracy.
 *
 * @param {Array<Object>} orders - Raw orders from database
 * @param {string|number} productId - Target rice variety identifier
 * @param {Array<Object>} dailySeries - Full daily sequence
 * @param {Date} startDate - Window start date
 * @param {Date} endDate - Window end date
 * @param {Object} [options] - Configurable threshold overrides
 * @returns {Object} Structured readiness assessment
 */
export function assessDemandDataReadiness(orders, productId, dailySeries, startDate, endDate, options = {}) {
  const minInStockDays = typeof options.minInStockDays === 'number'
    ? options.minInStockDays
    : (typeof options.minObservations === 'number' ? options.minObservations : DEFAULT_DEMAND_READINESS_THRESHOLDS.minInStockDays);

  const minDistinctOrders = typeof options.minDistinctOrders === 'number'
    ? options.minDistinctOrders
    : DEFAULT_DEMAND_READINESS_THRESHOLDS.minDistinctOrders;

  const minNonZeroSalesDays = typeof options.minNonZeroSalesDays === 'number'
    ? options.minNonZeroSalesDays
    : DEFAULT_DEMAND_READINESS_THRESHOLDS.minNonZeroSalesDays;

  const minTotalSacksSold = typeof options.minTotalSacksSold === 'number'
    ? options.minTotalSacksSold
    : DEFAULT_DEMAND_READINESS_THRESHOLDS.minTotalSacksSold;

  const targetIdStr = String(productId).trim();
  const cleanOrders = filterVerifiedHistoricalSales(orders);

  // Count distinct orders containing target product within the observation window
  const distinctOrderIds = new Set();
  let windowOrdersCount = 0;

  cleanOrders.forEach((order, idx) => {
    const oDate = extractOrderDate(order);
    if (oDate < startDate || oDate > endDate) return;

    let hasProduct = false;
    (order.items || []).forEach(item => {
      if (!item || item.isReservation) return;
      const rawId = item.product?.id ?? item.productId ?? item.id ?? '';
      if (String(rawId).trim() === targetIdStr) {
        const qty = Number(item.quantity || 0);
        if (qty > 0) hasProduct = true;
      }
    });

    if (hasProduct) {
      windowOrdersCount++;
      const orderKey = order.id || order.orderId || `order-ref-${idx}`;
      distinctOrderIds.add(orderKey);
    }
  });

  const distinctOrders = distinctOrderIds.size || windowOrdersCount;

  // Filter in-stock observations
  const inStockObservations = dailySeries.filter(d => !d.isCensored);
  const nonZeroSalesDays = inStockObservations.filter(d => Number(d.sacksSold || 0) > 0).length;
  const totalSacksSold = inStockObservations.reduce((s, d) => s + Number(d.sacksSold || 0), 0);

  // Evaluate against readiness thresholds
  const failingReasons = [];

  if (inStockObservations.length < minInStockDays) {
    failingReasons.push(`Usable in-stock calendar days (${inStockObservations.length}/${minInStockDays}) below threshold`);
  }
  if (distinctOrders < minDistinctOrders) {
    failingReasons.push(`Distinct verified sales orders (${distinctOrders}/${minDistinctOrders}) below threshold`);
  }
  if (nonZeroSalesDays < minNonZeroSalesDays) {
    failingReasons.push(`Non-zero sales days (${nonZeroSalesDays}/${minNonZeroSalesDays}) below threshold`);
  }
  if (totalSacksSold < minTotalSacksSold) {
    failingReasons.push(`Total sacks sold (${totalSacksSold}/${minTotalSacksSold}) below threshold`);
  }

  const passed = failingReasons.length === 0;

  return {
    passed,
    metrics: {
      inStockDays: inStockObservations.length,
      distinctOrders,
      nonZeroSalesDays,
      totalSacksSold,
      totalCalendarDays: dailySeries.length,
      censoredStockoutDays: dailySeries.length - inStockObservations.length
    },
    thresholds: {
      minInStockDays,
      minDistinctOrders,
      minNonZeroSalesDays,
      minTotalSacksSold
    },
    failingReasons,
    provisionalNote: 'Readiness evaluation is a provisional safeguard against sparse-data artifacting, not empirical proof of accuracy.'
  };
}

/**
 * Trains the supervised product-demand model for a specific rice variety.
 * Validates data readiness and refuses to claim AI accuracy on inadequate records.
 * 
 * @param {Array<Object>} orders - Verified historical sales orders
 * @param {string|number} productId - Target rice variety identifier
 * @param {Object} [options] - Options (startDate, endDate, minObservations, minDistinctOrders, etc.)
 * @returns {Object} Structured model object or insufficient_data status
 */
export function trainProductDemandModel(orders, productId, options = {}) {
  const now = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const endDate = options.endDate ? new Date(options.endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startDate = options.startDate ? new Date(options.startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);

  // 1. Build continuous daily time-series
  const dailySeries = buildDailyProductSeries(orders, productId, startDate, endDate, options);
  const inStockObservations = dailySeries.filter(d => !d.isCensored);

  // 2. Multi-criterion Data Readiness Gate (Stage 1.6 Requirement 1)
  const readiness = assessDemandDataReadiness(orders, productId, dailySeries, startDate, endDate, options);

  // 3. Gate enforcement: if readiness checks fail, refuse to label as trained
  if (!readiness.passed && !options.allowExperimentalFit) {
    return {
      status: 'insufficient_data',
      isTrained: false,
      forecastReady: false,
      mathematicallyConverged: false,
      productId: String(productId),
      modelType: 'L2-Regularized Poisson Regression (GLM)',
      readiness,
      sampleCount: inStockObservations.length,
      totalCalendarDays: dailySeries.length,
      censoredStockoutDays: dailySeries.length - inStockObservations.length,
      minRequiredObservations: readiness.thresholds.minInStockDays,
      message: `Insufficient historical sales data for product "${productId}": ${readiness.failingReasons.join('; ')}.`,
      advisoryNote: 'Model readiness checks not met. An empirical baseline must be used; do not treat predictions as reliable ML forecasts.'
    };
  }

  // 4. Construct feature matrix X and target vector y
  const waitingRes = Number(options.waitingReservations || 0);
  const dataset = inStockObservations.map(d => ({
    x: extractDemandFeatures(d, waitingRes),
    y: d.sacksSold
  }));

  // 5. Fit model via regularized Poisson Newton-Raphson
  let fitResult;
  try {
    fitResult = fitRegularizedPoissonRegression(dataset, {
      lambdaReg: options.lambdaReg !== undefined ? options.lambdaReg : 1.0,
      maxIterations: options.maxIterations || 30,
      tolerance: options.tolerance || 1e-6
    });
  } catch (err) {
    return {
      status: 'insufficient_data',
      isTrained: false,
      forecastReady: false,
      mathematicallyConverged: false,
      productId: String(productId),
      modelType: 'L2-Regularized Poisson Regression (GLM)',
      readiness,
      sampleCount: inStockObservations.length,
      error: err.message,
      message: `Fitting failed: ${err.message}`
    };
  }

  const isForecastReady = readiness.passed && fitResult.converged;

  return {
    status: isForecastReady ? 'trained' : 'insufficient_data',
    isTrained: isForecastReady,
    forecastReady: isForecastReady,
    mathematicallyConverged: fitResult.converged,
    productId: String(productId),
    modelType: 'L2-Regularized Poisson Regression (GLM)',
    weights: fitResult.weights,
    featureNames: DEMAND_FEATURE_NAMES,
    sampleCount: fitResult.sampleCount,
    totalCalendarDays: dailySeries.length,
    censoredStockoutDays: dailySeries.length - inStockObservations.length,
    readiness,
    converged: fitResult.converged,
    iterationsRun: fitResult.iterationsRun,
    deviance: fitResult.deviance,
    pearsonChi2: fitResult.pearsonChi2,
    trainingDailyMean: fitResult.trainingYMean,
    minRequiredObservations: readiness.thresholds.minInStockDays,
    trainedAt: new Date().toISOString(),
    advisoryNote: isForecastReady
      ? 'Trained supervised Poisson model (advisory only). Provisional readiness criteria met; not proof of real-world accuracy.'
      : 'Mathematically converged under experimental fit, but fails data readiness gate. Not forecast-ready.'
  };
}

/**
 * Generates an advisory product demand forecast for the next H days using a trained model.
 * If model is not trained or in insufficient_data status, returns clear status without pretending to be AI.
 * 
 * @param {Object} model - Trained model object from trainProductDemandModel
 * @param {number} horizonDays - Forecast period (e.g., 7 or 30 days)
 * @param {Object} [context] - Contextual features for forecast period (startDate, waitingReservations)
 * @returns {Object} Structured advisory forecast
 */
export function predictProductDemand(model, horizonDays = 7, context = {}) {
  const horizon = Math.max(1, Math.min(365, parseInt(horizonDays, 10) || 7));

  // Safeguard: Check data readiness & model forecast status
  if (!model || model.status !== 'trained' || !model.forecastReady || !Array.isArray(model.weights)) {
    return {
      status: 'insufficient_data',
      isPredicted: false,
      isFallback: true,
      forecastReady: false,
      horizonDays: horizon,
      predictedSacks: null,
      dailyRateEstimate: null,
      confidenceInterval: null,
      modelType: model?.modelType || 'L2-Regularized Poisson Regression (GLM)',
      advisoryNote: model?.message || 'Model has not satisfied data readiness requirements for machine learning forecasting. Use empirical baseline.'
    };
  }

  const startDate = context.startDate ? new Date(context.startDate) : new Date();
  const waitingRes = Number(context.waitingReservations || 0);
  const trailingMomentum = Number(context.current7dMomentum || model.trainingDailyMean || 0);

  const dailyPredictions = [];
  let cumulativeDemand = 0;

  for (let h = 0; h < horizon; h++) {
    const targetDate = new Date(startDate);
    targetDate.setDate(targetDate.getDate() + h);

    const dayRecord = {
      dayOfWeek: targetDate.getDay(),
      isWeekend: (targetDate.getDay() === 0 || targetDate.getDay() === 6) ? 1 : 0,
      trailing7dMean: trailingMomentum
    };

    const x = extractDemandFeatures(dayRecord, waitingRes);
    const eta = model.weights.reduce((s, wVal, idx) => s + wVal * x[idx], 0);
    const clampedEta = Math.min(10, Math.max(-10, eta));
    const dailyLambda = Math.exp(clampedEta);

    dailyPredictions.push({
      dayIndex: h + 1,
      dateKey: toISODateKey(targetDate),
      predictedDailySacks: Math.round(dailyLambda * 100) / 100
    });

    cumulativeDemand += dailyLambda;
  }

  // Theoretical Poisson dispersion bound
  const stdError = Math.sqrt(Math.max(0.1, cumulativeDemand));
  const roundedSacks = Math.ceil(cumulativeDemand);
  const lowerBound = Math.max(0, Math.floor(cumulativeDemand - 1.96 * stdError));
  const upperBound = Math.ceil(cumulativeDemand + 1.96 * stdError);

  return {
    status: 'predicted',
    isPredicted: true,
    isFallback: false,
    forecastReady: true,
    modelType: model.modelType,
    horizonDays: horizon,
    predictedSacks: roundedSacks,
    expectedContinuousSacks: Math.round(cumulativeDemand * 100) / 100,
    dailyRateEstimate: Math.round((cumulativeDemand / horizon) * 100) / 100,
    confidenceInterval: {
      lowerBound,
      upperBound,
      isCalibrated: false,
      intervalType: 'Theoretical Poisson dispersion bound (uncalibrated)',
      confidenceLevel: '95% Theoretical (Uncalibrated)',
      method: 'Normal approximation to Poisson distribution: sum(lambda) +/- 1.96*sqrt(sum(lambda))',
      limitations: 'Uncalibrated theoretical bound based on Poisson assumption (variance = mean). Does not account for retail batch overdispersion, bulk customer purchases, or parameter covariance uncertainty. Strictly uncalibrated and advisory.'
    },
    sampleCount: model.sampleCount,
    isExperimental: true,
    isAdvisory: true,
    advisoryNote: `Experimental advisory forecast: ${roundedSacks} sacks over ${horizon} days (uncalibrated theoretical 95% bound: ${lowerBound}-${upperBound} sacks). Strictly advisory; do not use for automated inventory allocation.`
  };
}

/**
 * Chronological (Walk-Forward) Out-of-Sample Validation Engine.
 * Tests candidate Poisson Model against the 30-Day Run-Rate Baseline on chronological holdout data.
 * Prevents lookahead leakage by strictly training on past days and evaluating on future days.
 * 
 * @param {Array<Object>} orders - Historical verified orders
 * @param {string|number} productId - Target rice product ID
 * @param {Date} startDate - Start of historical observation period
 * @param {Date} endDate - End of historical observation period
 * @param {Object} [options] - Options (trainRatio, isSynthetic, evaluationMode)
 * @returns {Object} Comprehensive validation report with MAE, RMSE, WAPE & baseline comparison
 */
export function evaluateWalkForwardValidation(orders, productId, startDate, endDate, options = {}) {
  const trainRatio = typeof options.trainRatio === 'number' ? options.trainRatio : 0.70;
  const isSynthetic = Boolean(options.isSynthetic);

  // 1. Build continuous historical daily sequence
  const dailySeries = buildDailyProductSeries(orders, productId, startDate, endDate, options);
  const inStockSeries = dailySeries.filter(d => !d.isCensored);

  if (inStockSeries.length < 10) {
    return {
      status: 'inconclusive',
      isEvaluated: false,
      sampleCount: inStockSeries.length,
      minRequiredForSplit: 10,
      reason: 'insufficient_in_stock_days',
      message: `Inconclusive validation: only ${inStockSeries.length} in-stock daily observations available. Minimum 10 observations required to form train/test split.`
    };
  }

  // 2. Chronological Split (No Shuffling, No Future Leakage)
  const splitIdx = Math.max(7, Math.floor(inStockSeries.length * trainRatio));
  const trainData = inStockSeries.slice(0, splitIdx);
  const testData = inStockSeries.slice(splitIdx);

  if (testData.length < 2) {
    return {
      status: 'inconclusive',
      isEvaluated: false,
      sampleCount: inStockSeries.length,
      trainCount: trainData.length,
      testCount: testData.length,
      reason: 'insufficient_test_days',
      message: 'Inconclusive validation: holdout test set has fewer than 2 observations.'
    };
  }

  // Verify that train data has sufficient non-zero sales activity for meaningful validation
  const minTrainNonZeroDays = typeof options.minTrainNonZeroDays === 'number' ? options.minTrainNonZeroDays : 4;
  const trainTotalSacks = trainData.reduce((s, d) => s + d.sacksSold, 0);
  const trainNonZeroDays = trainData.filter(d => d.sacksSold > 0).length;

  if (trainNonZeroDays < minTrainNonZeroDays) {
    return {
      status: 'inconclusive',
      isEvaluated: false,
      sampleCount: inStockSeries.length,
      trainCount: trainData.length,
      testCount: testData.length,
      trainNonZeroDays,
      minRequiredTrainNonZeroDays: minTrainNonZeroDays,
      reason: 'insufficient_training_sales_days',
      message: `Inconclusive validation: training slice contains only ${trainNonZeroDays} non-zero sales days (minimum ${minTrainNonZeroDays} required for conclusive chronological validation).`
    };
  }

  // 3. Train Model on Training Slice ONLY
  const trainDataset = trainData.map(d => ({
    x: extractDemandFeatures(d, 0),
    y: d.sacksSold
  }));

  let fitResult;
  try {
    fitResult = fitRegularizedPoissonRegression(trainDataset, {
      lambdaReg: options.lambdaReg || 1.0,
      maxIterations: 30
    });
  } catch (err) {
    return {
      status: 'inconclusive',
      isEvaluated: false,
      error: err.message,
      message: `Inconclusive validation: solver failed on training slice: ${err.message}`
    };
  }

  const trainedModel = {
    status: 'trained',
    isTrained: true,
    weights: fitResult.weights,
    modelType: 'L2-Regularized Poisson Regression (GLM)'
  };

  // 4. Compute Run-Rate Baseline on Training Slice ONLY
  const baselineDailyRate = trainData.length > 0 ? (trainTotalSacks / trainData.length) : 0;

  // 5. Predict on Test Set without Lookahead Feature Leakage
  // Anchor feature momentum: In multi-step holdout, test features cannot look ahead into future actual sales
  const anchorMomentum = trainData.length > 0 ? Number(trainData[trainData.length - 1].trailing7dMean || 0) : 0;

  let sumModelAbsErr = 0;
  let sumModelSqErr = 0;
  let sumBaselineAbsErr = 0;
  let sumBaselineSqErr = 0;
  let sumActual = 0;

  const testPredictions = [];

  testData.forEach((testPoint, testIdx) => {
    // Prevent lookahead leakage: for multi-step holdout, use anchorMomentum from train cutoff
    // For one-step-ahead (if requested), use observed sales prior to testIdx
    let pointMomentum = anchorMomentum;
    if (options.evaluationMode === 'one_step_ahead' && testIdx > 0) {
      let lookbackSum = 0;
      let lookbackCount = 0;
      for (let b = 1; b <= 7; b++) {
        const pIdx = testIdx - b;
        if (pIdx >= 0) {
          lookbackSum += testData[pIdx].sacksSold;
          lookbackCount++;
        } else {
          const trIdx = trainData.length + pIdx;
          if (trIdx >= 0) {
            lookbackSum += trainData[trIdx].sacksSold;
            lookbackCount++;
          }
        }
      }
      pointMomentum = lookbackCount > 0 ? (lookbackSum / lookbackCount) : anchorMomentum;
    }

    const testFeaturePoint = {
      ...testPoint,
      trailing7dMean: pointMomentum
    };

    const x = extractDemandFeatures(testFeaturePoint, 0);
    const eta = trainedModel.weights.reduce((s, wVal, idx) => s + wVal * x[idx], 0);
    const modelYHat = Math.exp(Math.min(10, Math.max(-10, eta)));
    const baselineYHat = baselineDailyRate;
    const actual = testPoint.sacksSold;

    sumActual += actual;
    sumModelAbsErr += Math.abs(actual - modelYHat);
    sumModelSqErr += (actual - modelYHat) ** 2;
    sumBaselineAbsErr += Math.abs(actual - baselineYHat);
    sumBaselineSqErr += (actual - baselineYHat) ** 2;

    testPredictions.push({
      dateKey: testPoint.dateKey,
      actual,
      modelPredicted: Math.round(modelYHat * 100) / 100,
      baselinePredicted: Math.round(baselineYHat * 100) / 100
    });
  });

  const K = testData.length;
  const modelMAE = Math.round((sumModelAbsErr / K) * 100) / 100;
  const modelRMSE = Math.round(Math.sqrt(sumModelSqErr / K) * 100) / 100;
  const modelWAPE = sumActual > 0 ? Math.round((sumModelAbsErr / sumActual) * 10000) / 100 : null;

  const baselineMAE = Math.round((sumBaselineAbsErr / K) * 100) / 100;
  const baselineRMSE = Math.round(Math.sqrt(sumBaselineSqErr / K) * 100) / 100;
  const baselineWAPE = sumActual > 0 ? Math.round((sumBaselineAbsErr / sumActual) * 10000) / 100 : null;

  const modelOutperformsBaseline = (modelMAE < baselineMAE) && (modelWAPE !== null && baselineWAPE !== null && modelWAPE < baselineWAPE);

  return {
    status: 'evaluated',
    isEvaluated: true,
    isSynthetic,
    softwareTestOnly: isSynthetic,
    validationType: isSynthetic ? 'software_test_synthetic' : 'chronological_holdout',
    totalInStockDays: inStockSeries.length,
    trainPeriodDays: trainData.length,
    testPeriodDays: testData.length,
    trainStartDate: trainData[0].dateKey,
    trainEndDate: trainData[trainData.length - 1].dateKey,
    testStartDate: testData[0].dateKey,
    testEndDate: testData[testData.length - 1].dateKey,
    actualTotalSacksInTest: sumActual,
    modelMetrics: {
      mae: modelMAE,
      rmse: modelRMSE,
      wapePercent: modelWAPE
    },
    baselineMetrics: {
      mae: baselineMAE,
      rmse: baselineRMSE,
      wapePercent: baselineWAPE,
      baselineType: 'Historical Fixed Run-Rate'
    },
    modelOutperformsBaseline,
    relativeMAEImprovementPercent: baselineMAE > 0 ? Math.round(((baselineMAE - modelMAE) / baselineMAE) * 1000) / 10 : 0,
    testPredictions,
    disclaimer: isSynthetic
      ? 'Software test verification on synthetic data pattern. Verifies algorithm implementation and absence of lookahead leakage; does NOT constitute real-world empirical forecasting evidence.'
      : 'Chronological holdout validation on historical data. Results are provisional and subject to sample size limitations.',
    limitations: `Evaluated on ${K} holdout test days. With small sample sizes, random fluctuations significantly affect percentage metrics.`
  };
}
