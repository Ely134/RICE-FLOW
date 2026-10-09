// Firebase Initialization and Firestore Sync for RiceFlow
import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  linkWithCredential,
  PhoneAuthProvider
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  getDoc, 
  getDocFromServer,
  onSnapshot, 
  deleteDoc,
  query,
  where,
  runTransaction
} from 'firebase/firestore';
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  uploadBytesResumable, 
  getDownloadURL, 
  deleteObject, 
  listAll 
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

// Internal safe local storage setter to eliminate circular import from shared.js
export function safeLocalStorageSet(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[FIREBASE-STORAGE] Error saving '${key}' to localStorage:`, e);
  }
}

export const DEFAULT_PRODUCTS = [
  { id: '2', name: '7A Hope Rice', price: 1350, stock: 200, category: 'Rice' },
  { id: '3', name: '7A Ordinary Rice', price: 1250, stock: 150, category: 'Rice' },
  { id: '4', name: '7A Red Rice V10', price: 1400, stock: 80, category: 'Rice' },
  { id: '5', name: '7A Straightmill Rice', price: 1300, stock: 120, category: 'Rice' },
  { id: '6', name: '7A Headrice', price: 1450, stock: 90, category: 'Rice' },
  { id: '7', name: '7A Black Rice', price: 1600, stock: 60, category: 'Rice' },
  { id: '8', name: 'Hope 160 Rice', price: 1500, stock: 100, category: 'Rice' }
];

let app;
let db;
let auth;
let storage;
let firestoreSyncPromise = null;
let ordersHydratedFromFirestore = false;

export function isOrdersHydrated() {
  return ordersHydratedFromFirestore;
}

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const databaseId = firebaseConfig.firestoreDatabaseId;

  try {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    }, databaseId);
  } catch (initErr) {
    // If Firestore was already initialized on this app instance, retrieve it safely
    db = getFirestore(app, databaseId);
  }

  // Initialize Firebase Auth prioritizing browserLocalPersistence (localStorage)
  // to prevent IndexedDB 'Database is closing/hidden' errors when tabs are hidden or blurred
  try {
    auth = initializeAuth(app, {
      persistence: [browserLocalPersistence, browserSessionPersistence, indexedDBLocalPersistence]
    });
  } catch (authInitErr) {
    auth = getAuth(app);
  }

  // Initialize Firebase Storage reusing the existing app instance and storage bucket
  try {
    const bucket = firebaseConfig.storageBucket || 'rice-f0b23.firebasestorage.app';
    storage = getStorage(app, bucket);
    console.log('[FIREBASE] Storage initialized successfully with bucket:', bucket);
  } catch (storageErr) {
    console.warn('[FIREBASE] Failed to initialize Firebase Storage:', storageErr);
  }

  console.log('[FIREBASE] Firestore, Auth, and Storage initialized successfully with database ID:', firebaseConfig.firestoreDatabaseId);
} catch (err) {
  console.error('[FIREBASE] Failed to initialize Firebase:', err);
}

// Validate connection to Firestore per platform specifications non-blockingly in background
function testConnection() {
  if (!db || typeof window === 'undefined') return;
  setTimeout(async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  }, 1000);
}
testConnection();

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { 
  app, 
  db, 
  auth, 
  storage, 
  storageRef, 
  uploadBytes, 
  uploadBytesResumable, 
  getDownloadURL, 
  deleteObject, 
  listAll,
  runTransaction,
  doc,
  getDoc,
  getDocFromServer
};

// Helper to save a document to Firestore
export async function saveFirestoreDoc(colName, docId, data, maxRetries = 2) {
  if (!db || !docId) {
    console.warn(`[FIREBASE] Missing db or docId for ${colName}/${docId}`);
    return false;
  }
  if (isStaleRecord(colName, data, docId)) {
    console.warn(`[SYNC-GUARD] Blocked write of stale document ${colName}/${docId}`);
    return false;
  }
  
  // Sanitize object to avoid undefined fields or custom class instances
  const cleanData = JSON.parse(JSON.stringify(data));
  const docRef = doc(db, colName, String(docId));

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      await setDoc(docRef, cleanData, { merge: true });
      return true;
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        console.warn(`[FIREBASE] Error saving document to ${colName}/${docId} after ${attempt} attempts:`, err);
        throw err;
      }
      // Exponential backoff wait (300ms, 600ms) before safe idempotent retry on same document
      await new Promise(res => setTimeout(res, attempt * 300));
    }
  }
  return false;
}

// Dedicated targeted writer for customer reviews directly to Firestore reviews collection
export async function saveReviewDoc(review) {
  if (!db) {
    throw new Error('Firestore database is not initialized');
  }
  const docId = review.id;
  if (!docId) {
    throw new Error('Review is missing id');
  }
  const cleanData = JSON.parse(JSON.stringify(review));
  const docRef = doc(db, 'reviews', String(docId));
  await setDoc(docRef, cleanData, { merge: true });
  return true;
}

// Dedicated hydrator & reconciler: Firestore reviews -> aurora-reviews cache
export async function syncReviewsFromFirestore() {
  if (!db) return [];
  try {
    const docs = await fetchFirestoreCollection('reviews');
    if (docs === null) return []; // network or permission error: do not overwrite cache

    const fakeReviewIds = ['2', '3', '4', '5'];
    const isFake = (r) => {
      if (!r) return true;
      const rid = String(r.id || '');
      if (fakeReviewIds.includes(rid)) return true;
      if (!r.orderId || String(r.orderId).trim() === '') return true;
      if (!r.verifiedPurchase) return true;
      return false;
    };

    let cleanRemote = [];
    if (Array.isArray(docs)) {
      cleanRemote = docs.filter(r => !isFake(r));
    }

    let localData = [];
    try {
      localData = JSON.parse(localStorage.getItem('aurora-reviews') || '[]');
      if (!Array.isArray(localData)) localData = [];
    } catch (e) {
      localData = [];
    }
    localData = localData.filter(r => !isFake(r));

    const merged = mergeGenericCollections('reviews', localData, cleanRemote);
    safeLocalStorageSet('aurora-reviews', JSON.stringify(merged));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-reviews', remote: true } }));
      window.dispatchEvent(new CustomEvent('aurora-reviews-updated', { detail: { reviews: merged } }));
    }
    return merged;
  } catch (err) {
    console.warn('[FIREBASE] Error syncing reviews from Firestore:', err);
    return [];
  }
}

// Dedicated targeted writer for customer contact inquiry to Firestore contactMessages collection
export async function saveContactMessageDoc(inquiry) {
  if (!db) {
    throw new Error('Firestore database is not initialized');
  }
  const docId = inquiry.id;
  if (!docId) {
    throw new Error('Inquiry is missing id');
  }
  const cleanData = JSON.parse(JSON.stringify(inquiry));
  const docRef = doc(db, 'contactMessages', String(docId));
  await setDoc(docRef, cleanData, { merge: true });
}

// Dedicated targeted writer for activity logs directly to Firestore activityLogs collection
export async function saveActivityLogDoc(log) {
  if (!db) {
    console.warn('[FIREBASE] Firestore db not initialized for activityLog write');
    return false;
  }
  const docId = log && log.id;
  if (!docId) {
    throw new Error('Activity log is missing id');
  }
  const cleanData = JSON.parse(JSON.stringify(log));
  const docRef = doc(db, 'activityLogs', String(docId));
  await setDoc(docRef, cleanData, { merge: true });
  return true;
}

// Dedicated sorting helper ensuring newest logs are first (descending by timestamp)
export function sortActivityLogsDesc(logs) {
  if (!Array.isArray(logs)) return [];
  return [...logs].sort((a, b) => {
    const timeA = a && a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b && b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

// Dedicated hydrator & reconciler: Firestore activityLogs -> aurora-activity-logs cache
export async function syncActivityLogsFromFirestore() {
  if (!db) return [];
  try {
    const docs = await fetchFirestoreCollection('activityLogs');
    if (docs === null) return []; // network or permission error: do not overwrite cache

    let cleanRemote = [];
    if (Array.isArray(docs)) {
      cleanRemote = docs.filter(l => l && (l.id || l.action || l.category));
    }

    let localData = [];
    try {
      localData = JSON.parse(localStorage.getItem('aurora-activity-logs') || '[]');
      if (!Array.isArray(localData)) localData = [];
    } catch (e) {
      localData = [];
    }
    localData = localData.filter(l => l && (l.id || l.action || l.category));

    const merged = mergeGenericCollections('activityLogs', localData, cleanRemote);
    const sorted = sortActivityLogsDesc(merged);
    safeLocalStorageSet('aurora-activity-logs', JSON.stringify(sorted));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-activity-logs', remote: true } }));
      window.dispatchEvent(new CustomEvent('aurora-logs-updated', { detail: { logs: sorted } }));
    }
    return sorted;
  } catch (err) {
    console.warn('[FIREBASE] Error syncing activity logs from Firestore:', err);
    return [];
  }
}

// Helper to delete a document from Firestore
export async function deleteFirestoreDoc(colName, docId) {
  if (!db || !docId) return;
  try {
    const docRef = doc(db, colName, String(docId));
    await deleteDoc(docRef);
  } catch (err) {
    console.warn(`[FIREBASE] Error deleting document from ${colName}/${docId}:`, err);
  }
}

// Helper to save entire array collection to Firestore
export async function saveFirestoreCollection(colName, itemsArray, idField = 'id') {
  if (!db || !Array.isArray(itemsArray)) return;
  try {
    for (const item of itemsArray) {
      const docId = item[idField] || item.id || item.notificationId || item.customerId;
      if (docId) {
        if (isStaleRecord(colName, item, docId)) continue;
        await saveFirestoreDoc(colName, docId, item);
      }
    }
  } catch (err) {
    console.warn(`[FIREBASE] Error saving collection ${colName}:`, err);
  }
}

// Helper to fetch all documents from a Firestore collection
export async function fetchFirestoreCollection(colName) {
  if (!db) return null;
  try {
    const colRef = collection(db, colName);
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return [];
    const items = [];
    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (!isStaleRecord(colName, data, docSnap.id)) {
        items.push(data);
      }
    });
    return items;
  } catch (err) {
    console.warn(`[FIREBASE] Error fetching collection ${colName}:`, err);
    return null;
  }
}

// Subscribe to real-time updates for a Firestore collection
export function subscribeToFirestoreCollection(colName, onUpdateCallback) {
  if (!db) return () => {};
  try {
    const colRef = collection(db, colName);
    return onSnapshot(colRef, (snapshot) => {
      const items = [];
      snapshot.forEach(docSnap => {
        const data = { id: docSnap.id, ...docSnap.data() };
        if (!isStaleRecord(colName, data, docSnap.id)) {
          items.push(data);
        }
      });
      onUpdateCallback(items);
    }, (err) => {
      console.warn(`[FIREBASE] Error listening to ${colName}:`, err);
    });
  } catch (err) {
    console.warn(`[FIREBASE] Failed to setup listener for ${colName}:`, err);
    return () => {};
  }
}

// Helper to fetch an admin or staff user directly from Firestore adminUsers collection
export async function fetchAdminUserFromFirestore(firebaseUid, email) {
  if (!db) return null;
  try {
    const cleanEmail = (email || '').toLowerCase().trim();

    // 1. Try direct doc lookup by UID
    if (firebaseUid) {
      const directDocRef = doc(db, 'adminUsers', String(firebaseUid));
      const directSnap = await getDoc(directDocRef);
      if (directSnap.exists()) {
        const data = directSnap.data();
        if (data && data.isArchived !== true) {
          return { id: directSnap.id, ...data };
        }
      }
    }

    // 2. Fetch adminUsers collection to find matching document by firebaseUid or email
    const colRef = collection(db, 'adminUsers');
    const snapshot = await getDocs(colRef);
    if (!snapshot.empty) {
      let matched = null;
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (!data || data.isArchived === true) return;
        const docUid = data.firebaseUid || docSnap.id;
        const docEmail = (data.email || '').toLowerCase().trim();

        // Exact match by Firebase UID
        if (firebaseUid && docUid === firebaseUid) {
          matched = { id: docSnap.id, ...data };
        } else if (!matched && cleanEmail && docEmail === cleanEmail) {
          // Match by email if firebaseUid is not yet set or matches
          if (!data.firebaseUid || (firebaseUid && data.firebaseUid === firebaseUid)) {
            matched = { id: docSnap.id, ...data };
          }
        }
      });
      if (matched) return matched;
    }
    return null;
  } catch (err) {
    console.warn('[FIREBASE] Error querying adminUsers in Firestore:', err);
    return null;
  }
}

// Helper to save a single document to Firestore (targeted write)
export async function saveSingleDocAndSync(colName, docId, docData) {
  if (!db || !docId) return;
  try {
    await saveFirestoreDoc(colName, docId, docData);
  } catch (err) {
    console.warn(`[FIREBASE] Targeted save error for ${colName}/${docId}:`, err);
  }
}

// ============================================================================
// PERMANENT SYNCHRONIZATION GUARD
// Prevents stale pre-reset / test data resurrection across local & Firestore sync
// ============================================================================

export const CONFIRMED_STALE_RESERVATION_IDS = new Set([
  'res-1001',
  'res-1002',
  'res-1003',
  'res-1004',
  'res-1005',
  'res-1006',
  'res-1007',
  'res-1008',
  'res-1009',
  'RES-160604',
  'RES-229876',
  'RES-240985',
  'RES-297938',
  'RES-314841',
  'RES-358587',
  'RES-373136',
  'RES-627131',
  'RES-688359',
  'RES-739027',
  'RES-773509',
  'RES-845804',
  'RES-900316'
]);

export const CONFIRMED_STALE_ORDER_IDS = new Set([
  'ORD-2026-REG-001'
]);

export const CONFIRMED_STALE_INVENTORY_IDS = new Set([
  'inv-1788521165510-rf200011',
  'inv-1788525197355-rf200012',
  'inv-1788679714526-rf200013',
  'inv-1788680042546-rf200014',
  'inv-1788682182327-rf200015',
  'inv-1788682352597-rf200016',
  'inv-1788682539037-rf200017',
  'inv-1788785795476-rf200018',
  'inv-1788786163139-rf200019',
  'inv-1788890659511-rf200020',
  'inv-1788891894134-rf200021',
  'inv-1788894014820-rf200022',
  'inv-1789203335430-rf200023',
  'inv-1789230174047-rf200024',
  'inv-1790019086434-rf200008',
  'inv-1790431873976-gpmte'
]);

export const CONFIRMED_STALE_PRODUCT_IDS = new Set(['p1', 'prod-1', 'test_probe', 'test-prod-999', 'test-prod-jasmine']);

export const CONFIRMED_STALE_CUSTOMER_IDS = new Set([
  'CUS-000001-dummy',
  'CUS-000002-dummy',
  'customer-user-1789648357946',
  'user-1789648357946',
  'user-1790334617411',
  'user-1790338516312',
  'user-1790338633268',
  'user-1790338647955',
  'user-1790338680352'
]);

export const CONFIRMED_STALE_CUSTOMER_EMAILS = new Set([
  'althea.cust.test@gmail.com',
  'maria.santos.1790338515378@example.com',
  'clara.reyes.1790338632220@example.com',
  'clara.reyes.1790338647062@example.com',
  'clara.reyes.1790338679341@example.com'
]);

export const RESET_TIMESTAMP_BOUNDARY = '2026-09-25T09:00:00.000Z';

const SEEDED_PROOF_FILENAMES = new Set([
  'seed_gcash_receipt.png',
  'gcash_seed_proof.png',
  'gcash_receipt_maria.png',
  'receipt_juan_full.png',
  'cardo_downpayment.png',
  'leni_full_gcash.jpg',
  'gloria_receipt.png',
  'marcos_full_payment.png',
  'duterte_fake_proof.png'
]);

// Guard check for orders & reservations
export function isStaleOrderOrReservation(order) {
  if (!order) return true;
  const oid = String(order.id || order.orderId || '').trim();

  // 1. Exact match for confirmed stale test reservation or order IDs
  if (CONFIRMED_STALE_RESERVATION_IDS.has(oid) || CONFIRMED_STALE_ORDER_IDS.has(oid)) return true;

  // 2. Reject mock test customer emails
  const email = String(order.customerEmail || order.email || '').toLowerCase().trim();
  if (/^customer\d+@gmail\.com$/.test(email)) return true;

  // 3. Reject legacy mock seed proofs
  const proof = String(order.paymentProof || '').trim();
  if (SEEDED_PROOF_FILENAMES.has(proof)) return true;

  // 4. Reject explicit seed/fake flags
  if (order.isSeeded || order.isFake) return true;

  // 5. Strictly enforce post-reset timestamp boundary (if createdAt is provided)
  // Legitimate post-reset records start at 2026-09-17T10:39:58Z
  if (order.createdAt) {
    const createdTime = new Date(order.createdAt).getTime();
    const boundaryTime = new Date(RESET_TIMESTAMP_BOUNDARY).getTime();
    if (!isNaN(createdTime) && !isNaN(boundaryTime) && createdTime < boundaryTime) {
      return true;
    }
  }

  return false;
}

// Guard check for inventory history records
export function isStaleInventoryHistory(entry) {
  if (!entry) return true;
  const hid = String(entry.id || '').trim();

  // 1. Exact match for confirmed stale test inventory movements
  if (CONFIRMED_STALE_INVENTORY_IDS.has(hid)) return true;

  // 2. Check remarks referencing confirmed stale test orders or reservations
  const remarks = String(entry.remarks || entry.reason || '').trim();
  if (/#(?:ORD-2026-REG-001)\b/i.test(remarks)) return true;
  for (const staleOrdId of CONFIRMED_STALE_ORDER_IDS) {
    if (remarks.includes(staleOrdId)) return true;
  }
  for (const staleResId of CONFIRMED_STALE_RESERVATION_IDS) {
    if (remarks.includes(staleResId)) return true;
  }

  // 3. Parse timestamp from timestamp field, id prefix, or date field
  const boundaryTime = new Date(RESET_TIMESTAMP_BOUNDARY).getTime();
  if (entry.timestamp) {
    const t = new Date(entry.timestamp).getTime();
    if (!isNaN(t) && t < boundaryTime) return true;
  }
  if (hid.startsWith('inv-')) {
    const rawNum = hid.replace('inv-', '').split('-')[0];
    const parsedNum = Number(rawNum);
    if (!isNaN(parsedNum) && parsedNum > 1000000000000 && parsedNum < boundaryTime) {
      return true;
    }
  }
  if (entry.date && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date).trim())) {
    const dateEndMs = new Date(`${String(entry.date).trim()}T23:59:59.999Z`).getTime();
    if (!isNaN(dateEndMs) && dateEndMs < boundaryTime) return true;
  }

  return false;
}

// Universal record validator across all collection types
export function isStaleRecord(colName, item, docId) {
  if (!item && !docId) return true;
  const record = item || { id: docId };
  if (colName === 'orders') return isStaleOrderOrReservation(record);
  if (colName === 'inventoryHistory') return isStaleInventoryHistory(record);
  if (colName === 'products') return isStaleProduct(record);
  if (colName === 'customers') return isStaleCustomer(record);
  if (colName === 'users') return isStaleUser(record);
  if (colName === 'notifications') return isStaleNotification(record);
  return false;
}

// Guard check for products
export function isStaleProduct(product) {
  if (!product) return true;
  const pid = String(product.id || '').trim();
  if (!pid || pid === 'test_probe' || pid.startsWith('test-') || pid === 'undefined') return true;
  if (!product.name || typeof product.name !== 'string' || product.name.trim() === '') return true;
  return CONFIRMED_STALE_PRODUCT_IDS.has(pid);
}

// Guard check for customers
export function isStaleCustomer(customer) {
  if (!customer) return true;
  const cid = String(customer.id || customer.customerId || '').trim();
  const email = String(customer.email || '').toLowerCase().trim();
  const name = String(customer.name || customer.fullName || '').trim();
  const phone = String(customer.phone || customer.phoneE164 || '').trim();

  // Guard against confirmed stale test customer IDs
  if (cid && CONFIRMED_STALE_CUSTOMER_IDS.has(cid)) return true;

  // Guard against confirmed stale test customer emails
  if (email && CONFIRMED_STALE_CUSTOMER_EMAILS.has(email)) return true;

  if (/^customer\d+@gmail\.com$/.test(email)) return true;

  // Reject completely blank dummy documents that lack all identifying info
  if (!email && !name && !phone && (cid === 'CUS-000001' || cid === 'CUS-000002')) return true;

  return false;
}

// Guard check for users
export function isStaleUser(user) {
  if (!user) return true;
  const uid = String(user.id || user.uid || '').trim();
  const email = String(user.email || '').toLowerCase().trim();
  if (uid && CONFIRMED_STALE_CUSTOMER_IDS.has(uid)) return true;
  if (email && CONFIRMED_STALE_CUSTOMER_EMAILS.has(email)) return true;
  if (/^customer\d+@gmail\.com$/.test(email)) return true;
  if (/^user-[1-9]\d{0,2}$/.test(uid) && /^customer\d+@gmail\.com$/.test(email)) return true;
  return false;
}

// Guard check for notifications
export function isStaleNotification(notif) {
  if (!notif) return true;
  const targetId = String(notif.targetId || notif.recordId || notif.reservationId || notif.orderId || '').trim();
  if (CONFIRMED_STALE_RESERVATION_IDS.has(targetId) || CONFIRMED_STALE_ORDER_IDS.has(targetId)) return true;

  const userId = String(notif.userId || notif.customerId || '').trim();
  if (userId === 'user-4' || userId === 'user-1786542851381') return true;

  return false;
}

// Pending in-flight order writes registry to prevent race conditions during async Firestore hydration
const pendingOrderWrites = new Map();

export function registerPendingOrderWrite(orderId, orderData) {
  if (!orderId || !orderData) return;
  pendingOrderWrites.set(String(orderId), {
    data: JSON.parse(JSON.stringify(orderData)),
    timestamp: Date.now()
  });
}

export function unregisterPendingOrderWrite(orderId) {
  if (orderId) pendingOrderWrites.delete(String(orderId));
}

export function getPendingOrderWrites() {
  const now = Date.now();
  for (const [id, entry] of pendingOrderWrites.entries()) {
    if (now - entry.timestamp > 120000) {
      pendingOrderWrites.delete(id);
    }
  }
  return pendingOrderWrites;
}

// Helper to safely merge remote documents into local array by document ID
// Authoritative remote records win. Local-only records that do not exist in Firestore must NOT survive hydration!
export function mergeCollectionsById(localItems, remoteItems) {
  if (!Array.isArray(remoteItems)) remoteItems = [];
  if (!Array.isArray(localItems)) localItems = [];

  // RULE 3 SAFETY: A temporary empty remote result must NOT destroy valid cached products
  if (remoteItems.length === 0 && localItems.length > 0) {
    return localItems.filter(item => item && item.id !== undefined && !isStaleProduct(item));
  }

  const localMap = new Map();
  localItems.forEach(item => {
    if (item && item.id !== undefined && item.id !== null && !isStaleProduct(item)) {
      localMap.set(String(item.id), item);
    }
  });

  const mergedMap = new Map();
  remoteItems.forEach(rItem => {
    if (rItem && rItem.id !== undefined && rItem.id !== null && !isStaleProduct(rItem)) {
      const key = String(rItem.id);
      const existing = localMap.get(key);
      if (existing) {
        mergedMap.set(key, { ...existing, ...rItem });
      } else {
        mergedMap.set(key, { ...rItem });
      }
    }
  });

  return Array.from(mergedMap.values());
}

// Universal generic collection reconciler ensuring non-destructive synchronization
// Authoritative remote dataset wins: local-only records that do not exist in Firestore must NOT survive hydration!
export function mergeGenericCollections(colName, localList = [], remoteList = []) {
  if (!Array.isArray(localList)) localList = [];
  if (!Array.isArray(remoteList)) remoteList = [];

  if (colName === 'notifications') {
    return mergeNotificationLists(localList, remoteList);
  }

  // Apply Permanent Synchronization Guard filters
  if (colName === 'orders') {
    localList = localList.filter(o => !isStaleOrderOrReservation(o));
    remoteList = remoteList.filter(o => !isStaleOrderOrReservation(o));
  } else if (colName === 'inventoryHistory') {
    localList = localList.filter(h => !isStaleInventoryHistory(h));
    remoteList = remoteList.filter(h => !isStaleInventoryHistory(h));
  } else if (colName === 'products') {
    localList = localList.filter(p => !isStaleProduct(p));
    remoteList = remoteList.filter(p => !isStaleProduct(p));
  } else if (colName === 'customers') {
    localList = localList.filter(c => !isStaleCustomer(c));
    remoteList = remoteList.filter(c => !isStaleCustomer(c));
  } else if (colName === 'users') {
    localList = localList.filter(u => !isStaleUser(u));
    remoteList = remoteList.filter(u => !isStaleUser(u));
  }

  // RULE 3 SAFETY: A temporary empty remote result must NOT immediately wipe out core configuration/catalog collections
  if (remoteList.length === 0 && localList.length > 0) {
    if (colName === 'products' || colName === 'adminUsers' || colName === 'storeSettings') {
      console.warn(`[SYNC-GUARD] Remote collection '${colName}' returned 0 records while local cache has ${localList.length}. Preserving valid local cache to prevent destruction.`);
      return localList.filter(item => !isStaleRecord(colName, item, item.id));
    }
  }

  if (colName === 'reviews') {
    const fakeReviewIds = ['2', '3', '4', '5'];
    const isFake = (r) => {
      if (!r) return true;
      const rid = String(r.id || '');
      if (fakeReviewIds.includes(rid)) return true;
      if (!r.orderId || String(r.orderId).trim() === '') return true;
      if (!r.verifiedPurchase) return true;
      return false;
    };
    localList = localList.filter(r => !isFake(r));
    remoteList = remoteList.filter(r => !isFake(r));
  }

  const getRecordKey = (item) => {
    if (!item) return null;

    if (colName === 'orders') {
      return String(item.id || item.orderId || '');
    }

    if (colName === 'users') {
      const fbUid = item.firebaseUid || item.uid
        ? String(item.firebaseUid || item.uid).trim()
        : '';
      const email = item.email
        ? String(item.email).trim().toLowerCase()
        : '';
      const id = item.id ? String(item.id).trim() : '';

      return (
        (fbUid ? `uid_${fbUid}` : '') ||
        (email ? `email_${email}` : '') ||
        id
      );
    }

    if (colName === 'customers') {
      const uid = item.uid || item.firebaseUid
        ? String(item.uid || item.firebaseUid).trim()
        : '';
      const email = item.email
        ? String(item.email).trim().toLowerCase()
        : '';
      const id =
        item.id || item.customerId
          ? String(item.id || item.customerId).trim()
          : '';

      return (
        (uid ? `uid_${uid}` : '') ||
        (email ? `email_${email}` : '') ||
        id
      );
    }

    return String(item.id || item._id || item.key || '');
  };

  // 1. Index local records by key for field-level reconciliation
  const localMap = new Map();
  localList.forEach((item) => {
    if (!item) return;
    const key = getRecordKey(item);
    if (key) {
      localMap.set(key, item);
    }
  });

  // 2. Iterate ONLY remote records: Authoritative remote records win
  // Local-only records that do not exist in Firestore do NOT survive hydration!
  const map = new Map();
  remoteList.forEach((rItem) => {
    if (!rItem) return;

    const key = getRecordKey(rItem);
    if (!key) return;

    const pendingEntry = colName === 'orders' ? pendingOrderWrites.get(key) : null;
    const existing = (pendingEntry && pendingEntry.data) ? pendingEntry.data : localMap.get(key);

    // ------------------------------------------------------------
    // Matching local record exists
    // ------------------------------------------------------------
    if (existing) {

      // ----------------------------------------------------------
      // ORDERS
      // Protect newer local reservation allocation data
      // from being overwritten by an older Firebase copy.
      // ----------------------------------------------------------
      if (colName === 'orders') {
        const localAllocated = Number(
          existing.allocatedQuantity || 0
        );

        const remoteAllocated = Number(
          rItem.allocatedQuantity || 0
        );

        const getEffectiveOrderMs = (ord) => {
          if (!ord) return 0;
          const candidates = [
            ord.updatedAt,
            ord.paymentRejectedAt,
            ord.reuploadRequestedAt,
            ord.paymentReuploadedAt,
            ord.cancelledAt,
            ord.completedAt,
            ord.createdAt
          ];
          let maxMs = 0;
          for (const ts of candidates) {
            if (ts) {
              const parsed = new Date(ts).getTime();
              if (!isNaN(parsed) && parsed > maxMs) maxMs = parsed;
            }
          }
          return maxMs;
        };

        const localUpdatedAt = getEffectiveOrderMs(existing);
        const remoteUpdatedAt = getEffectiveOrderMs(rItem);

        const localIsNewer =
          localUpdatedAt > remoteUpdatedAt;

        const remoteIsCancelled =
          String(rItem.status || '').toLowerCase() === 'cancelled' ||
          rItem.autoCancelledDueToRejectionDeadline === true ||
          rItem.autoCancelledDueToPaymentDeadline === true;

        const localIsCancelled =
          String(existing.status || '').toLowerCase() === 'cancelled' ||
          existing.autoCancelledDueToRejectionDeadline === true ||
          existing.autoCancelledDueToPaymentDeadline === true;

        if (pendingEntry) {
          if (remoteUpdatedAt >= localUpdatedAt || (localIsCancelled && remoteIsCancelled)) {
            pendingOrderWrites.delete(key);
          }
        }

        const localHasMoreAllocation =
          !remoteIsCancelled &&
          !localIsCancelled &&
          localAllocated > remoteAllocated &&
          localUpdatedAt >= remoteUpdatedAt;

        // Keep the local version when it contains newer
        // allocation, cancellation, or state information.
        if (localIsNewer || localHasMoreAllocation || (localIsCancelled && !remoteIsCancelled)) {
          map.set(key, {
            ...rItem,
            ...existing,

            allocatedQuantity:
              existing.allocatedQuantity,

            status:
              existing.status,

            statusHistory:
              existing.statusHistory,

            paymentDeadline:
              existing.paymentDeadline,

            notifiedForPayment:
              existing.notifiedForPayment,

            restockBatchExcluded:
              existing.restockBatchExcluded,

            excludedFromRestockAt:
              existing.excludedFromRestockAt,

            estimatedFulfillmentDate:
              existing.estimatedFulfillmentDate,

            actualRestockDate:
              existing.actualRestockDate,

            restockAllocatedAt:
              existing.restockAllocatedAt,

            stockAllocatedAt:
              existing.stockAllocatedAt,

            updatedAt:
              existing.updatedAt
          });

        } else {
          // Remote record is newer or equal.
          map.set(key, {
            ...existing,
            ...rItem
          });
        }

      } else if (colName === 'activityLogs') {
        // Authoritative Firestore activity log record takes precedence over local copy
        map.set(key, {
          ...existing,
          ...rItem
        });
      } else if (colName === 'customers') {
        // Authoritative Firestore customer record reconciliation:
        // Firebase is the source of truth for customer profile fields.
        const localUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const remoteUpdatedAt = rItem.updatedAt ? new Date(rItem.updatedAt).getTime() : 0;

        const remoteIsNewer = remoteUpdatedAt >= localUpdatedAt;
        const localIsEmpty = (!existing.phone && rItem.phone) || (!existing.address && rItem.address) || (!existing.fullName && rItem.fullName);

        // Keep canonical ID: prefer user-178... format or established ID
        const canonicalId = (existing.id && /^user-\d+$/.test(existing.id)) ? existing.id : (rItem.id || existing.id);
        const canonicalCustomerId = (existing.customerId && existing.customerId.startsWith('CUS-')) ? existing.customerId : (rItem.customerId || existing.customerId);

        // Deduplicate and merge recent orders (filtering out any stale pre-reset orders)
        const ordersMap = new Map();
        const isRecentOrderStale = (o) => {
          if (!o || !o.id) return true;
          const oid = String(o.id).trim();
          if (CONFIRMED_STALE_ORDER_IDS.has(oid) || CONFIRMED_STALE_RESERVATION_IDS.has(oid)) return true;
          if (o.date) {
            const dMs = new Date(`${o.date} 23:59:59`).getTime();
            const bMs = new Date(RESET_TIMESTAMP_BOUNDARY).getTime();
            if (!isNaN(dMs) && !isNaN(bMs) && dMs < bMs) return true;
          }
          return false;
        };
        (existing.recentOrders || []).forEach(o => { if (!isRecentOrderStale(o)) ordersMap.set(String(o.id), o); });
        (rItem.recentOrders || []).forEach(o => { if (!isRecentOrderStale(o)) ordersMap.set(String(o.id), o); });

        const primary = (remoteIsNewer || localIsEmpty) ? rItem : existing;
        const fallback = (remoteIsNewer || localIsEmpty) ? existing : rItem;

        map.set(key, {
          ...fallback,
          ...primary,
          id: canonicalId,
          customerId: canonicalCustomerId,
          uid: existing.uid || rItem.uid || (existing.firebaseUid || rItem.firebaseUid),
          name: primary.name || primary.fullName || fallback.name || fallback.fullName,
          fullName: primary.fullName || primary.name || fallback.fullName || fallback.name,
          phone: primary.phone || fallback.phone || '',
          phoneE164: primary.phoneE164 || fallback.phoneE164 || '',
          phoneVerified: primary.phoneVerified ?? (fallback.phoneVerified ?? false),
          address: primary.address || primary.shippingAddress || fallback.address || fallback.shippingAddress || '',
          shippingAddress: primary.shippingAddress || primary.address || fallback.shippingAddress || fallback.address || '',
          gender: primary.gender || fallback.gender || 'Female',
          profilePicture: primary.profilePicture || fallback.profilePicture || null,
          totalSpent: Math.max(parseFloat(existing.totalSpent) || 0, parseFloat(rItem.totalSpent) || 0),
          isArchived: rItem.isArchived !== undefined ? rItem.isArchived : (existing.isArchived ?? false),
          status: rItem.status || existing.status || 'Active',
          isActive: rItem.isActive !== undefined ? rItem.isActive : (existing.isActive ?? true),
          recentOrders: Array.from(ordersMap.values()),
          updatedAt: primary.updatedAt || fallback.updatedAt || new Date().toISOString()
        });
      } else if (colName === 'users') {
        const localUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const remoteUpdatedAt = rItem.updatedAt ? new Date(rItem.updatedAt).getTime() : 0;
        const remoteIsNewer = remoteUpdatedAt >= localUpdatedAt;
        const localIsEmpty = (!existing.phone && rItem.phone) || (!existing.address && rItem.address) || (!existing.fullName && rItem.fullName);

        const primary = (remoteIsNewer || localIsEmpty) ? rItem : existing;
        const fallback = (remoteIsNewer || localIsEmpty) ? existing : rItem;
        const canonicalId = (existing.id && /^user-\d+$/.test(existing.id)) ? existing.id : (rItem.id || existing.id);

        map.set(key, {
          ...fallback,
          ...primary,
          id: canonicalId,
          firebaseUid: primary.firebaseUid || fallback.firebaseUid || (primary.uid || fallback.uid),
          fullName: primary.fullName || primary.name || fallback.fullName || fallback.name,
          name: primary.fullName || primary.name || fallback.fullName || fallback.name,
          phone: primary.phone || fallback.phone || '',
          phoneE164: primary.phoneE164 || fallback.phoneE164 || '',
          phoneVerified: primary.phoneVerified ?? (fallback.phoneVerified ?? false),
          address: primary.address || fallback.address || '',
          gender: primary.gender || fallback.gender || 'Female',
          profilePicture: primary.profilePicture || fallback.profilePicture || null,
          isArchived: rItem.isArchived !== undefined ? rItem.isArchived : (existing.isArchived ?? false),
          status: rItem.status || existing.status || 'Active',
          isActive: rItem.isActive !== undefined ? rItem.isActive : (existing.isActive ?? true),
          updatedAt: primary.updatedAt || fallback.updatedAt || new Date().toISOString()
        });
      } else {
        // Non-order collections use authoritative remote data merged with non-conflicting local fields
        map.set(key, {
          ...existing,
          ...rItem
        });
      }

    } else {
      // No matching local record: keep remote record
      map.set(key, {
        ...rItem
      });
    }
  });

  if (colName === 'orders') {
    // PENDING WRITE SAFETY:
    // Protect in-flight writes and recent local writes from being erased if remoteList hasn't received them yet
    const pendingWrites = getPendingOrderWrites();
    for (const [pId, entry] of pendingWrites.entries()) {
      if (!map.has(pId)) {
        map.set(pId, entry.data);
      }
    }
    localList.forEach((lItem) => {
      if (!lItem) return;
      const key = getRecordKey(lItem);
      if (!key || map.has(key)) return;
      const itemCreated = new Date(lItem.createdAt || lItem.dateCreated || 0).getTime();
      // If order was created locally within the last 60 seconds, protect it from race condition
      if (Date.now() - itemCreated < 60000 && (lItem.id || lItem.orderId)) {
        map.set(key, lItem);
      }
    });
  }

  if (colName === 'activityLogs') {
    return sortActivityLogsDesc(Array.from(map.values()));
  }

  return Array.from(map.values());
}

// Universal notification reconciler ensuring permanent read status persistence & deduplication
// Authoritative remote notifications win: local-only notifications that do not exist in Firestore do NOT survive!
export function mergeNotificationLists(localList = [], remoteList = []) {
  const notifsMap = new Map();

  // 1. Index local notifications to preserve user's local read state
  const localMap = new Map();
  if (Array.isArray(localList)) {
    localList.forEach(n => {
      if (!n || isStaleNotification(n)) return;
      const key = String(n.id || n.notificationId || n.eventKey || '');
      if (key) {
        localMap.set(key, n);
      }
    });
  }

  // 2. Authoritative remote notifications are the source of truth
  if (Array.isArray(remoteList)) {
    remoteList.forEach(r => {
      if (!r || isStaleNotification(r)) return;
      const key = String(r.id || r.notificationId || r.eventKey || '');
      if (key) {
        const existing = localMap.get(key);
        const isRead = Boolean((existing && (existing.read || existing.isRead)) || r.read || r.isRead);
        notifsMap.set(key, {
          ...(existing || {}),
          ...r,
          read: isRead,
          isRead: isRead
        });
      }
    });
  }

  // 3. Deduplicate duplicate notifications
  const allEntries = Array.from(notifsMap.values());
  const result = [];
  const seenEventKeys = new Set();
  const seenSignatures = new Set();

  allEntries.forEach(item => {
    if (!item) return;
    const isNamedEventKey = item.eventKey && typeof item.eventKey === 'string' && !item.eventKey.startsWith('notif-');
    if (isNamedEventKey) {
      if (seenEventKeys.has(item.eventKey)) return;
      seenEventKeys.add(item.eventKey);
    }

    const signature = `${item.role || ''}_${item.userId || ''}_${item.title || ''}_${item.message || ''}_${item.orderId || ''}_${item.reservationId || ''}_${item.createdDate || ''}`;
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);

    result.push(item);
  });

  return result;
}

// Authoritative orders hydration helper for all client contexts (Admin, Staff, Customer)
export async function syncOrdersFromFirestore() {
  if (!db) return [];
  try {
    const [ordersRes, notifsRes, logsRes] = await Promise.allSettled([
      fetchFirestoreCollection('orders'),
      fetchFirestoreCollection('notifications'),
      fetchFirestoreCollection('activityLogs')
    ]);

    if (notifsRes.status === 'fulfilled' && Array.isArray(notifsRes.value)) {
      try {
        const localNotifs = JSON.parse(localStorage.getItem('aurora-notifications') || '[]');
        const mergedNotifs = mergeNotificationLists(localNotifs, notifsRes.value);
        safeLocalStorageSet('aurora-notifications', JSON.stringify(mergedNotifs));
      } catch (_) {}
    }

    if (logsRes.status === 'fulfilled' && Array.isArray(logsRes.value)) {
      try {
        const cleanRemoteLogs = logsRes.value.filter(l => l && (l.id || l.action || l.category));
        const localLogs = JSON.parse(localStorage.getItem('aurora-activity-logs') || '[]');
        const mergedLogs = sortActivityLogsDesc(mergeGenericCollections('activityLogs', localLogs, cleanRemoteLogs));
        safeLocalStorageSet('aurora-activity-logs', JSON.stringify(mergedLogs));
      } catch (_) {}
    }

    const remoteDocs = ordersRes.status === 'fulfilled' ? ordersRes.value : null;
    if (remoteDocs !== null && Array.isArray(remoteDocs)) {
      ordersHydratedFromFirestore = true;
      const localOrders = JSON.parse(localStorage.getItem('aurora-orders') || '[]');
      const merged = mergeGenericCollections('orders', localOrders, remoteDocs);
      safeLocalStorageSet('aurora-orders', JSON.stringify(merged));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders', remote: true } }));
        window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { key: 'aurora-orders' } }));
      }
      return merged;
    }
  } catch (err) {
    console.warn('[FIREBASE] Error in syncOrdersFromFirestore:', err);
  }
  return JSON.parse(localStorage.getItem('aurora-orders') || '[]');
}

// Authoritative store settings & branding logo hydration helper
export async function syncStoreSettingsFromFirestore() {
  if (!db) return null;
  try {
    const remoteDocs = await fetchFirestoreCollection('storeSettings');
    if (remoteDocs !== null && Array.isArray(remoteDocs) && remoteDocs.length > 0) {
      safeLocalStorageSet('aurora-store-settings', JSON.stringify(remoteDocs));
      const s = remoteDocs[0];
      if (s.logo) safeLocalStorageSet('settings-store-logo', s.logo);
      if (s.banner) safeLocalStorageSet('settings-store-banner', s.banner);
      if (s.storeName) safeLocalStorageSet('settings-store-name', s.storeName);
      if (s.description) safeLocalStorageSet('settings-store-description', s.description);
      if (s.contactNumber) safeLocalStorageSet('settings-contact-number', s.contactNumber);
      if (s.storeAddress) safeLocalStorageSet('settings-store-address', s.storeAddress);
      if (s.facebookLink !== undefined) safeLocalStorageSet('settings-facebook-link', s.facebookLink);
      if (s.businessHours) safeLocalStorageSet('settings-business-hours', s.businessHours);
      if (s.gcashName) safeLocalStorageSet('settings-gcash-name', s.gcashName);
      if (s.gcashNumber) safeLocalStorageSet('settings-gcash-number', s.gcashNumber);
      if (s.gcashQr !== undefined) safeLocalStorageSet('settings-gcash-qr', s.gcashQr);

      if (typeof document !== 'undefined' && s.logo) {
        const navLogo = document.getElementById('navbar-store-logo');
        if (navLogo && navLogo.src !== s.logo) {
          navLogo.src = s.logo;
        }
        const footLogo = document.getElementById('footer-store-logo');
        if (footLogo && footLogo.src !== s.logo) {
          footLogo.src = s.logo;
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-store-settings', remote: true } }));
      }
      return remoteDocs;
    }
  } catch (err) {
    console.warn('[FIREBASE] Error in syncStoreSettingsFromFirestore:', err);
  }
  return null;
}

export async function initFirestoreSync(force = false) {
  if (firestoreSyncPromise && !force) return firestoreSyncPromise;
  firestoreSyncPromise = (async () => {
  if (!db) return;

  const isAdminFlag = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-admin-logged-in') === 'true';
  let hasAdminSession = false;
  try {
    const rawAdmin = typeof localStorage !== 'undefined' ? localStorage.getItem('aurora-admin-user') : null;
    if (rawAdmin) {
      const a = JSON.parse(rawAdmin);
      if (a && (a.role === 'admin' || a.role === 'staff') && !a.isArchived) {
        hasAdminSession = true;
      }
    }
  } catch (e) {}
  const isAdmin = isAdminFlag || hasAdminSession;
  const isCustomerLoggedIn = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-logged-in') === 'true';
  
  let currentUser = null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('aurora-user') : null;
    if (raw) currentUser = JSON.parse(raw);
  } catch (e) {
    console.warn('[FIREBASE] Error reading aurora-user cache:', e);
  }

  // 1. PUBLIC COLLECTIONS — Synced for all visitors (Guests, Customers, Staff, Admin)
  // Prioritize storeSettings first to ensure branding & logo are available immediately on initial load
  const publicCollections = [
    { col: 'storeSettings', key: 'aurora-store-settings' },
    { col: 'products', key: 'aurora-products' },
    { col: 'reviews', key: 'aurora-reviews' },
    { col: 'inventoryHistory', key: 'aurora-inventory-history' }
  ];

  for (const { col, key } of publicCollections) {
    try {
      if (col === 'reviews') {
        // Authoritative Firestore hydration and safe local migration
        await syncReviewsFromFirestore();

        subscribeToFirestoreCollection('reviews', (remoteItems) => {
          if (!remoteItems) return;
          const fakeReviewIds = ['2', '3', '4', '5'];
          const isFake = (r) => {
            if (!r) return true;
            const rid = String(r.id || '');
            if (fakeReviewIds.includes(rid)) return true;
            if (!r.orderId || String(r.orderId).trim() === '') return true;
            if (!r.verifiedPurchase) return true;
            return false;
          };
          const cleanRemote = (remoteItems || []).filter(r => !isFake(r));
          const currentLocal = JSON.parse(localStorage.getItem('aurora-reviews') || '[]').filter(r => !isFake(r));
          const merged = mergeGenericCollections('reviews', currentLocal, cleanRemote);
          const newRemoteRaw = JSON.stringify(merged);
          if (localStorage.getItem('aurora-reviews') !== newRemoteRaw) {
            safeLocalStorageSet('aurora-reviews', newRemoteRaw);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-reviews', remote: true } }));
              window.dispatchEvent(new CustomEvent('aurora-reviews-updated', { detail: { reviews: merged } }));
            }
          }
        });
        continue;
      }

      let localData = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(key) || '[]') : [];

      const docs = await fetchFirestoreCollection(col);
      if (docs !== null) {
        if (col === 'products') {
          const merged = mergeCollectionsById(localData, docs);
          safeLocalStorageSet(key, JSON.stringify(merged));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
          }
        } else {
          const merged = mergeGenericCollections(col, localData, docs);
          safeLocalStorageSet(key, JSON.stringify(merged));
          if (col === 'storeSettings' && Array.isArray(merged) && merged.length > 0) {
            const s = merged[0];
            if (s.logo) safeLocalStorageSet('settings-store-logo', s.logo);
            if (s.banner) safeLocalStorageSet('settings-store-banner', s.banner);
            if (s.storeName) safeLocalStorageSet('settings-store-name', s.storeName);
            if (s.description) safeLocalStorageSet('settings-store-description', s.description);
            if (s.contactNumber) safeLocalStorageSet('settings-contact-number', s.contactNumber);
            if (s.storeAddress) safeLocalStorageSet('settings-store-address', s.storeAddress);
            if (s.facebookLink !== undefined) safeLocalStorageSet('settings-facebook-link', s.facebookLink);
            if (s.businessHours) safeLocalStorageSet('settings-business-hours', s.businessHours);
            if (s.gcashName) safeLocalStorageSet('settings-gcash-name', s.gcashName);
            if (s.gcashNumber) safeLocalStorageSet('settings-gcash-number', s.gcashNumber);
            if (s.gcashQr !== undefined) safeLocalStorageSet('settings-gcash-qr', s.gcashQr);

            if (typeof document !== 'undefined' && s.logo) {
              const navLogo = document.getElementById('navbar-store-logo');
              if (navLogo && navLogo.src !== s.logo) {
                navLogo.src = s.logo;
              }
              const footLogo = document.getElementById('footer-store-logo');
              if (footLogo && footLogo.src !== s.logo) {
                footLogo.src = s.logo;
              }
            }
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
          }
        }
      }

      subscribeToFirestoreCollection(col, (remoteItems) => {
        if (remoteItems !== null && remoteItems !== undefined) {
          const currentLocal = JSON.parse(localStorage.getItem(key) || '[]');
          let merged = remoteItems;
          if (col === 'products') {
            merged = mergeCollectionsById(currentLocal, remoteItems);
          } else {
            merged = mergeGenericCollections(col, currentLocal, remoteItems);
          }
          if (col === 'storeSettings' && Array.isArray(merged) && merged.length > 0) {
            const s = merged[0];
            if (s.logo) safeLocalStorageSet('settings-store-logo', s.logo);
            if (s.banner) safeLocalStorageSet('settings-store-banner', s.banner);
            if (s.storeName) safeLocalStorageSet('settings-store-name', s.storeName);
            if (s.description) safeLocalStorageSet('settings-store-description', s.description);
            if (s.contactNumber) safeLocalStorageSet('settings-contact-number', s.contactNumber);
            if (s.storeAddress) safeLocalStorageSet('settings-store-address', s.storeAddress);
            if (s.facebookLink !== undefined) safeLocalStorageSet('settings-facebook-link', s.facebookLink);
            if (s.businessHours) safeLocalStorageSet('settings-business-hours', s.businessHours);
            if (s.gcashName) safeLocalStorageSet('settings-gcash-name', s.gcashName);
            if (s.gcashNumber) safeLocalStorageSet('settings-gcash-number', s.gcashNumber);
            if (s.gcashQr !== undefined) safeLocalStorageSet('settings-gcash-qr', s.gcashQr);

            if (typeof document !== 'undefined' && s.logo) {
              const navLogo = document.getElementById('navbar-store-logo');
              if (navLogo && navLogo.src !== s.logo) {
                navLogo.src = s.logo;
              }
              const footLogo = document.getElementById('footer-store-logo');
              if (footLogo && footLogo.src !== s.logo) {
                footLogo.src = s.logo;
              }
            }
          }
          const newRemoteRaw = JSON.stringify(merged);
          if (localStorage.getItem(key) !== newRemoteRaw) {
            safeLocalStorageSet(key, newRemoteRaw);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
            }
          }
        }
      });
    } catch (e) {
      console.warn(`[FIREBASE] Error syncing public collection ${col}:`, e);
    }
  }

  // 1.1 ORDERS — Dedicated authoritative orders hydration & real-time sync for ALL visitor and user roles
  try {
    await syncOrdersFromFirestore();
    subscribeToFirestoreCollection('orders', (remoteItems) => {
      if (remoteItems !== null && Array.isArray(remoteItems)) {
        ordersHydratedFromFirestore = true;
        const currentLocal = JSON.parse(localStorage.getItem('aurora-orders') || '[]');
        const merged = mergeGenericCollections('orders', currentLocal, remoteItems);
        const currentLocalRaw = localStorage.getItem('aurora-orders');
        const newMergedRaw = JSON.stringify(merged);
        if (currentLocalRaw !== newMergedRaw) {
          safeLocalStorageSet('aurora-orders', newMergedRaw);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders', remote: true } }));
            window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { key: 'aurora-orders' } }));
          }
        }
      }
    });
  } catch (e) {
    console.warn('[FIREBASE] Error syncing orders collection:', e);
  }

  // 2. STAFF / ADMIN — Operational collections required by admin dashboard
  if (isAdmin) {
    const adminCollections = [
      { col: 'users', key: 'aurora-users' },
      { col: 'adminUsers', key: 'aurora-admin-users' },
      { col: 'customers', key: 'aurora-customers' },
      { col: 'activityLogs', key: 'aurora-activity-logs' },
      { col: 'notifications', key: 'aurora-notifications' },
      { col: 'contactMessages', key: 'aurora-messages' }
    ];

    for (const { col, key } of adminCollections) {
      try {
        if (col === 'activityLogs') {
          // Dedicated hydration, migration & sorting for authoritative activityLogs
          await syncActivityLogsFromFirestore();

          subscribeToFirestoreCollection('activityLogs', (remoteItems) => {
            if (!remoteItems) return;
            const cleanRemote = (remoteItems || []).filter(l => l && (l.id || l.action || l.category));
            let currentLocal = [];
            try {
              currentLocal = JSON.parse(localStorage.getItem('aurora-activity-logs') || '[]');
              if (!Array.isArray(currentLocal)) currentLocal = [];
            } catch (e) {
              currentLocal = [];
            }
            const merged = mergeGenericCollections('activityLogs', currentLocal, cleanRemote);
            const sorted = sortActivityLogsDesc(merged);
            const newRemoteRaw = JSON.stringify(sorted);
            if (localStorage.getItem('aurora-activity-logs') !== newRemoteRaw) {
              safeLocalStorageSet('aurora-activity-logs', newRemoteRaw);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-activity-logs', remote: true } }));
                window.dispatchEvent(new CustomEvent('aurora-logs-updated', { detail: { logs: sorted } }));
              }
            }
          });
          continue;
        }

        const docs = await fetchFirestoreCollection(col);
        if (docs !== null) {
          let cleanDocs = docs;
          if (col === 'customers') {
            cleanDocs = docs.filter(c => c && (c.id || c.customerId || c.email) && (c.name || c.fullName || c.email) && c.name !== 'undefined' && c.fullName !== 'undefined');
          } else if (col === 'users') {
            cleanDocs = docs.filter(u => u && (u.id || u.email) && (u.fullName || u.name || u.email) && u.fullName !== 'undefined' && u.name !== 'undefined');
          }

          const localList = JSON.parse(localStorage.getItem(key) || '[]');
          const merged = mergeGenericCollections(col, localList, cleanDocs);
          safeLocalStorageSet(key, JSON.stringify(merged));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
          }
        }

        subscribeToFirestoreCollection(col, (remoteItems) => {
          if (remoteItems !== null) {
            let cleanItems = remoteItems;
            if (col === 'customers') {
              cleanItems = remoteItems.filter(c => c && (c.id || c.customerId || c.email) && (c.name || c.fullName || c.email) && c.name !== 'undefined' && c.fullName !== 'undefined');
            } else if (col === 'users') {
              cleanItems = remoteItems.filter(u => u && (u.id || u.email) && (u.fullName || u.name || u.email) && u.fullName !== 'undefined' && u.name !== 'undefined');
            }

            const localList = JSON.parse(localStorage.getItem(key) || '[]');
            const merged = mergeGenericCollections(col, localList, cleanItems);
            const currentLocalRaw = localStorage.getItem(key);
            const newMergedRaw = JSON.stringify(merged);
            if (currentLocalRaw !== newMergedRaw) {
              safeLocalStorageSet(key, newMergedRaw);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
                if (key === 'aurora-orders') {
                  window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { key } }));
                } else if (key === 'aurora-activity-logs') {
                  window.dispatchEvent(new CustomEvent('aurora-logs-updated', { detail: { key, logs: merged } }));
                } else if (key === 'aurora-customers') {
                  window.dispatchEvent(new CustomEvent('aurora-customers-updated', { detail: { key, customers: merged } }));
                }
              }
            }
          }
        });
      } catch (e) {
        console.warn(`[FIREBASE] Error syncing admin collection ${col}:`, e);
      }
    }
    return;
  }

  // 3. CUSTOMER — Role-scoped targeted sync for customer's own records (e.g. notifications)
  const isCustomerStillLoggedIn = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-logged-in') === 'true' && !!localStorage.getItem('aurora-user');
  if (isCustomerStillLoggedIn) {
    let activeCustomerUser = currentUser;
    try {
      const freshRaw = localStorage.getItem('aurora-user');
      if (freshRaw) activeCustomerUser = JSON.parse(freshRaw);
    } catch (_) {}
    const fbUid = auth?.currentUser?.uid || activeCustomerUser?.firebaseUid;
    const localUserId = activeCustomerUser?.id;

    // Helper to merge customer notifications
    const mergeCustomerNotifs = (remoteDocs) => {
      if (!remoteDocs || !Array.isArray(remoteDocs)) return;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('aurora-logged-in') !== 'true') return;
      try {
        const localNotifs = JSON.parse(localStorage.getItem('aurora-notifications') || '[]');
        const merged = mergeNotificationLists(localNotifs, remoteDocs);
        const currentRaw = localStorage.getItem('aurora-notifications');
        const newRaw = JSON.stringify(merged);
        if (currentRaw !== newRaw) {
          safeLocalStorageSet('aurora-notifications', newRaw);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-notifications', remote: true } }));
          }
        }
      } catch (err) {
        console.warn('[FIREBASE] Error merging customer notifications:', err);
      }
    };

    // C. Customer Notifications Query
    const targetNotifUserId = localUserId || fbUid;
    if (targetNotifUserId) {
      try {
        const qNotif = query(collection(db, 'notifications'), where('userId', '==', String(targetNotifUserId)));
        getDocs(qNotif).then(snap => {
          mergeCustomerNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }).catch(err => console.warn('[FIREBASE] Notif query notice:', err.message));

        onSnapshot(qNotif, snap => {
          mergeCustomerNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => console.warn('[FIREBASE] Notif listener notice:', err.message));
      } catch (err) {
        console.warn('[FIREBASE] Failed setting up customer notification query:', err);
      }
    }

    // D. Customer Profile Real-Time Listener (Keep Device B synchronized with Firebase updates from Device A)
    const custProfileEmail = activeCustomerUser?.email ? String(activeCustomerUser.email).trim().toLowerCase() : (auth?.currentUser?.email ? String(auth.currentUser.email).trim().toLowerCase() : '');
    const custProfileUid = fbUid;
    const custProfileLocalId = localUserId;

    if (custProfileLocalId || custProfileUid || custProfileEmail) {
      const applyAuthoritativeProfile = (docData) => {
        if (!docData) return;
        if (typeof window !== 'undefined' && window.__customerLogoutInProgress) return;
        if (typeof localStorage === 'undefined' || localStorage.getItem('aurora-logged-in') !== 'true') return;
        const rawCurrentLocal = localStorage.getItem('aurora-user');
        if (!rawCurrentLocal) return;
        try {
          const currentLocal = JSON.parse(rawCurrentLocal);
          if (!currentLocal || (!currentLocal.id && !currentLocal.email)) return;
          const remoteTime = docData.updatedAt ? new Date(docData.updatedAt).getTime() : 0;
          const localTime = currentLocal.updatedAt ? new Date(currentLocal.updatedAt).getTime() : 0;

          // Remote Firestore takes precedence if newer or if local is missing populated profile values
          const remoteIsNewer = remoteTime >= localTime;
          const localIsEmpty = (!currentLocal.phone && docData.phone) || (!currentLocal.address && (docData.address || docData.shippingAddress));

          if (remoteIsNewer || localIsEmpty) {
            const merged = {
              ...currentLocal,
              ...docData,
              fullName: docData.fullName || docData.name || currentLocal.fullName || currentLocal.name,
              name: docData.name || docData.fullName || currentLocal.name || currentLocal.fullName,
              phone: docData.phone || currentLocal.phone || '',
              phoneE164: docData.phoneE164 || currentLocal.phoneE164 || '',
              phoneVerified: docData.phoneVerified ?? (currentLocal.phoneVerified ?? false),
              address: docData.address || docData.shippingAddress || currentLocal.address || '',
              gender: docData.gender || currentLocal.gender || 'Female',
              profilePicture: docData.profilePicture || currentLocal.profilePicture || null,
              updatedAt: docData.updatedAt || currentLocal.updatedAt || new Date().toISOString()
            };

            const prevJson = JSON.stringify(currentLocal);
            const nextJson = JSON.stringify(merged);
            if (prevJson !== nextJson) {
              localStorage.setItem('aurora-user', nextJson);

              // Update aurora-users cache
              const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
              const uIdx = users.findIndex(u => (u.id && u.id === merged.id) || (u.email && String(u.email).toLowerCase() === String(merged.email).toLowerCase()));
              if (uIdx !== -1) {
                users[uIdx] = { ...users[uIdx], ...merged };
              } else {
                users.push(merged);
              }
              safeLocalStorageSet('aurora-users', JSON.stringify(users));

              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user', remote: true } }));
              }
            }
          }
        } catch (syncErr) {
          console.warn('[FIREBASE] Error applying remote profile sync:', syncErr);
        }
      };

      // Listen on users collection by ID
      if (custProfileLocalId) {
        try {
          onSnapshot(doc(db, 'users', custProfileLocalId), snap => {
            if (snap.exists()) applyAuthoritativeProfile(snap.data());
          }, err => console.warn('[FIREBASE] User profile listener error:', err.message));
        } catch (_) {}
      }
      // Listen on customers collection by ID
      if (custProfileLocalId) {
        try {
          onSnapshot(doc(db, 'customers', custProfileLocalId), snap => {
            if (snap.exists()) applyAuthoritativeProfile(snap.data());
          }, err => console.warn('[FIREBASE] Customer profile listener error:', err.message));
        } catch (_) {}
      }
    }
  }
  })();
  return firestoreSyncPromise;
}

// Secure helper to provision a staff Firebase Auth user using an isolated secondary App instance
// This guarantees the active administrator's authentication session is NEVER disrupted or signed out
// Using inMemoryPersistence prevents IndexedDB initialization and teardown from closing connections
export async function createStaffAuthAccount(email, password) {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    throw new Error('Firebase configuration not available');
  }
  const appName = `StaffAuth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  let secondaryAuth;
  try {
    secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
  } catch (_) {
    secondaryAuth = getAuth(secondaryApp);
  }
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user ? cred.user.uid : null;
    try {
      await deleteApp(secondaryApp);
    } catch (_) {}
    return uid;
  } catch (err) {
    try {
      await deleteApp(secondaryApp);
    } catch (_) {}
    throw err;
  }
}

// ---------------------- FIREBASE PHONE AUTHENTICATION & LINKING ----------------------

export function clearRecaptcha(containerId = 'recaptcha-container') {
  if (typeof window !== 'undefined' && window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch (_) {}
    window.recaptchaVerifier = null;
  }
  if (typeof document !== 'undefined') {
    const containerEl = document.getElementById(containerId);
    if (containerEl) {
      containerEl.innerHTML = '';
    }
  }
}

export function setupRecaptcha(containerId = 'recaptcha-container') {
  if (!auth) {
    throw new Error('Firebase Authentication is not available.');
  }

  // Clear existing verifier if container was destroyed or re-rendered
  clearRecaptcha(containerId);

  // Ensure element exists in DOM and is clean
  if (typeof document !== 'undefined') {
    let containerEl = document.getElementById(containerId);
    if (!containerEl) {
      containerEl = document.createElement('div');
      containerEl.id = containerId;
      document.body.appendChild(containerEl);
    } else {
      containerEl.innerHTML = '';
    }
  }

  window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      console.log('[FIREBASE PHONE AUTH] reCAPTCHA verified');
    },
    'expired-callback': () => {
      console.warn('[FIREBASE PHONE AUTH] reCAPTCHA expired, refresh required');
      clearRecaptcha(containerId);
    }
  });

  return window.recaptchaVerifier;
}

export async function sendFirebasePhoneVerification(phoneE164, containerId = 'recaptcha-container') {
  if (!auth) {
    throw new Error('Firebase Authentication is not initialized.');
  }
  let appVerifier;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      appVerifier = setupRecaptcha(containerId);
      const confirmationResult = await signInWithPhoneNumber(auth, phoneE164, appVerifier);
      return confirmationResult;
    } catch (err) {
      const msg = err?.message || String(err);
      if ((msg.includes('Database is closing') || msg.includes('closing/hidden')) && attempt < 1) {
        console.warn(`[FIREBASE PHONE AUTH] Database closing/hidden detected, retrying attempt ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 400));
        continue;
      }
      if (err.message && (err.message.includes('already been rendered') || err.code === 'auth/captcha-check-failed')) {
        console.warn('[FIREBASE PHONE AUTH] Retrying after clearing reCAPTCHA container...');
        clearRecaptcha(containerId);
        appVerifier = setupRecaptcha(containerId);
        return await signInWithPhoneNumber(auth, phoneE164, appVerifier);
      }
      throw err;
    }
  }
}

export async function verifyAndLinkPhoneCredential(confirmationResult, code, phoneE164) {
  if (!confirmationResult || !confirmationResult.verificationId) {
    throw new Error('Invalid or expired verification session. Please request a new code.');
  }
  const cleanCode = String(code || '').trim();
  if (!cleanCode || cleanCode.length !== 6) {
    throw new Error('Please enter a valid 6-digit verification code.');
  }

  const credential = PhoneAuthProvider.credential(confirmationResult.verificationId, cleanCode);

  if (auth && auth.currentUser) {
    try {
      await linkWithCredential(auth.currentUser, credential);
      console.log('[FIREBASE PHONE AUTH] Phone successfully linked to existing Firebase Auth user');
    } catch (linkErr) {
      if (linkErr.code === 'auth/credential-already-in-use' || linkErr.code === 'auth/provider-already-linked') {
        console.log('[FIREBASE PHONE AUTH] Credential already linked or registered:', linkErr.code);
      } else {
        console.warn('[FIREBASE PHONE AUTH] linkWithCredential notice:', linkErr.message);
        // Fallback confirm check to verify OTP code validity
        await confirmationResult.confirm(cleanCode);
      }
    }
  } else {
    await confirmationResult.confirm(cleanCode);
  }

  return true;
}

// Dedicated targeted writer for customer archive/restore state directly to Firestore
export async function setCustomerArchiveStatusInFirestore(clientOrId, isArchived) {
  if (!db) {
    console.warn('[FIREBASE] Firestore database is not initialized');
    throw new Error('Firestore database is not initialized');
  }

  const isArchivedBool = Boolean(isArchived);
  const statusStr = isArchivedBool ? 'Archived' : 'Active';
  const isActiveBool = !isArchivedBool;
  const nowIso = new Date().toISOString();

  let targetId = '';
  let targetEmail = '';
  let targetUid = '';
  let targetCustomerId = '';

  if (typeof clientOrId === 'object' && clientOrId !== null) {
    targetId = String(clientOrId.id || '').trim();
    targetEmail = String(clientOrId.email || '').trim().toLowerCase();
    targetUid = String(clientOrId.uid || clientOrId.firebaseUid || '').trim();
    targetCustomerId = String(clientOrId.customerId || '').trim();
  } else if (typeof clientOrId === 'string') {
    targetId = clientOrId.trim();
  }

  const payload = {
    isArchived: isArchivedBool,
    status: statusStr,
    isActive: isActiveBool,
    updatedAt: nowIso
  };

  const updatePromises = [];
  let successfulWrites = 0;
  let writeErrors = [];

  const executeWrite = (p, label) => {
    return p.then(() => {
      successfulWrites++;
    }).catch(err => {
      console.warn(`[FIREBASE] ${label} write error:`, err);
      writeErrors.push(err);
    });
  };

  // 1. Update customers collection by primary canonical document ID
  if (targetId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'customers', targetId), payload, { merge: true }), 'customers-id'));
  } else if (targetCustomerId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'customers', targetCustomerId), payload, { merge: true }), 'customers-cid'));
  }

  // 2. Update users collection by primary ID and UID
  if (targetId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'users', targetId), payload, { merge: true }), 'users-id'));
  }
  if (targetUid) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'users', targetUid), payload, { merge: true }), 'users-uid'));
    updatePromises.push(executeWrite(setDoc(doc(db, 'users', `user-${targetUid}`), payload, { merge: true }), 'users-user-uid'));
  }

  // 3. Query customers & users by email to ensure any document with that email is updated
  if (targetEmail) {
    try {
      const qCus = query(collection(db, 'customers'), where('email', '==', targetEmail));
      const cusSnaps = await getDocs(qCus);
      cusSnaps.forEach(dSnap => {
        updatePromises.push(executeWrite(setDoc(dSnap.ref, payload, { merge: true }), 'customers-email-match'));
      });
    } catch (e) {
      console.warn('[FIREBASE] Error querying customers by email for archive update:', e);
      writeErrors.push(e);
    }

    try {
      const qUsers = query(collection(db, 'users'), where('email', '==', targetEmail));
      const userSnaps = await getDocs(qUsers);
      userSnaps.forEach(dSnap => {
        updatePromises.push(executeWrite(setDoc(dSnap.ref, payload, { merge: true }), 'users-email-match'));
      });
    } catch (e) {
      console.warn('[FIREBASE] Error querying users by email for archive update:', e);
      writeErrors.push(e);
    }
  }

  // 4. Query customers by UID if available
  if (targetUid) {
    try {
      const qCusUid = query(collection(db, 'customers'), where('uid', '==', targetUid));
      const cusUidSnaps = await getDocs(qCusUid);
      cusUidSnaps.forEach(dSnap => {
        updatePromises.push(executeWrite(setDoc(dSnap.ref, payload, { merge: true }), 'customers-uid-query'));
      });
    } catch (e) {
      console.warn('[FIREBASE] Error querying customers by uid for archive update:', e);
      writeErrors.push(e);
    }
  }

  await Promise.all(updatePromises);

  if (successfulWrites === 0 && writeErrors.length > 0) {
    throw writeErrors[0];
  }

  return true;
}

// Dedicated authoritative checker for customer archive state in Firestore
export async function checkCustomerArchivedInFirestore(email, firebaseUid) {
  if (!db) {
    return { isArchived: false };
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanUid = String(firebaseUid || '').trim();

  try {
    let latestDoc = null;
    let latestTime = -1;

    function evaluateDoc(data, source) {
      if (!data) return;
      const t = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
      if (latestDoc === null || t >= latestTime) {
        latestTime = t;
        latestDoc = { isArchived: data.isArchived === true, source, data };
      }
    }

    const tasks = [];

    // 1. Check direct doc in 'users' by cleanUid
    if (cleanUid) {
      tasks.push(
        getDoc(doc(db, 'users', cleanUid))
          .then(uSnap => { if (uSnap.exists()) evaluateDoc(uSnap.data(), 'users-uid'); })
          .catch(() => {})
      );
      tasks.push(
        getDoc(doc(db, 'users', `user-${cleanUid}`))
          .then(uSnap2 => { if (uSnap2.exists()) evaluateDoc(uSnap2.data(), 'users-user-uid'); })
          .catch(() => {})
      );
    }

    // 2. Check query 'users' by email
    if (cleanEmail) {
      tasks.push(
        getDocs(query(collection(db, 'users'), where('email', '==', cleanEmail)))
          .then(userSnaps => {
            for (const docSnap of userSnaps.docs) {
              evaluateDoc(docSnap.data(), 'users-email');
            }
          })
          .catch(() => {})
      );
    }

    // 3. Check direct doc in 'customers' by cleanUid
    if (cleanUid) {
      tasks.push(
        getDoc(doc(db, 'customers', cleanUid))
          .then(cSnap => { if (cSnap.exists()) evaluateDoc(cSnap.data(), 'customers-uid'); })
          .catch(() => {})
      );
    }

    // 4. Check query 'customers' by email
    if (cleanEmail) {
      tasks.push(
        getDocs(query(collection(db, 'customers'), where('email', '==', cleanEmail)))
          .then(custSnaps => {
            for (const docSnap of custSnaps.docs) {
              evaluateDoc(docSnap.data(), 'customers-email');
            }
          })
          .catch(() => {})
      );
    }

    // 5. Check query 'customers' by uid
    if (cleanUid) {
      tasks.push(
        getDocs(query(collection(db, 'customers'), where('uid', '==', cleanUid)))
          .then(custUidSnaps => {
            for (const docSnap of custUidSnaps.docs) {
              evaluateDoc(docSnap.data(), 'customers-uid-field');
            }
          })
          .catch(() => {})
      );
    }

    await Promise.all(tasks);

    if (latestDoc) {
      return latestDoc;
    }

    return { isArchived: false };
  } catch (err) {
    console.warn('[FIREBASE] Error checking customer archive status in Firestore:', err);
    return { isArchived: false, error: err };
  }
}

// Authoritatively fetch customer profile from Firestore (users & customers collections)
export async function fetchCustomerProfileFromFirestore(email, firebaseUid, userId) {
  if (!db) return null;

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanUid = String(firebaseUid || '').trim();
  const cleanUserId = String(userId || '').trim();

  try {
    const candidateDocs = [];

    const addCandidate = (docSnap, col) => {
      if (docSnap && docSnap.exists()) {
        candidateDocs.push({ ...docSnap.data(), _firestoreCol: col, _docId: docSnap.id });
      }
    };

    const tasks = [];

    // 1. Search 'users' collection
    if (cleanUserId) {
      tasks.push(getDoc(doc(db, 'users', cleanUserId)).then(snap => addCandidate(snap, 'users')).catch(() => {}));
    }
    if (cleanUid) {
      tasks.push(getDoc(doc(db, 'users', cleanUid)).then(snap => addCandidate(snap, 'users')).catch(() => {}));
      tasks.push(getDoc(doc(db, 'users', `user-${cleanUid}`)).then(snap => addCandidate(snap, 'users')).catch(() => {}));
      tasks.push(
        getDocs(query(collection(db, 'users'), where('firebaseUid', '==', cleanUid)))
          .then(uidSnaps => uidSnaps.forEach(d => addCandidate(d, 'users')))
          .catch(() => {})
      );
    }
    if (cleanEmail) {
      tasks.push(
        getDocs(query(collection(db, 'users'), where('email', '==', cleanEmail)))
          .then(emailSnaps => emailSnaps.forEach(d => addCandidate(d, 'users')))
          .catch(() => {})
      );
    }

    // 2. Search 'customers' collection
    if (cleanUserId) {
      tasks.push(getDoc(doc(db, 'customers', cleanUserId)).then(snap => addCandidate(snap, 'customers')).catch(() => {}));
    }
    if (cleanUid) {
      tasks.push(getDoc(doc(db, 'customers', cleanUid)).then(snap => addCandidate(snap, 'customers')).catch(() => {}));
      tasks.push(getDoc(doc(db, 'customers', `user-${cleanUid}`)).then(snap => addCandidate(snap, 'customers')).catch(() => {}));
      tasks.push(
        getDocs(query(collection(db, 'customers'), where('uid', '==', cleanUid)))
          .then(custSnaps => custSnaps.forEach(d => addCandidate(d, 'customers')))
          .catch(() => {})
      );
      tasks.push(
        getDocs(query(collection(db, 'customers'), where('firebaseUid', '==', cleanUid)))
          .then(custSnaps => custSnaps.forEach(d => addCandidate(d, 'customers')))
          .catch(() => {})
      );
    }
    if (cleanEmail) {
      tasks.push(
        getDocs(query(collection(db, 'customers'), where('email', '==', cleanEmail)))
          .then(custSnaps => custSnaps.forEach(d => addCandidate(d, 'customers')))
          .catch(() => {})
      );
    }

    await Promise.all(tasks);

    if (candidateDocs.length === 0) return null;

    // Sort candidates by updatedAt descending
    const sorted = candidateDocs.sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    });

    // Determine canonical user ID
    let canonicalId = '';
    const numericUserDoc = sorted.find(d => d.id && /^user-\d+$/.test(d.id));
    if (numericUserDoc) {
      canonicalId = numericUserDoc.id;
    } else {
      const anyWithId = sorted.find(d => d.id && !d.id.startsWith('CUS-'));
      canonicalId = anyWithId ? anyWithId.id : (sorted[0].id || sorted[0]._docId);
    }

    let fullName = '';
    let name = '';
    let phone = '';
    let phoneE164 = '';
    let phoneVerified = false;
    let address = '';
    let gender = '';
    let profilePicture = null;
    let emailVal = cleanEmail;
    let customerId = '';
    let totalSpent = 0;
    let isArchived = false;
    let recentOrders = [];
    let role = 'customer';
    let latestUpdatedAt = '';

    for (const docItem of sorted) {
      if (!fullName && docItem.fullName && docItem.fullName.length > 2 && docItem.fullName !== cleanEmail.split('@')[0]) {
        fullName = docItem.fullName;
      }
      if (!name && docItem.name && docItem.name.length > 2 && docItem.name !== cleanEmail.split('@')[0]) {
        name = docItem.name;
      }
      if (!phone && docItem.phone) phone = docItem.phone;
      if (!phoneE164 && docItem.phoneE164) phoneE164 = docItem.phoneE164;
      if (docItem.phoneVerified === true) phoneVerified = true;
      if (!address && (docItem.address || docItem.shippingAddress)) {
        address = docItem.address || docItem.shippingAddress;
      }
      if (!gender && docItem.gender) gender = docItem.gender;
      if (!profilePicture && docItem.profilePicture) profilePicture = docItem.profilePicture;
      if (!emailVal && docItem.email) emailVal = String(docItem.email).trim().toLowerCase();
      if (!customerId && docItem.customerId && docItem.customerId.startsWith('CUS-')) customerId = docItem.customerId;
      if (docItem.totalSpent && !isNaN(parseFloat(docItem.totalSpent))) {
        totalSpent = Math.max(totalSpent, parseFloat(docItem.totalSpent));
      }
      if (docItem.isArchived === true) isArchived = true;
      if (Array.isArray(docItem.recentOrders) && docItem.recentOrders.length > recentOrders.length) {
        recentOrders = docItem.recentOrders;
      }
      if (docItem.role) role = docItem.role;
      if (!latestUpdatedAt && docItem.updatedAt) latestUpdatedAt = docItem.updatedAt;
    }

    if (!fullName) {
      const anyName = sorted.find(d => d.fullName || d.name);
      fullName = anyName ? (anyName.fullName || anyName.name) : (emailVal ? emailVal.split('@')[0] : 'Customer');
    }
    if (!name) name = fullName;
    if (!gender) gender = 'Female';

    return {
      id: canonicalId || (cleanUid ? `user-${cleanUid}` : `user-${Date.now()}`),
      firebaseUid: cleanUid || sorted[0].firebaseUid || sorted[0].uid || null,
      customerId: customerId || 'CUS-000001',
      fullName,
      name,
      email: emailVal,
      phone,
      phoneE164,
      phoneVerified,
      address,
      shippingAddress: address,
      gender,
      profilePicture,
      totalSpent,
      isArchived,
      status: isArchived ? 'Archived' : 'Active',
      isActive: !isArchived,
      recentOrders,
      role,
      updatedAt: latestUpdatedAt || new Date().toISOString()
    };
  } catch (err) {
    console.warn('[FIREBASE] Error fetching customer profile from Firestore:', err);
    return null;
  }
}

// Authoritatively save customer profile to Firestore (users & customers collections)
export async function saveCustomerProfileToFirestore(profileData) {
  if (!db) {
    throw new Error('Database is not initialized.');
  }

  const cleanEmail = String(profileData.email || '').trim().toLowerCase();
  const cleanUid = String(profileData.firebaseUid || profileData.uid || '').trim();
  const cleanId = String(profileData.id || '').trim();

  if (!cleanEmail && !cleanUid && !cleanId) {
    throw new Error('Cannot save profile without a valid user identifier.');
  }

  const updatedAt = profileData.updatedAt || new Date().toISOString();

  const userPayload = {
    id: cleanId || (cleanUid ? `user-${cleanUid}` : undefined),
    firebaseUid: cleanUid || undefined,
    email: cleanEmail,
    fullName: profileData.fullName || profileData.name || '',
    name: profileData.fullName || profileData.name || '',
    phone: profileData.phone || '',
    phoneE164: profileData.phoneE164 || '',
    phoneVerified: profileData.phoneVerified ?? false,
    address: profileData.address || profileData.shippingAddress || '',
    gender: profileData.gender || 'Female',
    profilePicture: profileData.profilePicture || null,
    role: profileData.role || 'customer',
    updatedAt
  };

  const customerPayload = {
    id: cleanId,
    customerId: profileData.customerId || undefined,
    uid: cleanUid || undefined,
    email: cleanEmail,
    fullName: profileData.fullName || profileData.name || '',
    name: profileData.fullName || profileData.name || '',
    phone: profileData.phone || '',
    phoneE164: profileData.phoneE164 || '',
    phoneVerified: profileData.phoneVerified ?? false,
    address: profileData.address || profileData.shippingAddress || '',
    shippingAddress: profileData.address || profileData.shippingAddress || '',
    gender: profileData.gender || 'Female',
    profilePicture: profileData.profilePicture || null,
    updatedAt
  };

  // Strip undefined values for Firestore serialization
  const cleanUserObj = JSON.parse(JSON.stringify(userPayload));
  const cleanCustObj = JSON.parse(JSON.stringify(customerPayload));

  const writePromises = [];

  // Write to users collection
  if (cleanId) {
    writePromises.push(setDoc(doc(db, 'users', cleanId), cleanUserObj, { merge: true }));
  }
  if (cleanUid && cleanUid !== cleanId) {
    writePromises.push(setDoc(doc(db, 'users', cleanUid), cleanUserObj, { merge: true }));
    writePromises.push(setDoc(doc(db, 'users', `user-${cleanUid}`), cleanUserObj, { merge: true }));
  }

  // Write to customers collection (using canonical document ID)
  if (cleanId) {
    writePromises.push(setDoc(doc(db, 'customers', cleanId), cleanCustObj, { merge: true }));
  }

  // Await ALL Firestore writes!
  await Promise.all(writePromises);
  return true;
}

