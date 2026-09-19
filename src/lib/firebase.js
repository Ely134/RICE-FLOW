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
  where
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { DEFAULT_PRODUCTS, safeLocalStorageSet } from '../app/shared.js';

let app;
let db;
let auth;

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

  console.log('[FIREBASE] Firestore and Auth initialized successfully with database ID:', firebaseConfig.firestoreDatabaseId);
} catch (err) {
  console.error('[FIREBASE] Failed to initialize Firebase:', err);
}

// Validate connection to Firestore per platform specifications
async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
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

export { app, db, auth };

// Helper to save a document to Firestore
export async function saveFirestoreDoc(colName, docId, data) {
  if (!db || !docId) {
    console.warn(`[FIREBASE] Missing db or docId for ${colName}/${docId}`);
    return false;
  }
  try {
    // Sanitize object to avoid undefined fields or custom class instances
    const cleanData = JSON.parse(JSON.stringify(data));
    const docRef = doc(db, colName, String(docId));
    await setDoc(docRef, cleanData, { merge: true });
    return true;
  } catch (err) {
    console.warn(`[FIREBASE] Error saving document to ${colName}/${docId}:`, err);
    throw err;
  }
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

    // One-time safe migration: check if any legitimate local reviews are missing from Firestore
    let localData = [];
    try {
      localData = JSON.parse(localStorage.getItem('aurora-reviews') || '[]');
      if (!Array.isArray(localData)) localData = [];
    } catch (e) {
      localData = [];
    }
    localData = localData.filter(r => !isFake(r));

    const remoteIds = new Set(cleanRemote.map(d => String(d.id)));
    for (const r of localData) {
      if (r && r.id && !remoteIds.has(String(r.id))) {
        try {
          await saveFirestoreDoc('reviews', r.id, r);
          cleanRemote.push(r);
          remoteIds.add(String(r.id));
        } catch (mErr) {
          console.warn('[FIREBASE] Error migrating local review to Firestore:', mErr);
        }
      }
    }

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
    let cleanRemote = [];
    if (Array.isArray(docs)) {
      cleanRemote = docs.filter(l => l && (l.id || l.action || l.category));
    }

    // One-time safe migration: check if any legitimate local activity logs are missing from Firestore
    let localData = [];
    try {
      localData = JSON.parse(localStorage.getItem('aurora-activity-logs') || '[]');
      if (!Array.isArray(localData)) localData = [];
    } catch (e) {
      localData = [];
    }
    localData = localData.filter(l => l && (l.id || l.action || l.category));

    const remoteIds = new Set(cleanRemote.map(d => String(d.id)));
    for (const l of localData) {
      if (l && l.id && !remoteIds.has(String(l.id))) {
        try {
          await saveFirestoreDoc('activityLogs', l.id, l);
          cleanRemote.push(l);
          remoteIds.add(String(l.id));
        } catch (mErr) {
          console.warn('[FIREBASE] Error migrating local activity log to Firestore:', mErr);
        }
      }
    }

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
      items.push({ id: docSnap.id, ...docSnap.data() });
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
        items.push({ id: docSnap.id, ...docSnap.data() });
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

// Helper to safely merge remote documents into local array by document ID to prevent catalog wipeouts
function mergeCollectionsById(localItems, remoteItems) {
  if (!Array.isArray(localItems)) localItems = [];
  if (!Array.isArray(remoteItems)) remoteItems = [];

  const mergedMap = new Map();
  localItems.forEach(item => {
    if (item && item.id !== undefined && item.id !== null) {
      mergedMap.set(String(item.id), { ...item });
    }
  });

  remoteItems.forEach(rItem => {
    if (rItem && rItem.id !== undefined && rItem.id !== null) {
      const key = String(rItem.id);
      const existing = mergedMap.get(key);
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
export function mergeGenericCollections(colName, localList = [], remoteList = []) {
  if (!Array.isArray(localList)) localList = [];
  if (!Array.isArray(remoteList)) remoteList = [];

  if (colName === 'notifications') {
    return mergeNotificationLists(localList, remoteList);
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

  const map = new Map();

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

  // 1. Seed with local records
  localList.forEach((item) => {
    if (!item) return;

    const key = getRecordKey(item);

    if (key) {
      map.set(key, { ...item });
    }
  });

  // 2. Merge remote records
  remoteList.forEach((rItem) => {
    if (!rItem) return;

    const key = getRecordKey(rItem);

    if (!key) return;

    const existing = map.get(key);

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

        const localUpdatedAt = existing.updatedAt
          ? new Date(existing.updatedAt).getTime()
          : 0;

        const remoteUpdatedAt = rItem.updatedAt
          ? new Date(rItem.updatedAt).getTime()
          : 0;

        const localIsNewer =
          localUpdatedAt > remoteUpdatedAt;

        const localHasMoreAllocation =
          localAllocated > remoteAllocated;

        // Keep the local version when it contains newer
        // allocation information.
        if (localIsNewer || localHasMoreAllocation) {
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

        // Deduplicate and merge recent orders
        const ordersMap = new Map();
        (existing.recentOrders || []).forEach(o => { if (o && o.id) ordersMap.set(String(o.id), o); });
        (rItem.recentOrders || []).forEach(o => { if (o && o.id) ordersMap.set(String(o.id), o); });

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
        // Non-order collections use normal merging.
        map.set(key, {
          ...existing,
          ...rItem
        });
      }

    } else {
      // No matching local record.
      // Keep the remote record.
      map.set(key, {
        ...rItem
      });
    }
  });

  if (colName === 'activityLogs') {
    return sortActivityLogsDesc(Array.from(map.values()));
  }

  return Array.from(map.values());
}

// Universal notification reconciler ensuring permanent read status persistence & deduplication
export function mergeNotificationLists(localList = [], remoteList = []) {
  const notifsMap = new Map();

  // 1. Seed with local notifications
  if (Array.isArray(localList)) {
    localList.forEach(n => {
      if (!n) return;
      const key = String(n.id || n.notificationId || n.eventKey || '');
      if (key) {
        const isRead = Boolean(n.read === true || n.isRead === true);
        notifsMap.set(key, { ...n, read: isRead, isRead: isRead });
      }
    });
  }

  // 2. Merge remote notifications (Never let remote unread overwrite a local read state!)
  if (Array.isArray(remoteList)) {
    remoteList.forEach(r => {
      if (!r) return;
      const key = String(r.id || r.notificationId || r.eventKey || '');
      if (key) {
        const existing = notifsMap.get(key);
        if (existing) {
          const isRead = Boolean(existing.read || existing.isRead || r.read || r.isRead);
          notifsMap.set(key, {
            ...existing,
            ...r,
            read: isRead,
            isRead: isRead
          });
        } else {
          const isRead = Boolean(r.read || r.isRead);
          notifsMap.set(key, {
            ...r,
            read: isRead,
            isRead: isRead
          });
        }
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

// Initialize Firestore synchronization with role-aware security boundaries
let firestoreSyncPromise = null;

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
    const raw = localStorage.getItem('aurora-user');
    if (raw) currentUser = JSON.parse(raw);
  } catch (e) {
    console.warn('[FIREBASE] Error reading aurora-user cache:', e);
  }

  // 1. PUBLIC COLLECTIONS — Synced for all visitors (Guests, Customers, Staff, Admin)
  const publicCollections = [
    { col: 'products', key: 'aurora-products' },
    { col: 'reviews', key: 'aurora-reviews' },
    { col: 'storeSettings', key: 'aurora-store-settings' },
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

      let localData = JSON.parse(localStorage.getItem(key) || '[]');
      if (col === 'products' && typeof DEFAULT_PRODUCTS !== 'undefined') {
        DEFAULT_PRODUCTS.forEach(dp => {
          if (!localData.some(p => String(p.id) === String(dp.id))) {
            localData.push(dp);
          }
        });
      }

      const docs = await fetchFirestoreCollection(col);
      if (docs && docs.length > 0) {
        if (col === 'products') {
          const merged = mergeCollectionsById(localData, docs);
          safeLocalStorageSet(key, JSON.stringify(merged));

          // Upload any missing products to Firestore
          const remoteIds = new Set(docs.map(d => String(d.id)));
          for (const p of merged) {
            if (!remoteIds.has(String(p.id))) {
              saveFirestoreDoc('products', p.id, p);
            }
          }
        } else {
          const merged = mergeGenericCollections(col, localData, docs);
          safeLocalStorageSet(key, JSON.stringify(merged));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key, remote: true } }));
          }
        }
      } else {
        if (Array.isArray(localData) && localData.length > 0) {
          safeLocalStorageSet(key, JSON.stringify(localData));
          saveFirestoreCollection(col, localData);
        }
      }

      subscribeToFirestoreCollection(col, (remoteItems) => {
        if (remoteItems && remoteItems.length > 0) {
          const currentLocal = JSON.parse(localStorage.getItem(key) || '[]');
          let merged = remoteItems;
          if (col === 'products') {
            merged = mergeCollectionsById(currentLocal.length > 0 ? currentLocal : localData, remoteItems);
            if (typeof DEFAULT_PRODUCTS !== 'undefined') {
              DEFAULT_PRODUCTS.forEach(dp => {
                if (!merged.some(p => String(p.id) === String(dp.id))) {
                  merged.push(dp);
                }
              });
            }
          } else {
            merged = mergeGenericCollections(col, currentLocal, remoteItems);
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

  // 2. STAFF / ADMIN — Operational collections required by admin dashboard
  if (isAdmin) {
    const adminCollections = [
      { col: 'users', key: 'aurora-users' },
      { col: 'adminUsers', key: 'aurora-admin-users' },
      { col: 'customers', key: 'aurora-customers' },
      { col: 'orders', key: 'aurora-orders' },
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

  // 3. CUSTOMER — Role-scoped targeted sync for customer's own records
  if (isCustomerLoggedIn || auth?.currentUser) {
    const fbUid = auth?.currentUser?.uid || currentUser?.firebaseUid;
    const localUserId = currentUser?.id;

    // Helper to merge customer orders into localStorage
    const mergeCustomerOrders = (remoteDocs) => {
      if (!remoteDocs || !Array.isArray(remoteDocs) || remoteDocs.length === 0) return;
      try {
        const localOrders = JSON.parse(localStorage.getItem('aurora-orders') || '[]');
        const merged = mergeGenericCollections('orders', localOrders, remoteDocs);
        const currentRaw = localStorage.getItem('aurora-orders');
        const newRaw = JSON.stringify(merged);
        if (currentRaw !== newRaw) {
          safeLocalStorageSet('aurora-orders', newRaw);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders', remote: true } }));
            window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { key: 'aurora-orders' } }));
          }
        }
      } catch (err) {
        console.warn('[FIREBASE] Error merging customer orders:', err);
      }
    };

    // A. Customer Orders Query 1: RiceFlow userId (e.g. user-XXXXXXXXXX)
    if (localUserId) {
      try {
        const qUser = query(collection(db, 'orders'), where('userId', '==', String(localUserId)));
        getDocs(qUser).then(snap => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          mergeCustomerOrders(docs);
        }).catch(err => console.warn('[FIREBASE] Order userId query notice:', err.message));

        onSnapshot(qUser, snap => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          mergeCustomerOrders(docs);
        }, err => console.warn('[FIREBASE] Order userId listener notice:', err.message));
      } catch (err) {
        console.warn('[FIREBASE] Failed setting up order userId query:', err);
      }
    }

    // B. Customer Orders Query 2: Firebase Auth UID (firebaseUid)
    if (fbUid && fbUid !== localUserId) {
      try {
        const qFb = query(collection(db, 'orders'), where('firebaseUid', '==', String(fbUid)));
        getDocs(qFb).then(snap => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          mergeCustomerOrders(docs);
        }).catch(err => console.warn('[FIREBASE] Order firebaseUid query notice:', err.message));

        onSnapshot(qFb, snap => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          mergeCustomerOrders(docs);
        }, err => console.warn('[FIREBASE] Order firebaseUid listener notice:', err.message));
      } catch (err) {
        console.warn('[FIREBASE] Failed setting up order firebaseUid query:', err);
      }
    }

    // Helper to merge customer notifications
    const mergeCustomerNotifs = (remoteDocs) => {
      if (!remoteDocs || !Array.isArray(remoteDocs) || remoteDocs.length === 0) return;
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
    const custProfileEmail = currentUser?.email ? String(currentUser.email).trim().toLowerCase() : (auth?.currentUser?.email ? String(auth.currentUser.email).trim().toLowerCase() : '');
    const custProfileUid = fbUid;
    const custProfileLocalId = localUserId;

    if (custProfileLocalId || custProfileUid || custProfileEmail) {
      const applyAuthoritativeProfile = (docData) => {
        if (!docData) return;
        try {
          const currentLocal = JSON.parse(localStorage.getItem('aurora-user') || '{}');
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

  // 1. Update customers collection by primary ID
  if (targetId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'customers', targetId), payload, { merge: true }), 'customers-id'));
  }
  if (targetCustomerId && targetCustomerId !== targetId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'customers', targetCustomerId), payload, { merge: true }), 'customers-cid'));
  }
  if (targetUid && targetUid !== targetId) {
    updatePromises.push(executeWrite(setDoc(doc(db, 'customers', targetUid), payload, { merge: true }), 'customers-uid'));
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

    // 1. Check direct doc in 'users' by cleanUid
    if (cleanUid) {
      try {
        const uSnap = await getDoc(doc(db, 'users', cleanUid));
        if (uSnap.exists()) evaluateDoc(uSnap.data(), 'users-uid');
      } catch (_) {}

      try {
        const uSnap2 = await getDoc(doc(db, 'users', `user-${cleanUid}`));
        if (uSnap2.exists()) evaluateDoc(uSnap2.data(), 'users-user-uid');
      } catch (_) {}
    }

    // 2. Check query 'users' by email
    if (cleanEmail) {
      try {
        const qUsers = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const userSnaps = await getDocs(qUsers);
        for (const docSnap of userSnaps.docs) {
          evaluateDoc(docSnap.data(), 'users-email');
        }
      } catch (_) {}
    }

    // 3. Check direct doc in 'customers' by cleanUid
    if (cleanUid) {
      try {
        const cSnap = await getDoc(doc(db, 'customers', cleanUid));
        if (cSnap.exists()) evaluateDoc(cSnap.data(), 'customers-uid');
      } catch (_) {}
    }

    // 4. Check query 'customers' by email
    if (cleanEmail) {
      try {
        const qCust = query(collection(db, 'customers'), where('email', '==', cleanEmail));
        const custSnaps = await getDocs(qCust);
        for (const docSnap of custSnaps.docs) {
          evaluateDoc(docSnap.data(), 'customers-email');
        }
      } catch (_) {}
    }

    // 5. Check query 'customers' by uid
    if (cleanUid) {
      try {
        const qCustUid = query(collection(db, 'customers'), where('uid', '==', cleanUid));
        const custUidSnaps = await getDocs(qCustUid);
        for (const docSnap of custUidSnaps.docs) {
          evaluateDoc(docSnap.data(), 'customers-uid-field');
        }
      } catch (_) {}
    }

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

    // 1. Search 'users' collection
    if (cleanUserId) {
      try {
        const snap = await getDoc(doc(db, 'users', cleanUserId));
        addCandidate(snap, 'users');
      } catch (_) {}
    }
    if (cleanUid) {
      try {
        const snap1 = await getDoc(doc(db, 'users', cleanUid));
        addCandidate(snap1, 'users');
      } catch (_) {}
      try {
        const snap2 = await getDoc(doc(db, 'users', `user-${cleanUid}`));
        addCandidate(snap2, 'users');
      } catch (_) {}
      try {
        const qUsersUid = query(collection(db, 'users'), where('firebaseUid', '==', cleanUid));
        const uidSnaps = await getDocs(qUsersUid);
        uidSnaps.forEach(d => addCandidate(d, 'users'));
      } catch (_) {}
    }
    if (cleanEmail) {
      try {
        const qUsersEmail = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const emailSnaps = await getDocs(qUsersEmail);
        emailSnaps.forEach(d => addCandidate(d, 'users'));
      } catch (_) {}
    }

    // 2. Search 'customers' collection
    if (cleanUserId) {
      try {
        const snap = await getDoc(doc(db, 'customers', cleanUserId));
        addCandidate(snap, 'customers');
      } catch (_) {}
    }
    if (cleanUid) {
      try {
        const snap1 = await getDoc(doc(db, 'customers', cleanUid));
        addCandidate(snap1, 'customers');
      } catch (_) {}
      try {
        const snap2 = await getDoc(doc(db, 'customers', `user-${cleanUid}`));
        addCandidate(snap2, 'customers');
      } catch (_) {}
      try {
        const qCustUid = query(collection(db, 'customers'), where('uid', '==', cleanUid));
        const custSnaps = await getDocs(qCustUid);
        custSnaps.forEach(d => addCandidate(d, 'customers'));
      } catch (_) {}
    }
    if (cleanEmail) {
      try {
        const qCustEmail = query(collection(db, 'customers'), where('email', '==', cleanEmail));
        const custSnaps = await getDocs(qCustEmail);
        custSnaps.forEach(d => addCandidate(d, 'customers'));
      } catch (_) {}
    }

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

