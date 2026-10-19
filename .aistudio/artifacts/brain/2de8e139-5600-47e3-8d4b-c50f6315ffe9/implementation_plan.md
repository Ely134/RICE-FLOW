# RiceFlow AI Innovations: Clarified Minimal Implementation Plan

An academically rigorous, mathematically honest, and minimally invasive plan for RiceFlow's two capstone innovations: **AI-Based Stock Availability Prediction** and **AI-Based Service Time Prediction**, aligned strictly with: *"An Intelligent Rice Ordering and FIFO Queue Management System with AI-Based Stock Availability and Service Time Prediction."*

---

## User Review & Critical Clarifications

> [!IMPORTANT]
> This plan has been updated to provide explicit, verified code-level clarifications on the stock prediction algorithm and the staff preparation workflow:
> 1. **Stock Prediction Algorithm**: The existing prediction engine uses a **Gated Dual-Tier Ridge Regression Architecture** (`trainStockAvailabilityRidgeRegression` + `predictStockAvailabilityML` in `src/app/prediction-engine.js`). This plan **100% preserves this exact algorithm**. It is not replaced with a simpler interval-only method, nor are its matrix math, features, or LOOCV gates modified.
> 2. **Staff Preparation Workflow Limitation**: Detailed inspection of `admin/orders.html` confirms that **no distinct UI action or timestamp exists for the physical start of rice preparation**. The system records financial approval (`approvedAt`), shipment authorization (`preparationAuthorizedAt`), and completion (`preparedAt`). Recording `preparationStartedAt` at payment approval would be factually incorrect. This limitation is formally documented: the model models **Order Fulfillment Turnaround Time**, not isolated physical bagging minutes.

- **Clarification 1 (Exact Stock Prediction Algorithm Preserved)**:
  - `predictStockAvailabilityML()` in `src/app/prediction-engine.js` (lines 925–1220) executes a dual-tier model:
    - **Tier 1 (Supervised Learning)**: Evaluates $L_2$-Regularized Ridge Regression (`trainStockAvailabilityRidgeRegression`, $\lambda = 1.5$) conditioned on 5 placement features (requested sacks, queue depth, delivery option, hour of day, day of week) with Leave-One-Out Cross-Validation (LOOCV).
    - **Tier 2 (Empirical Fallback Gate)**: If the Ridge model has $<10$ validated reservation samples or non-positive $R^2$, it automatically falls back to the median inter-arrival interval across genuine supplier restocks (`medianInterval`).
    - **Tier 3 (Sufficiency Gate)**: If $<2$ genuine supplier restocks exist, it returns `status: 'insufficient_data'` and `displayDate: 'Restock Schedule Pending'`.
  - **Status in Plan**: **PRESERVED IN FULL**. Zero changes to `prediction-engine.js` or `shared.js`.

- **Clarification 2 (Documented Limitation: Absence of Physical Prep Start Action)**:
  - Inspection of `admin/orders.html` reveals the exact order lifecycle buttons:
    1. `btn-det-action-accept` ("Approve Order"): Verifies GCash deposit, moves order to `processing` (or `pre-order`), and records `approvedAt`. (Financial approval only; physical preparation has NOT begun).
    2. `btn-det-action-approve-processing` ("Approve for Shipment"): Moves order from `processing` to `to-ship`, and records `preparationAuthorizedAt`. (Fulfillment authorization; staff has not physically scooped rice).
    3. `btn-det-action-prepare` ("Prepare Shipment") $\to$ `btn-prepare-confirm-commit` ("Confirm Prepared"): Moves order to `to-receive`, and records `preparedAt`. (Preparation completed).
  - **Finding**: The admin interface has **no distinct button or event for staff physically starting manual rice scooping/weighing/bagging**.
  - **Resolution**: We will **NOT** record `preparationStartedAt` at payment approval, as doing so would misrepresent waiting in the queue as physical labor. Instead, this operational reality is documented as an academic limitation: the service-time model predicts **Post-Approval Fulfillment Turnaround Time** (`approvedAt` $\to$ `preparedAt`), which naturally includes queue latency.

- **Clarification 3 (Authoritative Stock Reuse without Double-Deduction)**:
  - `getProducts()` in `src/app/shared.js` already returns:
    - `product.stock`: customer-orderable stock (physical warehouse stock minus active reservation commitments and pending regular orders).
    - `product.currentStock`: physical warehouse inventory.
  - The customer UI in `product-details.html` will directly reuse `product.stock` and `product.currentStock`. It will **never** subtract `stockForecast.reservedQueueSacks` from `product.stock`, avoiding double-subtraction.

- **Clarification 4 (Advisory Framing & No Overpromising)**:
  - Predictions are strictly labeled as **Estimated Fulfillment Windows (Advisory)**.
  - Exact completion times are never promised. Internal statistical metrics ($R^2$, LOOCV MAE) remain in code/admin logs and will not be displayed to retail shoppers.

---

## 1. Overview & Core Concept

RiceFlow's two AI innovations operate through real mathematical routines with strict empirical safeguards:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      RICEFLOW AI CAPSTONE ARCHITECTURE                      │
└─────────────────────────────────────────────────────────────────────────────┘

                  FIRESTORE PERSISTENT STORAGE
     ┌────────────────────────┬─────────────────────────┐
     │  orders collection     │ inventoryHistory col    │
     │  (42 live records)     │ (delivery log records)  │
     └───────────┬────────────┴────────────┬────────────┘
                 │                         │
                 ▼                         ▼
  ┌─────────────────────────────┐  ┌─────────────────────────────┐
  │   SERVICE TURNAROUND MODEL  │  │   STOCK RUNOUT & RESTOCK    │
  │   (src/app/queue-eta.js)    │  │ (prediction-engine.js:925)  │
  ├─────────────────────────────┤  ├─────────────────────────────┤
  │ - Reconstructed queue ahead │  │ - Multi-Tier Ridge + Stats  │
  │ - 8am-5pm Mon-Sat biz hours │  │ - Tier 1: Ridge Regression  │
  │ - Ridge L2 Regression       │  │ - Tier 2: Median interval   │
  │ - LOOCV vs Baseline guard   │  │ - Tier 3: Pending fallback  │
  │ - Target: Fulfillment hours │  │ - Reuses getProducts() stock│
  └──────────────┬──────────────┘  └──────────────┬──────────────┘
                 │                                │
                 ▼                                ▼
  ┌─────────────────────────────┐  ┌─────────────────────────────┐
  │     profile.html UI         │  │  product-details.html UI    │
  │ - Reconstructed queue ahead │  │ - Orderable stock (p.stock) │
  │ - Advisory fulfillment range│  │ - Physical (p.currentStock) │
  │ - Business schedule calendar│  │ - Restock window or Pending │
  └─────────────────────────────┘  └─────────────────────────────┘
```

1. **AI-Based Stock Availability Prediction**:
   - Operates via the existing `predictStockAvailabilityML()` function in `src/app/prediction-engine.js`.
   - Preserves both Tier 1 ($L_2$ Ridge Regression on reservation wait times) and Tier 2 (empirical restock inter-arrival intervals) and Tier 3 (insufficient-data fallback).
   - If genuine deliveries $<2$, displays `Restock Schedule Pending` without fabricating dates.

2. **AI-Based Service Time Prediction**:
   - Operates via the existing `queue-eta.js` additive module.
   - Reconstructs queue depth ahead at placement time without lookahead bias.
   - Computes durations strictly across store operating hours (Monday–Saturday, 8:00 AM – 5:00 PM; Sundays closed).
   - Trains closed-form Ridge Regression ($L_2$, $\lambda = 5$) and benchmarks against historical median turnaround via LOOCV.

---

## 2. Detailed Technical Findings

### Finding 1: Code Verification of Stock Prediction in `prediction-engine.js`
Lines 1071–1133 of `src/app/prediction-engine.js` establish the exact prediction logic:
```javascript
// Step 1: Attempt Ridge model training
stockModel = trainStockAvailabilityRidgeRegression(ordersList);

// Step 2: Validate ML readiness criteria
const isMLValidated = Boolean(
  stockModel &&
  stockModel.status === 'trained' &&
  stockModel.sampleCount >= 10 &&
  typeof stockModel.cvMAE === 'number' &&
  stockModel.cvMAE > 0 && stockModel.cvMAE < 10 &&
  typeof stockModel.r2Score === 'number' && stockModel.r2Score > 0
);

// Step 3: Branch between ML and Empirical Baseline
if (isMLValidated) {
  // Use Ridge regression linear combination with normalized features
  predictedLeadDays = Math.max(0.5, Math.min(14, mlY));
} else {
  // Use median of verified inter-arrival delivery intervals
  predictedLeadDays = medianInterval;
}
```
**Conclusion**: The codebase already contains the Ridge Regression model with automated empirical fallback. This plan preserves this exact code without edits.

### Finding 2: Verification of Staff Order Lifecycle in `admin/orders.html`
Code inspection of `admin/orders.html` establishes the complete sequence of staff actions:
1. `btn-det-action-accept` (line 7996) $\to$ `openAcceptConfirmModal()`:
   - Sets: `order.paymentVerified = true`, `order.status = 'processing'`, `order.approvedAt = now.toISOString()`.
   - **Nature of Action**: Confirms receipt of customer GCash payment. No physical grain preparation has started.
2. `btn-det-action-approve-processing` (line 8013):
   - Sets: `tr.status = 'to-ship'`, `tr.preparationAuthorizedAt = now.toISOString()`.
   - **Nature of Action**: Administrative release authorizing warehouse fulfillment.
3. `btn-det-action-prepare` (line 8045) $\to$ `btn-prepare-confirm-commit` (line 3664):
   - Sets: `order.status = 'to-receive'`, `order.preparedAt = now.toISOString()`.
   - **Nature of Action**: Confirmation that bags are packed, weighed, and staged for dispatch.

**Conclusion**: The interface has **no distinct UI button for the physical start of rice preparation**. Recording `preparationStartedAt` at `approvedAt` or `preparationAuthorizedAt` would falsely inflate measured preparation labor by conflating it with queue wait time. Therefore:
- No timestamps will be recorded at payment approval.
- The service-time model will be honestly documented as predicting **Fulfillment Turnaround Time** (`approvedAt` $\to$ `preparedAt`).

### Finding 3: Authoritative Stock Computation in `shared.js`
Lines 1449–1468 in `src/app/shared.js` demonstrate:
```javascript
const available = Math.max(0, physical - allocatedRes - regularReserved);

return {
  ...p,
  stock: available,           // Customer-orderable stock
  currentStock: physical,     // Physical warehouse stock
  reservedStock: waitingReserved,
  allocatedStock: allocatedRes,
  availableStock: available
};
```
**Conclusion**: `product.stock` already reflects customer-orderable quantities after reservation allocations. In `product-details.html`, displaying `product.stock` directly prevents double-deduction.

---

## 3. Scope of Proposed File Changes

Proposed changes are strictly minimized to display and copy adjustments in existing consumer UI templates. **Zero core algorithms or transaction handlers are modified.**

| Target File | Exact Proposed Modification | Rationale |
| :--- | :--- | :--- |
| `product-details.html` | Verify that the stock display presents `product.stock` as orderable stock and `product.currentStock` as physical warehouse inventory. Retain the existing `predictStockAvailability()` call and its `Restock Schedule Pending` fallback. Ensure no secondary deduction is performed against `product.stock`. | Uses authoritative stock without double-deduction, preserving existing restock prediction output. |
| `profile.html` | Review the existing `renderQueueEtaCard(order, getOrders())` integration to ensure copy clearly states **Estimated Fulfillment Window (Advisory)** based on store business hours (Monday–Saturday 8:00 AM – 5:00 PM, closed Sunday). Ensure raw $R^2$ metrics are not shown as customer certainty badges. | Prevents overpromising and provides honest customer advisory communication. |

**Files Strictly Unchanged**:
- `src/app/prediction-engine.js` (unmodified; preserves Ridge Regression and empirical restock engine)
- `src/app/queue-eta.js` (unmodified; preserves Ridge model and LOOCV guard)
- `src/app/shared.js` (unmodified; preserves `getProducts`, `addOrderAtomic`, and payment verification)
- `admin/orders.html` (unmodified; preserves existing administrative and fulfillment workflows)
- `checkout.html`, `cart.html`, `reservation.html` (unmodified)
- `firestore.rules` (unmodified)

---

## 4. Regression & Verification Protocol

When implementation is approved, the following verification suite will be executed:

1. **Stock Calculation Integrity Check**:
   - Verify that `getProducts()` outputs identical `stock`, `currentStock`, `reservedStock`, and `allocatedStock` values across all varieties.
   - Verify that `product-details.html` displays `product.stock` without secondary subtraction.
2. **Stock Prediction Algorithm Preservation Check**:
   - Verify that `predictStockAvailabilityML()` remains intact and returns the validated result or `Restock Schedule Pending` fallback.
3. **Queue Turnaround Model Integrity Check**:
   - Verify that `queue-eta.js` calculates business hours strictly between 8:00 AM and 5:00 PM (Monday–Saturday) and excludes Sundays.
   - Verify that the LOOCV baseline comparison guard functions correctly.
4. **Order Workflow Non-Regression Check**:
   - Verify that payment approval, order status transitions (`to-pay` $\to$ `processing` $\to$ `to-ship` $\to$ `to-receive`), and Firestore timestamps remain undisturbed.
5. **Codebase Compilation & Linter Verification**:
   - Run `compile_applet` and `lint_applet` to confirm zero syntax errors, broken imports, or build failures.

> [!NOTE]
> All regression checks will be executed and documented post-implementation. No tests will be claimed as passed prior to execution.
