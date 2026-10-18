/**
 * RiceFlow Queue-Aware Service-Time ETA (ADDITIVE MODULE)
 * Ridge Regression (L2) on business hours from approvedAt to preparedAt.
 * Features: [ordersAhead (reconstructed from timestamps), totalSacks, isPickup].
 * LOOCV vs historical-mean baseline guard. Pure functions, advisory only.
 */

import { invertMatrix } from './prediction-engine.js';

export const BUSINESS_OPEN_HOUR = 8;
export const BUSINESS_CLOSE_HOUR = 17;
const MIN_SAMPLES = 6;
const RIDGE_LAMBDA = 5;
const MIN_BIZ_HOURS = 0.05;
const MAX_BIZ_HOURS = 120;

const normStatus = s => String(s || '').toLowerCase().replace(/_/g, '-').trim();
const toMs = v => {
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return isNaN(t) ? NaN : t;
};

export function isReservationLike(o) {
  if (!o) return false;
  if (o.isPreOrder || o.isReservation) return true;
  if (normStatus(o.status) === 'pre-order') return true;
  return Array.isArray(o.items) && o.items.some(i => i && i.isReservation);
}

function totalSacks(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  if (items.length) return items.reduce((s, it) => s + (Number(it?.quantity) || 1), 0);
  return Number(o.quantity) || 1;
}

function isPickup(o) {
  return (o.deliveryOption === 'pickup' || o.fulfillmentMethod === 'pickup') ? 1 : 0;
}

export function businessHoursBetween(startMs, endMs) {
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
  let total = 0;
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  for (let guard = 0; guard < 400 && day.getTime() < endMs; guard++) {
    if (day.getDay() !== 0) {
      const open = new Date(day); open.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
      const close = new Date(day); close.setHours(BUSINESS_CLOSE_HOUR, 0, 0, 0);
      const s = Math.max(open.getTime(), startMs);
      const e = Math.min(close.getTime(), endMs);
      if (e > s) total += (e - s) / 3600000;
    }
    day.setDate(day.getDate() + 1);
  }
  return total;
}

export function addBusinessHours(startMs, hours) {
  let remaining = Math.max(0, hours);
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  for (let guard = 0; guard < 400; guard++) {
    if (day.getDay() !== 0) {
      const open = new Date(day); open.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
      const close = new Date(day); close.setHours(BUSINESS_CLOSE_HOUR, 0, 0, 0);
      const s = Math.max(open.getTime(), startMs);
      if (close.getTime() > s) {
        const avail = (close.getTime() - s) / 3600000;
        if (remaining <= avail) return new Date(s + remaining * 3600000);
        remaining -= avail;
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return new Date(startMs);
}

function queueEndMs(p) {
  const prep = toMs(p.preparedAt);
  const canc = toMs(p.cancelledAt || p.cancellationDate);
  const ends = [prep, canc].filter(v => !isNaN(v));
  return ends.length ? Math.min(...ends) : Infinity;
}

export function reconstructOrdersAhead(target, allOrders, tMs) {
  const tCreate = toMs(target.createdAt);
  if (isNaN(tCreate)) return 0;
  let n = 0;
  for (const p of allOrders) {
    if (!p || p === target || (p.id && target.id && p.id === target.id)) continue;
    if (isReservationLike(p)) continue;
    const pCreate = toMs(p.createdAt);
    const pApproved = toMs(p.approvedAt);
    if (isNaN(pCreate) || isNaN(pApproved)) continue;
    if (pCreate >= tCreate) continue;
    if (pApproved > tMs) continue;
    if (queueEndMs(p) <= tMs) continue;
    n++;
  }
  return n;
}

export function currentOrdersAhead(order, allOrders) {
  const tCreate = toMs(order.createdAt);
  if (isNaN(tCreate)) return 0;
  let n = 0;
  for (const p of allOrders) {
    if (!p || (p.id && order.id && p.id === order.id)) continue;
    if (isReservationLike(p)) continue;
    const st = normStatus(p.status);
    if (st !== 'processing' && st !== 'to-ship') continue;
    if (p.preparedAt) continue;
    const pCreate = toMs(p.createdAt);
    if (isNaN(pCreate) || pCreate >= tCreate) continue;
    n++;
  }
  return n;
}

function standardize(rows) {
  const k = rows[0].length;
  const means = [], stds = [];
  for (let f = 0; f < k; f++) {
    const v = rows.map(r => r[f]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    means.push(m); stds.push(sd > 1e-6 ? sd : 1);
  }
  return { means, stds };
}

function fitRidge(rows, y, lambda) {
  const { means, stds } = standardize(rows);
  const X = rows.map(r => [1, ...r.map((v, f) => (v - means[f]) / stds[f])]);
  const d = X[0].length;
  const A = Array.from({ length: d }, () => Array(d).fill(0));
  const b = Array(d).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < d; i++) {
      b[i] += X[r][i] * y[r];
      for (let j = 0; j < d; j++) A[i][j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < d; i++) A[i][i] += lambda;
  let beta;
  try {
    const inv = invertMatrix(A);
    beta = inv.map(row => row.reduce((s, v, j) => s + v * b[j], 0));
  } catch {
    beta = [y.reduce((a, c) => a + c, 0) / y.length, ...Array(d - 1).fill(0)];
  }
  return { beta, means, stds };
}

function predictRidge(model, row) {
  const x = [1, ...row.map((v, f) => (v - model.means[f]) / model.stds[f])];
  return x.reduce((s, v, i) => s + v * model.beta[i], 0);
}

const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};

export function buildTrainingExamples(allOrders) {
  const examples = [];
  const seen = new Set();
  let excluded = 0;
  (Array.isArray(allOrders) ? allOrders : []).forEach(o => {
    if (!o || normStatus(o.status) === 'cancelled' || isReservationLike(o)) return;
    const id = String(o.id || '').trim();
    if (id && seen.has(id)) return;
    const tA = toMs(o.approvedAt), tP = toMs(o.preparedAt);
    if (isNaN(tA) || isNaN(tP) || tP <= tA) return;
    const bh = businessHoursBetween(tA, tP);
    if (bh < MIN_BIZ_HOURS || bh > MAX_BIZ_HOURS) { excluded++; return; }
    if (id) seen.add(id);
    const ahead = reconstructOrdersAhead(o, allOrders, tA);
    examples.push({ id, y: bh, x: [ahead, totalSacks(o), isPickup(o)] });
  });
  return { examples, excluded };
}

export function trainQueueEtaModel(allOrders) {
  const { examples, excluded } = buildTrainingExamples(allOrders);
  const n = examples.length;
  if (n < MIN_SAMPLES) {
    return { status: 'insufficient_data', sampleCount: n, minSamples: MIN_SAMPLES, excluded };
  }
  const ridgeErr = [], baseErr = [];
  for (let i = 0; i < n; i++) {
    const train = examples.filter((_, k) => k !== i);
    const m = fitRidge(train.map(e => e.x), train.map(e => e.y), RIDGE_LAMBDA);
    const pred = Math.max(0.25, predictRidge(m, examples[i].x));
    ridgeErr.push(Math.abs(pred - examples[i].y));
    baseErr.push(Math.abs(train.reduce((s, e) => s + e.y, 0) / train.length - examples[i].y));
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const ridgeMAE = avg(ridgeErr);
  const baselineMAE = avg(baseErr);
  const full = fitRidge(examples.map(e => e.x), examples.map(e => e.y), RIDGE_LAMBDA);
  const beatsBaseline = ridgeMAE < baselineMAE;
  return {
    status: 'trained',
    sampleCount: n,
    excluded,
    lambda: RIDGE_LAMBDA,
    model: full,
    featureNames: ['Orders ahead in FIFO queue', 'Total sacks', 'Pickup (1) / Delivery (0)'],
    ridgeMAE: Math.round(ridgeMAE * 100) / 100,
    baselineMAE: Math.round(baselineMAE * 100) / 100,
    typicalErrorHours: Math.round(median(beatsBaseline ? ridgeErr : baseErr) * 10) / 10,
    beatsBaseline,
    medianHours: median(examples.map(e => e.y)),
    validation: `Leave-One-Out CV (N=${n}) vs. historical-mean baseline`
  };
}

let _cache = { key: null, model: null };
function fingerprint(allOrders) {
  return (Array.isArray(allOrders) ? allOrders : [])
    .filter(o => o && o.approvedAt && o.preparedAt)
    .map(o => `${o.id}|${o.approvedAt}|${o.preparedAt}|${o.createdAt}|${normStatus(o.status)}`)
    .sort().join(';');
}
export function getQueueEtaModel(allOrders) {
  const key = fingerprint(allOrders);
  if (_cache.key === key && _cache.model) return _cache.model;
  const model = trainQueueEtaModel(allOrders);
  _cache = { key, model };
  return model;
}

const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function getQueueEtaForOrder(order, allOrders, now = new Date()) {
  if (!order) return { status: 'not_applicable' };
  const st = normStatus(order.status);
  if (isReservationLike(order)) return { status: 'not_applicable' };
  if (st === 'to-pay' || st === 'payment-verification') {
    return {
      status: 'awaiting_payment',
      message: 'Your preparation estimate starts after your payment is verified.'
    };
  }
  if (st !== 'processing' && st !== 'to-ship') return { status: 'not_applicable' };
  if (order.preparedAt) return { status: 'not_applicable' };

  const ordersAhead = currentOrdersAhead(order, allOrders);
  const trained = getQueueEtaModel(allOrders);
  if (trained.status !== 'trained') {
    return {
      status: 'insufficient_data',
      ordersAhead,
      queuePosition: ordersAhead + 1,
      sampleCount: trained.sampleCount,
      message: `Queue position #${ordersAhead + 1}. Time estimate unavailable until enough completed orders are recorded (${trained.sampleCount}/${trained.minSamples}).`
    };
  }

  const x = [ordersAhead, totalSacks(order), isPickup(order)];
  let hours, method;
  if (trained.beatsBaseline) {
    hours = Math.max(0.5, predictRidge(trained.model, x));
    method = 'Ridge Regression (L2), queue-aware';
  } else {
    hours = Math.max(0.5, trained.medianHours);
    method = 'Historical median (model did not beat baseline)';
  }
  hours = Math.min(hours, MAX_BIZ_HOURS);
  const err = trained.typicalErrorHours || 0;
  const startMs = Math.max(now.getTime(), toMs(order.approvedAt) || 0);
  const readyMid = addBusinessHours(startMs, hours);
  const readyLow = addBusinessHours(startMs, Math.max(0.5, hours - err));
  const readyHigh = addBusinessHours(startMs, hours + err);
  const sameDay = fmtDate(readyLow) === fmtDate(readyHigh);

  return {
    status: 'estimated',
    queuePosition: ordersAhead + 1,
    ordersAhead,
    businessHours: Math.round(hours * 10) / 10,
    readyDate: readyMid,
    displayRange: sameDay ? fmtDate(readyMid) : `${fmtDate(readyLow)} – ${fmtDate(readyHigh)}`,
    method,
    isPreliminary: trained.sampleCount < 20,
    sampleCount: trained.sampleCount,
    ridgeMAE: trained.ridgeMAE,
    baselineMAE: trained.baselineMAE,
    typicalErrorHours: trained.typicalErrorHours,
    beatsBaseline: trained.beatsBaseline,
    validation: trained.validation,
    disclaimer: 'Advisory estimate only. It does not change your place in the queue or guarantee a date.'
  };
}

export function renderQueueEtaCard(order, allOrders) {
  try {
    const r = getQueueEtaForOrder(order, allOrders);
    if (!r || r.status === 'not_applicable') return '';
    const wrap = inner => `
      <div class="mt-4 rounded-2xl border border-blue-200 dark:border-slate-700 bg-blue-50/60 dark:bg-slate-800/70 p-4 text-left" data-queue-eta="1">
        ${inner}
      </div>`;
    if (r.status === 'awaiting_payment') {
      return wrap(`<p class="text-xs font-semibold text-gray-900 dark:text-gray-100">${r.message}</p>`);
    }
    if (r.status === 'insufficient_data') {
      return wrap(`<p class="text-[11px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-300">Queue Position #${r.queuePosition}</p>
        <p class="text-xs text-gray-900 dark:text-gray-100 mt-1">${r.message}</p>`);
    }
    return wrap(`
      <div class="flex items-center justify-between flex-wrap gap-2">
        <span class="text-[11px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-300">AI-Estimated Preparation</span>
        ${r.isPreliminary ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Preliminary</span>' : ''}
      </div>
      <div class="grid grid-cols-2 gap-3 mt-2">
        <div><span class="text-[10px] uppercase font-bold text-gray-700 dark:text-gray-300 block">Queue Position</span>
             <span class="text-sm font-black text-gray-900 dark:text-gray-100">#${r.queuePosition} (${r.ordersAhead} ahead)</span></div>
        <div><span class="text-[10px] uppercase font-bold text-gray-700 dark:text-gray-300 block">Ready around</span>
             <span class="text-sm font-black text-gray-900 dark:text-gray-100">${r.displayRange}</span></div>
      </div>
      <p class="text-[10px] text-gray-700 dark:text-gray-300 mt-2">~${r.businessHours} business hours · typical error ~${r.typicalErrorHours} hrs · based on ${r.sampleCount} completed orders. ${r.disclaimer}</p>`);
  } catch (e) {
    console.warn('[QUEUE-ETA] render skipped:', e);
    return '';
  }
}
