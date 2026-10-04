// RiceFlow: Shared Database & layout UI Engine
// Coordinates localStorage databases, authentication, user queues, and dynamically renders standard components

if (typeof window !== 'undefined') {
  function isResizeObserverLoopError(msg) {
    return typeof msg === 'string' && (
      msg.indexOf('ResizeObserver loop') !== -1 ||
      msg.indexOf('ResizeObserver loop completed with undelivered notifications') !== -1 ||
      msg.indexOf('ResizeObserver loop limit exceeded') !== -1
    );
  }

  window.addEventListener('error', function(event) {
    const msg = event?.message || (event?.error && event.error.message) || (typeof event === 'string' ? event : '');
    if (isResizeObserverLoopError(msg)) {
      event.stopImmediatePropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return true;
    }
  }, true);

  const prevOnError = window.onerror;
  window.onerror = function(msg, source, lineno, colno, error) {
    if (isResizeObserverLoopError(msg) || (error && isResizeObserverLoopError(error.message))) {
      return true;
    }
    if (typeof prevOnError === 'function') {
      return prevOnError.apply(this, arguments);
    }
    return false;
  };
}

import { 
  saveFirestoreDoc, 
  saveFirestoreCollection, 
  fetchFirestoreCollection,
  saveContactMessageDoc,
  saveReviewDoc,
  syncReviewsFromFirestore,
  saveActivityLogDoc,
  syncActivityLogsFromFirestore,
  sortActivityLogsDesc,
  mergeGenericCollections,
  initFirestoreSync,
  createStaffAuthAccount,
  sendFirebasePhoneVerification,
  verifyAndLinkPhoneCredential,
  fetchAdminUserFromFirestore,
  setCustomerArchiveStatusInFirestore,
  checkCustomerArchivedInFirestore,
  fetchCustomerProfileFromFirestore,
  saveCustomerProfileToFirestore,
  auth,
  storage,
  isStaleOrderOrReservation,
  isStaleInventoryHistory,
  isStaleNotification,
  isStaleProduct,
  isStaleCustomer,
  isStaleUser,
  isOrdersHydrated,
  RESET_TIMESTAMP_BOUNDARY,
  CONFIRMED_STALE_ORDER_IDS,
  CONFIRMED_STALE_RESERVATION_IDS,
  registerPendingOrderWrite,
  unregisterPendingOrderWrite,
  syncOrdersFromFirestore,
  syncStoreSettingsFromFirestore
} from '../lib/firebase.js';

export { 
  saveFirestoreDoc,
  initFirestoreSync,
  syncStoreSettingsFromFirestore,
  createStaffAuthAccount, 
  sendFirebasePhoneVerification, 
  verifyAndLinkPhoneCredential, 
  saveReviewDoc, 
  syncReviewsFromFirestore,
  saveActivityLogDoc,
  syncActivityLogsFromFirestore,
  sortActivityLogsDesc,
  setCustomerArchiveStatusInFirestore,
  checkCustomerArchivedInFirestore,
  fetchCustomerProfileFromFirestore,
  saveCustomerProfileToFirestore,
  storage,
  isStaleCustomer,
  isStaleUser,
  isOrdersHydrated,
  registerPendingOrderWrite,
  unregisterPendingOrderWrite,
  syncOrdersFromFirestore
};
import {
  waitForAuthState,
  fetchAuthoritativeAdminRecord,
  checkAdminAuth,
  protectAdminPage,
  checkCustomerAuth,
  protectCustomerPage,
  revealProtectedPage,
  getGuardPathPrefix
} from '../lib/auth-guard.js';

export {
  waitForAuthState,
  fetchAuthoritativeAdminRecord,
  checkAdminAuth,
  protectAdminPage,
  checkCustomerAuth,
  protectCustomerPage,
  revealProtectedPage,
  getGuardPathPrefix
};
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
} from 'firebase/auth';

// Utility: Compress image file via offscreen canvas
export function compressImageFile(file, maxDimension = 200, quality = 0.75) {
  return new Promise((resolve) => {
    if (!file || !(file instanceof Blob) || !file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(event.target.result);
      img.src = event.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Emergency cleanup when localStorage quota is reached
export function performEmergencyStorageCleanup() {
  if (typeof localStorage === 'undefined') return;
  try {
    // 1. Clean order images (large payment proofs and qr proofs)
    const rawOrders = localStorage.getItem('aurora-orders');
    if (rawOrders) {
      try {
        const orders = JSON.parse(rawOrders);
        if (Array.isArray(orders)) {
          let modified = false;
          orders.forEach(o => {
            if (o.paymentProofDataUrl && typeof o.paymentProofDataUrl === 'string' && o.paymentProofDataUrl.startsWith('data:') && o.paymentProofDataUrl.length > 500) {
              o.paymentProofDataUrl = '';
              modified = true;
            }
            if (o.qrProof && typeof o.qrProof === 'string' && o.qrProof.startsWith('data:') && o.qrProof.length > 500) {
              o.qrProof = '';
              modified = true;
            }
          });
          if (modified) {
            localStorage.setItem('aurora-orders', JSON.stringify(orders));
          }
        }
      } catch (err) {
        console.warn('[STORAGE] Cleanup orders notice:', err);
      }
    }

    // 2. Clean user avatars if oversized (>25KB)
    const rawUsers = localStorage.getItem('aurora-users');
    if (rawUsers) {
      try {
        const users = JSON.parse(rawUsers);
        if (Array.isArray(users)) {
          let modified = false;
          users.forEach(u => {
            if (u.profilePicture && typeof u.profilePicture === 'string' && u.profilePicture.startsWith('data:') && u.profilePicture.length > 25000) {
              u.profilePicture = '';
              modified = true;
            }
            if (u.avatar && typeof u.avatar === 'string' && u.avatar.startsWith('data:') && u.avatar.length > 25000) {
              u.avatar = '';
              modified = true;
            }
          });
          if (modified) {
            localStorage.setItem('aurora-users', JSON.stringify(users));
          }
        }
      } catch (err) {
        console.warn('[STORAGE] Cleanup users notice:', err);
      }
    }

    // 3. Clean customer avatars if oversized
    const rawCusts = localStorage.getItem('aurora-customers');
    if (rawCusts) {
      try {
        const custs = JSON.parse(rawCusts);
        if (Array.isArray(custs)) {
          let modified = false;
          custs.forEach(c => {
            if (c.avatar && typeof c.avatar === 'string' && c.avatar.startsWith('data:') && c.avatar.length > 25000) {
              c.avatar = '';
              modified = true;
            }
            if (c.profilePicture && typeof c.profilePicture === 'string' && c.profilePicture.startsWith('data:') && c.profilePicture.length > 25000) {
              c.profilePicture = '';
              modified = true;
            }
          });
          if (modified) {
            localStorage.setItem('aurora-customers', JSON.stringify(custs));
          }
        }
      } catch (err) {
        console.warn('[STORAGE] Cleanup customers notice:', err);
      }
    }

    // 4. Clean non-essential scratch keys if needed
    // Business records (orders, customers, products, inventory history, notifications, activity logs) are NEVER trimmed or deleted to solve storage pressure!
  } catch (err) {
    console.warn('[STORAGE] performEmergencyStorageCleanup error:', err);
  }
}

// Sanitize payload before writing to prevent storage bloat
export function sanitizeStoragePayload(key, value) {
  if (typeof value !== 'string') {
    try {
      value = JSON.stringify(value);
    } catch (e) {
      return value;
    }
  }

  // If value is small, return as is
  if (value.length < 50000) return value;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      if (key === 'aurora-users' || key === 'aurora-customers') {
        parsed.forEach(item => {
          if (item.profilePicture && typeof item.profilePicture === 'string' && item.profilePicture.startsWith('data:') && item.profilePicture.length > 25000) {
            item.profilePicture = '';
          }
          if (item.avatar && typeof item.avatar === 'string' && item.avatar.startsWith('data:') && item.avatar.length > 25000) {
            item.avatar = '';
          }
        });
      } else if (key === 'aurora-orders') {
        parsed.forEach(o => {
          if (o.paymentProofDataUrl && typeof o.paymentProofDataUrl === 'string' && o.paymentProofDataUrl.startsWith('data:') && o.paymentProofDataUrl.length > 1000) {
            o.paymentProofDataUrl = '';
          }
          if (o.qrProof && typeof o.qrProof === 'string' && o.qrProof.startsWith('data:') && o.qrProof.length > 1000) {
            o.qrProof = '';
          }
        });
      }
      return JSON.stringify(parsed);
    } else if (parsed && typeof parsed === 'object') {
      if (parsed.profilePicture && typeof parsed.profilePicture === 'string' && parsed.profilePicture.startsWith('data:') && parsed.profilePicture.length > 25000) {
        parsed.profilePicture = '';
      }
      if (parsed.avatar && typeof parsed.avatar === 'string' && parsed.avatar.startsWith('data:') && parsed.avatar.length > 25000) {
        parsed.avatar = '';
      }
      return JSON.stringify(parsed);
    }
  } catch (err) {
    // Return original if parsing fails
  }

  return value;
}

// Universal safe setter for localStorage with automatic QuotaExceeded recovery
export function safeLocalStorageSet(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.number === -2147024882) {
      console.warn(`[STORAGE] Quota exceeded on setItem('${key}'). Initiating automatic quota cleanup...`);
      performEmergencyStorageCleanup();
      try {
        const sanitized = sanitizeStoragePayload(key, value);
        localStorage.setItem(key, sanitized);
        console.log(`[STORAGE] Successfully saved '${key}' after quota cleanup.`);
      } catch (retryErr) {
        console.warn(`[STORAGE] Retry 1 failed for '${key}'. Purging non-essential scratch keys...`);
        try {
          localStorage.removeItem('aurora-login-attempts');
          localStorage.removeItem('aurora-audits');
          localStorage.removeItem('aurora-verifications');
          const sanitized = sanitizeStoragePayload(key, value);
          localStorage.setItem(key, sanitized);
          console.log(`[STORAGE] Successfully saved '${key}' after aggressive cache purge.`);
        } catch (finalErr) {
          console.error(`[STORAGE] Could not write '${key}' to localStorage due to device quota:`, finalErr);
        }
      }
    } else {
      console.warn(`[STORAGE] Error saving '${key}' to localStorage:`, e);
    }
  }
}

// SVG Icon Library for Vanilla HTML/JS
export const ICONS = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
  shoppingBag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-green-500"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>`,
  packageIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><polygon points="12 22.08 12 12 3 6.92 3 17.08 12 22.08"></polygon><polygon points="12 12 21 6.92 21 17.08 12 22.08"></polygon><polygon points="12 2 12 12 21 17.08 12 22.08"></polygon><line x1="12" y1="12" x2="12" y2="22"></line><line x1="12" y1="12" x2="3" y2="6.92"></line><line x1="12" y1="12" x2="21" y2="6.92"></line></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
  trendingUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`
};

export const NOTIF_STYLES = {
  order: {
    icon: '🟢',
    bg: 'bg-green-50 border-green-200',
    text: 'text-green-800'
  },
  'new-order': {
    icon: '🔵',
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800'
  },
  reservation: {
    icon: '🟠',
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800'
  },
  payment: {
    icon: '🟡',
    bg: 'bg-yellow-50 border-yellow-200',
    text: 'text-yellow-800'
  },
  issue: {
    icon: '🔴',
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800'
  },
  completed: {
    icon: '⚪',
    bg: 'bg-gray-50 border-gray-200',
    text: 'text-gray-800'
  },
  stock: {
    icon: '📢',
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800'
  },
  info: {
    icon: 'ℹ️',
    bg: 'bg-gray-50 border-gray-200',
    text: 'text-gray-800'
  }
};

export const DEFAULT_PRODUCTS = [
  {
    id: '2',
    name: '7A Hope Rice',
    price: 1350,
    stock: 200,
    image: 'https://i.pinimg.com/736x/69/66/78/696678fbb7edb048d016178c6034872d.jpg',
    type: 'White',
    description: 'Locally grown organic white rice. Soft, fluffy texture that pairs well with any dish. 25kg sack.',
  },
  {
    id: '3',
    name: '7A Ordinary Rice',
    price: 1380,
    stock: 80,
    image: 'https://i.pinimg.com/736x/22/68/6b/22686b842e0db481f59526659801f955.jpg',
    type: 'Brown',
    description: 'Nutritious whole grain rice rich in fiber and vitamins. Healthy choice for the family. 25kg sack.',
  },
  {
    id: '8',
    name: 'Hope 160 Rice',
    price: 1380,
    stock: 0,
    image: 'https://i.pinimg.com/736x/4b/b5/f9/4bb5f91184c5482b607e76ee2a9ce319.jpg',
    type: 'Arborio',
    description: 'Italian short-grain rice perfect for creamy risotto. Currently out of stock - join reservation queue. 25kg sack.',
  },
  {
    id: '5',
    name: '7A Straightmill Rice',
    price: 1270,
    stock: 120,
    image: 'https://i.pinimg.com/736x/6b/54/59/6b54592dd48289a46694c805ba52af78.jpg',
    type: 'Basmati',
    description: 'Extra-long grain rice with distinctive aroma. Ideal for biryani, pilaf, and special recipes. 25kg sack.',
  },
  {
    id: '6',
    name: '7A Headrice',
    price: 1300,
    stock: 15,
    image: 'https://i.pinimg.com/736x/22/68/6b/22686b842e0db481f59526659801f955.jpg',
    type: 'Glutinous',
    description: 'Sticky rice perfect for traditional Filipino desserts and special dishes. Limited stock available. 25kg sack.',
  },
  {
    id: '7',
    name: '7A Black Rice',
    price: 1390,
    stock: 40,
    image: 'https://i.pinimg.com/736x/6b/54/59/6b54592dd48289a46694c805ba52af78.jpg',
    type: 'Black',
    description: 'Exotic black rice packed with antioxidants. Premium quality for special meals and health benefits. 25kg sack.',
  },
  {
    id: '4',
    name: '7A Red Rice V10',
    price: 1370,
    stock: 50,
    image: 'https://i.pinimg.com/736x/22/68/6b/22686b842e0db481f59526659801f955.jpg',
    type: 'Red',
    description: 'Premium quality red rice with nutty flavor and high nutritional value. Great for health-conscious families. 25kg sack.',
  }
];

const DEFAULT_REVIEWS = [];

// ---------------------- SECURITY & HARDENING TOOLS ----------------------

// Standard HTML Sanitizer to prevent XSS / HTML injections
export function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Simulated Cryptographic SHA-256 password hashing helper (client-side implementation)
export async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Get login attempts map from localStorage
function getLoginAttempts() {
  return JSON.parse(localStorage.getItem('aurora-login-attempts') || '{}');
}

// Save login attempts map to localStorage
function saveLoginAttempts(attempts) {
  localStorage.setItem('aurora-login-attempts', JSON.stringify(attempts));
}

// Check if an account is locked out, returns false or remaining lock time in seconds
export function checkLockout(emailOrUsername) {
  if (!emailOrUsername || typeof emailOrUsername !== 'string') return false;
  const attempts = getLoginAttempts();
  const record = attempts[emailOrUsername.toLowerCase()];
  if (record && record.failedCount >= 5) {
    const now = Date.now();
    const timeDiff = now - record.lastFailedTime;
    const lockoutPeriod = 15 * 60 * 1000; // 15 minutes in milliseconds
    if (timeDiff < lockoutPeriod) {
      const remainingMs = lockoutPeriod - timeDiff;
      return Math.ceil(remainingMs / 1000); // return remaining seconds
    } else {
      // Lockout expired, reset attempts
      record.failedCount = 0;
      saveLoginAttempts(attempts);
    }
  }
  return false;
}

// Record a failed login attempt
export function recordFailedAttempt(emailOrUsername) {
  if (!emailOrUsername || typeof emailOrUsername !== 'string') return 0;
  const attempts = getLoginAttempts();
  const key = emailOrUsername.toLowerCase();
  if (!attempts[key]) {
    attempts[key] = { failedCount: 0, lastFailedTime: 0 };
  }
  attempts[key].failedCount += 1;
  attempts[key].lastFailedTime = Date.now();
  saveLoginAttempts(attempts);
  return attempts[key].failedCount;
}

// Reset login attempts upon successful login
export function resetFailedAttempts(emailOrUsername) {
  if (!emailOrUsername || typeof emailOrUsername !== 'string') return;
  const attempts = getLoginAttempts();
  const key = emailOrUsername.toLowerCase();
  if (attempts[key]) {
    attempts[key].failedCount = 0;
    attempts[key].lastFailedTime = 0;
    saveLoginAttempts(attempts);
  }
}

// Check if email address is registered across customers and admins/staff
export function checkEmailExists(email) {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return false;

  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const admins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
  const customers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');

  const userExists = users.some(u => u.email && String(u.email).trim().toLowerCase() === cleanEmail && !u.isArchived);
  const adminExists = admins.some(a => a.email && String(a.email).trim().toLowerCase() === cleanEmail && !a.isArchived);
  const custExists = customers.some(c => c.email && String(c.email).trim().toLowerCase() === cleanEmail && !c.isArchived);

  return userExists || adminExists || custExists;
}

export function normalizePhilippinePhone(phone) {
  if (phone === null || phone === undefined) {
    return { isValid: false, canonical: '', e164: '', raw: '' };
  }
  const rawStr = String(phone).trim();
  if (!rawStr) {
    return { isValid: false, canonical: '', e164: '', raw: '' };
  }

  // Extract all digit characters
  const digits = rawStr.replace(/\D/g, '');

  // Valid Philippine mobile number patterns:
  // 1) 12 digits starting with 639 (e.g. +63 992 374 8382 -> 639923748382)
  // 2) 11 digits starting with 09 (e.g. 0992-374-8382 -> 09923748382)
  // 3) 10 digits starting with 9 (e.g. 9923748382)
  let localDigits = '';
  if (digits.startsWith('639') && digits.length === 12) {
    localDigits = digits.substring(2); // 9XXXXXXXXX (10 digits)
  } else if (digits.startsWith('09') && digits.length === 11) {
    localDigits = digits.substring(1); // 9XXXXXXXXX (10 digits)
  } else if (digits.startsWith('9') && digits.length === 10) {
    localDigits = digits; // 9XXXXXXXXX (10 digits)
  }

  if (/^9\d{9}$/.test(localDigits)) {
    return {
      isValid: true,
      canonical: `0${localDigits}`,
      e164: `+63${localDigits}`,
      raw: rawStr
    };
  }

  return {
    isValid: false,
    canonical: '',
    e164: '',
    raw: rawStr
  };
}

export function validatePhilippinePhone(phone) {
  return normalizePhilippinePhone(phone).isValid;
}

export function checkPhoneExists(phone, excludeUserId = null) {
  const norm = normalizePhilippinePhone(phone);
  if (!norm.isValid) return false;

  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const admins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
  const customers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');

  const getRecordPhones = (r) => {
    if (!r) return [];
    return [r.phone, r.phoneE164, r.phoneNumber, r.contact, r.contactNumber, r.mobile, r.tel].filter(Boolean);
  };

  const matches = (record) => {
    if (!record) return false;
    const phones = getRecordPhones(record);
    return phones.some(p => {
      const storedNorm = normalizePhilippinePhone(p);
      return storedNorm.isValid && storedNorm.canonical === norm.canonical;
    });
  };

  const isExcluded = (record) => {
    if (!excludeUserId) return false;
    const exStr = String(excludeUserId).trim().toLowerCase();
    const idStr = String(record.id || record.customerId || record.uid || record.firebaseUid || '').trim().toLowerCase();
    const emailStr = String(record.email || '').trim().toLowerCase();
    return (idStr && idStr === exStr) || (emailStr && emailStr === exStr);
  };

  const inUsers = users.some(u => !u.isArchived && !isExcluded(u) && matches(u));
  if (inUsers) return true;

  const inAdmins = admins.some(a => !a.isArchived && !isExcluded(a) && matches(a));
  if (inAdmins) return true;

  const inCustomers = customers.some(c => !c.isArchived && !isExcluded(c) && matches(c));
  if (inCustomers) return true;

  return false;
}

// Reset demo/transaction data while preserving admins, staff, products, settings, and dark mode
export function resetDemoData() {
  localStorage.setItem('aurora-orders', JSON.stringify([]));
  localStorage.setItem('aurora-orders-seeded', 'true');
  localStorage.setItem('aurora-reservations', JSON.stringify([]));
  localStorage.setItem('aurora-activity-logs', JSON.stringify([]));
  localStorage.setItem('aurora-notifications', JSON.stringify([]));
  localStorage.setItem('aurora-cash-turnover', JSON.stringify([]));
  localStorage.setItem('aurora-audits', JSON.stringify([]));
  localStorage.setItem('aurora-verifications', JSON.stringify([]));
  localStorage.setItem('aurora-replacement-orders', JSON.stringify([]));
  localStorage.setItem('aurora-issue-reports', JSON.stringify([]));
  localStorage.setItem('aurora-reviews', JSON.stringify(DEFAULT_REVIEWS));
  localStorage.setItem('aurora-cart', JSON.stringify([]));
  localStorage.setItem('aurora-inventory-history', JSON.stringify([]));
  localStorage.setItem('aurora-messages', JSON.stringify([]));

  // Delete ALL customer accounts completely
  localStorage.setItem('aurora-users', JSON.stringify([]));
  localStorage.setItem('aurora-customers', JSON.stringify([]));
  localStorage.setItem('aurora-users-seeded', 'true');
  localStorage.removeItem('aurora-user');
  localStorage.removeItem('aurora-logged-in');
  localStorage.removeItem('riceflow_customer_active_order_id');
  localStorage.removeItem('riceflow_customer_active_tab');

  // Reset products to default baseline
  localStorage.setItem('aurora-products', JSON.stringify(DEFAULT_PRODUCTS));

  localStorage.setItem('aurora-clean-reset-v4', 'true');
}

if (typeof window !== 'undefined') {
  window.resetDemoData = resetDemoData;
}

// Initialize Database Storage
export function initDB() {
  syncStoreSettingsFromFirestore().catch(() => {});
  initFirestoreSync().catch(err => console.warn('[FIREBASE] Sync error on init:', err));

  if (auth && typeof onAuthStateChanged === 'function') {
    onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser && fbUser.email) {
        if (typeof window !== 'undefined' && window.__customerLogoutInProgress) {
          return;
        }
        const fbEmailClean = String(fbUser.email).toLowerCase();
        
        // Authoritatively block session restore if customer account is archived
        const currentAdmin = getCurrentAdmin();
        const isAdmin = currentAdmin && currentAdmin.email && String(currentAdmin.email).toLowerCase() === fbEmailClean;

        if (!isAdmin && localStorage.getItem('aurora-logged-in') === 'true') {
          try {
            const archCheck = await checkCustomerArchivedInFirestore(fbEmailClean, fbUser.uid);
            if (archCheck && archCheck.isArchived === true) {
              localStorage.removeItem('aurora-user');
              localStorage.setItem('aurora-logged-in', 'false');
              if (typeof signOut === 'function') {
                await signOut(auth).catch(() => {});
              }
              if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
                try { renderLayout(); } catch (_) {}
              }
              return;
            }
          } catch (_) {}
        }

        if (!isAdmin && localStorage.getItem('aurora-logged-in') === 'true') {
          try {
            const remoteProfile = await fetchCustomerProfileFromFirestore(fbEmailClean, fbUser.uid);
            // Re-verify customer is still logged in after async Firestore calls
            if ((typeof window !== 'undefined' && window.__customerLogoutInProgress) || localStorage.getItem('aurora-logged-in') !== 'true' || !localStorage.getItem('aurora-user')) {
              return;
            }
            if (remoteProfile) {
              const localUser = getCurrentUser();
              const remoteTime = remoteProfile.updatedAt ? new Date(remoteProfile.updatedAt).getTime() : 0;
              const localTime = localUser?.updatedAt ? new Date(localUser.updatedAt).getTime() : 0;

              // Firestore is the source of truth: takes precedence if remote is newer, or if local is missing fields
              if (!localUser || remoteTime >= localTime || (!localUser.phone && remoteProfile.phone) || (!localUser.address && remoteProfile.address)) {
                const mergedUser = { ...localUser, ...remoteProfile, firebaseUid: fbUser.uid };
                localStorage.setItem('aurora-user', JSON.stringify(mergedUser));
                localStorage.setItem('aurora-logged-in', 'true');

                const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
                const uIdx = users.findIndex(u => (u.id && u.id === mergedUser.id) || (u.email && String(u.email).toLowerCase() === fbEmailClean));
                if (uIdx !== -1) {
                  users[uIdx] = { ...users[uIdx], ...mergedUser };
                } else {
                  users.push(mergedUser);
                }
                safeLocalStorageSet('aurora-users', JSON.stringify(users));
                syncUsersAndCustomers();

                if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
                  try { renderLayout(); } catch (_) {}
                }
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user', remote: true } }));
                }
              }
            } else {
              const localUser = getCurrentUser();
              if (localUser && localUser.email && String(localUser.email).toLowerCase() === fbEmailClean) {
                if (!localUser.firebaseUid) {
                  localUser.firebaseUid = fbUser.uid;
                  localStorage.setItem('aurora-user', JSON.stringify(localUser));
                }
              }
            }
          } catch (fetchErr) {
            console.warn('[AUTH] Error fetching remote profile in onAuthStateChanged:', fetchErr);
          }
        }
        const localAdmin = getCurrentAdmin();
        if (localAdmin && localAdmin.email && String(localAdmin.email).toLowerCase() === fbEmailClean) {
          if (!localAdmin.firebaseUid) {
            localAdmin.firebaseUid = fbUser.uid;
            localStorage.setItem('aurora-admin-user', JSON.stringify(localAdmin));
            const admins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
            const idx = admins.findIndex(a => a.id === localAdmin.id || (a.email && String(a.email).toLowerCase() === fbEmailClean));
            if (idx !== -1) {
              admins[idx].firebaseUid = fbUser.uid;
              setItemAndSync('aurora-admin-users', JSON.stringify(admins));
            }
          }
        }
      }
    });
  }

  if (!localStorage.getItem('aurora-clean-reset-v4')) {
    resetDemoData();
  }

  const storedProds = JSON.parse(localStorage.getItem('aurora-products') || '[]');
  if (!Array.isArray(storedProds) || storedProds.length < DEFAULT_PRODUCTS.length) {
    const mergedProds = Array.isArray(storedProds) ? [...storedProds] : [];
    DEFAULT_PRODUCTS.forEach(dp => {
      if (!mergedProds.some(p => String(p.id) === String(dp.id))) {
        mergedProds.push(dp);
      }
    });
    localStorage.setItem('aurora-products', JSON.stringify(mergedProds));
  }
  if (!localStorage.getItem('aurora-reviews')) {
    localStorage.setItem('aurora-reviews', JSON.stringify([]));
  }
  if (!localStorage.getItem('aurora-cart')) {
    localStorage.setItem('aurora-cart', JSON.stringify([]));
  }
  if (!localStorage.getItem('aurora-orders')) {
    localStorage.setItem('aurora-orders', JSON.stringify([]));
  }
  if (!localStorage.getItem('aurora-activity-logs')) {
    localStorage.setItem('aurora-activity-logs', JSON.stringify([]));
  }

  // Ensure aurora-admin-users array structure is initialized
  if (!localStorage.getItem('aurora-admin-users')) {
    localStorage.setItem('aurora-admin-users', JSON.stringify([]));
  }

  // Scrub seeded fake users, fake orders/reservations, fake inventory logs, and fake customer records
  scrubFakeData();
}

// Data scrubber to remove automatically generated fake users, orders, reservations, and inventory logs
function scrubFakeData() {
  try {
    // 1. Clean Users (Remove ONLY fake seed accounts user-1..210 and customer1..210, keep real registered users)
    let users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
    users = users.filter(u => {
      if (!u) return false;
      if (isStaleUser(u)) return false;
      const uid = String(u.id || '');
      const username = String(u.username || '').toLowerCase();
      const email = String(u.email || '').toLowerCase().trim();
      const fullName = String(u.fullName || u.name || '').trim();

      // Delete fake seed accounts and unrequested demo user
      if (/^user-[1-9]\d{0,2}$/.test(uid)) return false; 
      if (/^customer\d+$/.test(username)) return false;
      if (/^customer\d+@gmail\.com$/.test(email)) return false;
      if (uid === 'demo-user-1' || email === 'hello@gmail.com' || username === 'demouser') return false;
      if (fullName === 'undefined' || email === 'undefined') return false;
      if (!uid && !email) return false;

      return true;
    });
    localStorage.setItem('aurora-users', JSON.stringify(users));

    // 2. Clean Orders & Reservations (Remove ONLY fake/seeded or pre-reset stale orders and reservations)
    let orders = JSON.parse(localStorage.getItem('aurora-orders') || '[]');
    orders = (Array.isArray(orders) ? orders : []).filter(o => {
      if (!o) return false;
      if (isStaleOrderOrReservation(o)) return false;
      return true;
    });
    localStorage.setItem('aurora-orders', JSON.stringify(orders));

    // 3. Clean Inventory History (Remove seeded or stale pre-reset inventory logs)
    let inventoryHistory = JSON.parse(localStorage.getItem('aurora-inventory-history') || '[]');
    inventoryHistory = (Array.isArray(inventoryHistory) ? inventoryHistory : []).filter(h => {
      if (!h) return false;
      const hid = String(h.id || '');
      if (hid.startsWith('inv-seed-')) return false;
      if (isStaleInventoryHistory(h)) return false;
      return true;
    });
    localStorage.setItem('aurora-inventory-history', JSON.stringify(inventoryHistory));

    // 4. Clean Customers Table
    let customers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
    customers = customers.filter(c => {
      if (!c) return false;
      if (isStaleCustomer(c)) return false;
      const cid = String(c.id || c.customerId || '');
      const email = String(c.email || '').toLowerCase().trim();
      const name = String(c.name || c.fullName || '').trim();
      if (['1', '2', '3', '4', 'CUS-000001', 'CUS-000002', 'CUS-000003', 'CUS-000004'].includes(cid)) return false;
      if (/^customer\d+@gmail\.com$/.test(email)) return false;
      if (cid === 'demo-user-1' || email === 'hello@gmail.com' || name.toLowerCase() === 'demo customer') return false;
      if (name === 'undefined' || email === 'undefined') return false;
      if (!cid && !email && !name) return false;
      return true;
    });
    localStorage.setItem('aurora-customers', JSON.stringify(customers));

    // 5. Clean Reviews (Remove seeded fake customer reviews)
    let reviews = JSON.parse(localStorage.getItem('aurora-reviews') || '[]');
    const fakeReviewNames = ['juan dela cruz', 'ana reyes', 'pedro garcia', 'rosa martinez'];
    const fakeReviewIds = ['2', '3', '4', '5'];
    reviews = reviews.filter(r => {
      if (!r) return false;
      const rid = String(r.id || '');
      const rname = String(r.name || '').toLowerCase().trim();
      if (fakeReviewIds.includes(rid)) return false;
      if (fakeReviewNames.includes(rname)) return false;
      return true;
    });
    localStorage.setItem('aurora-reviews', JSON.stringify(reviews));

    // 6. Clean Products (Remove stale legacy prototype products and invalid records)
    let prods = JSON.parse(localStorage.getItem('aurora-products') || '[]');
    const staleProductIds = new Set(['p1', 'prod-1', 'test_probe', 'test-prod-999', 'test-prod-jasmine']);
    prods = prods.filter(p => p && p.name && !staleProductIds.has(String(p.id)) && !isStaleProduct(p));
    localStorage.setItem('aurora-products', JSON.stringify(prods));

    // 7. Clean Notifications (Remove confirmed stale test notifications)
    let notifs = JSON.parse(localStorage.getItem('aurora-notifications') || '[]');
    notifs = (Array.isArray(notifs) ? notifs : []).filter(n => {
      if (!n) return false;
      if (isStaleNotification(n)) return false;
      return true;
    });
    localStorage.setItem('aurora-notifications', JSON.stringify(notifs));

    // Remove legacy seed flags
    localStorage.removeItem('aurora-users-seeded');
    localStorage.removeItem('aurora-orders-seeded');
    localStorage.removeItem('aurora-inventory-seeded');

    // Only run reservation stock allocation and inventory history reconciliation AFTER Firestore orders have been hydrated
    if (isOrdersHydrated()) {
      if (typeof allocateStockToReservations === 'function') {
        allocateStockToReservations();
      }
      if (typeof reconcileMissingOrderInventoryHistory === 'function') {
        reconcileMissingOrderInventoryHistory();
      }
    }
  } catch (err) {
    console.error('Error scrubbing fake seed data:', err);
  }
}

// Call init automatically
initDB();

// ---------------------- INVENTORY HISTORY & ESTIMATION API ----------------------

export function extractVarietyTokens(nameOrRef) {
  if (!nameOrRef) return [];
  const clean = String(nameOrRef)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  const stopwords = new Set([
    '7a', 'rice', 'sack', 'sacks', 'kg', '25kg', '50kg', 
    'premium', 'organic', 'special', 'class', 'grade',
    'palay', 'grain', 'grains', 'milled', 'super'
  ]);

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  const filtered = words.filter(w => !stopwords.has(w) && !/^\d+$/.test(w));
  return filtered.length > 0 ? filtered : words.filter(w => !stopwords.has(w));
}

export function matchesProductVariety(refA, refB, allProducts = []) {
  if (!refA || !refB) return false;

  const idA = String(refA.id || refA.productId || '').trim();
  const idB = String(refB.id || refB.productId || '').trim();

  const hasValidIdA = Boolean(idA && idA !== 'undefined' && idA !== 'null' && idA !== '[object Object]');
  const hasValidIdB = Boolean(idB && idB !== 'undefined' && idB !== 'null' && idB !== '[object Object]');

  // 1. Strict ID matching when both references possess valid catalog IDs:
  // If equal -> true; If different -> false (DO NOT fall through to name/token matching)
  if (hasValidIdA && hasValidIdB) {
    return idA === idB;
  }

  const catalog = (Array.isArray(allProducts) && allProducts.length > 0) 
    ? allProducts 
    : (typeof getProducts === 'function' ? getProducts() : []);

  const getName = (ref, id) => {
    let n = String(ref.name || ref.productName || ref.riceType || ref.variety || (typeof ref.product === 'string' ? ref.product : '') || ref.product?.name || '');
    if (!n && id && catalog.length > 0) {
      const p = catalog.find(x => String(x.id) === String(id));
      if (p) n = p.name || '';
    }
    return n.trim().toLowerCase();
  };

  const nameA = getName(refA, idA);
  const nameB = getName(refB, idB);

  if (!nameA || !nameB) return false;

  // 2. Exact lowercase match
  if (nameA === nameB) return true;

  // 3. Normalized variety token matching
  const tokensA = extractVarietyTokens(nameA);
  const tokensB = extractVarietyTokens(nameB);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return nameA === nameB;
  }

  // Check joined tokens
  if (tokensA.join(' ') === tokensB.join(' ')) return true;

  // Single keyword containment (e.g. 'hope' matching '7A Hope Rice' or 'Hope 160 Rice')
  const keyA = tokensA[0];
  const keyB = tokensB[0];
  if (tokensA.length === 1 && tokensB.includes(keyA)) return true;
  if (tokensB.length === 1 && tokensA.includes(keyB)) return true;

  // All tokens subset check
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  return shorter.every(t => longer.includes(t));
}

export function getInventoryHistory() {
  const parsed = JSON.parse(localStorage.getItem('aurora-inventory-history') || '[]');
  return (Array.isArray(parsed) ? parsed : []).filter(h => !isStaleInventoryHistory(h));
}

export function saveInventoryHistory(history, targetDocInfo = null) {
  if (typeof setItemAndSync === 'function') {
    setItemAndSync('aurora-inventory-history', JSON.stringify(history), targetDocInfo);
  } else {
    localStorage.setItem('aurora-inventory-history', JSON.stringify(history));
  }
}

export function addInventoryHistory(entry, bypassRoleCheck = false) {
  if (!bypassRoleCheck) {
    const admin = getCurrentAdmin();
    if (!admin || admin.role !== 'admin') {
      throw new Error("You do not have permission to perform this action.");
    }
  }
  const history = getInventoryHistory();
  const allProducts = typeof getProducts === 'function' ? getProducts() : [];
  const now = new Date();
  const dateStr = entry.date || [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const timeStr = entry.time || [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join(':');

  let pId = entry.productId;
  let pName = entry.productName;

  if (!pId && pName && allProducts.length > 0) {
    const matched = allProducts.find(p => String(p.name || '').trim().toLowerCase() === String(pName).trim().toLowerCase()) ||
                    allProducts.find(p => matchesProductVariety(p, { name: pName }, allProducts));
    if (matched) pId = matched.id;
  } else if (pId && !pName && allProducts.length > 0) {
    const matched = allProducts.find(p => String(p.id) === String(pId));
    if (matched) pName = matched.name;
  }

  if (entry.id && history.some(h => h.id === entry.id)) {
    return history.find(h => h.id === entry.id);
  }

  const newEntry = {
    id: entry.id || ('inv-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5)),
    productName: pName || entry.productName || 'Rice Variety',
    quantityAdded: parseInt(entry.quantityAdded || '0'),
    date: dateStr,
    time: timeStr,
    timestamp: entry.timestamp || now.toISOString(),
    staffName: entry.staffName || getCurrentAdmin()?.name || 'Admin User',
    remarks: entry.remarks || 'Stock replenishment'
  };
  if (pId) newEntry.productId = String(pId);
  if (entry.type) newEntry.type = entry.type;

  history.unshift(newEntry);
  saveInventoryHistory(history, { colName: 'inventoryHistory', docId: newEntry.id, docData: newEntry });
  try {
    saveFirestoreDoc('inventoryHistory', newEntry.id, newEntry);
  } catch (e) {
    console.warn('[INVENTORY] Firestore save error:', e);
  }
  return newEntry;
}

export function reconcileMissingOrderInventoryHistory() {
  try {
    // Never backfill inventory history before authoritative orders have been hydrated from Firestore
    if (!isOrdersHydrated()) return;

    const orders = getOrders().filter(o => !isStaleOrderOrReservation(o));
    const history = getInventoryHistory();
    let historyChanged = false;

    orders.forEach(order => {
      if (!order || !order.id || isStaleOrderOrReservation(order)) return;
      // Reservations never physically deduct stock upon placement
      const isRes = Boolean(order.isPreOrder || (order.id && String(order.id).toLowerCase().startsWith('res-')));
      if (isRes) return;

      // Never fabricate negative stock deductions for cancelled or rejected orders
      const cleanStatus = String(order.status || '').toLowerCase().replace(/_/g, '-').trim();
      if (cleanStatus === 'cancelled' || cleanStatus === 'rejected' || order.stockDeducted === false) return;

      // Only check active/completed orders that currently hold deducted warehouse stock
      const hasDeducted = order.stockDeducted === true || String(order.stockDeducted) === 'true';
      if (!hasDeducted) return;

      const orderIdStr = String(order.id).trim();
      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) return;

      const createdAtDate = order.createdAt ? new Date(order.createdAt) : new Date();
      const validCreatedDate = !isNaN(createdAtDate.getTime()) ? createdAtDate : new Date();
      const dateStr = [
        validCreatedDate.getFullYear(),
        String(validCreatedDate.getMonth() + 1).padStart(2, '0'),
        String(validCreatedDate.getDate()).padStart(2, '0')
      ].join('-');
      const timeStr = [
        String(validCreatedDate.getHours()).padStart(2, '0'),
        String(validCreatedDate.getMinutes()).padStart(2, '0')
      ].join(':');
      const isPartial = Boolean(order.partialApprovedQty || order.createdReservation || order.linkedReservationId);

      items.forEach((item, itemIdx) => {
        if (item.isReservation) return;
        const pId = String(item.product?.id || item.productId || item.id || '').trim();
        const pName = item.product?.name || item.name || 'Rice Variety';
        const qtyDeducted = Number(item.quantity || 0);

        if (qtyDeducted > 0) {
          // Check if a negative stock movement already exists for this order and item
          const alreadyRecorded = history.some(h => {
            if (!h) return false;
            const remarks = String(h.remarks || '');
            const qty = Number(h.quantityAdded || 0);
            const matchesOrder = qty < 0 && (remarks.includes(`#${orderIdStr}`) || remarks.includes(orderIdStr));
            if (!matchesOrder) return false;
            if (items.length > 1) {
              const hPid = String(h.productId || '').trim();
              const hPname = String(h.productName || '').trim();
              const matchesProd = (pId && hPid === pId) || (pName && hPname === pName) || remarks.includes(pName);
              const matchesIdx = String(h.id || '').includes(`-${orderIdStr.toLowerCase()}-${itemIdx}`);
              return matchesProd || matchesIdx;
            }
            return true;
          });

          if (alreadyRecorded) return;

          const backfillEntry = {
            id: `inv-${createdAtDate.getTime() || Date.now()}-${orderIdStr.toLowerCase()}${items.length > 1 ? `-${itemIdx}` : ''}`,
            productId: String(pId),
            productName: pName,
            quantityAdded: -qtyDeducted,
            date: dateStr,
            time: timeStr,
            timestamp: order.createdAt || createdAtDate.toISOString(),
            staffName: order.approvedByName || 'Admin User',
            remarks: isPartial ? `Order placed (partial split): #${orderIdStr}` : `Order placed: #${orderIdStr}`
          };

          if (isStaleInventoryHistory(backfillEntry)) return;

          history.push(backfillEntry);
          historyChanged = true;
          try {
            saveFirestoreDoc('inventoryHistory', backfillEntry.id, backfillEntry);
          } catch (e) {
            console.warn('[INVENTORY] Firestore save error during backfill:', e);
          }
        }
      });
    });

    if (historyChanged) {
      saveInventoryHistory(history);
    }
  } catch (err) {
    console.error('Error reconciling order inventory history:', err);
  }
}

export function getEstimatedAvailabilityDate(productIdOrName) {
  if (!productIdOrName) return 'Waiting for Restock';
  const products = typeof getProducts === 'function' ? getProducts() : [];
  let product = products.find(p => String(p.id) === String(productIdOrName)) || 
                products.find(p => matchesProductVariety(p, { name: productIdOrName }, products));
  
  const pName = product ? product.name : String(productIdOrName);
  if (product && Number(product.stock || 0) > 0) return 'Available now';

  // Priority A: Explicit administrator-configured restock date on the product
  if (product) {
    const adminDateStr = product.estimatedRestockDate || product.expectedRestockDate || product.restockDate;
    if (adminDateStr) {
      const adminDate = new Date(adminDateStr);
      if (!isNaN(adminDate.getTime())) {
        return adminDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
  }

  // Priority B & C: Historical restock records for this specific rice product
  const allHistory = typeof getInventoryHistory === 'function' ? getInventoryHistory() : [];
  const history = allHistory.filter(h => 
    matchesProductVariety({ id: product?.id || productIdOrName, name: pName }, h, products) && 
    Number(h.quantityAdded || 0) > 0
  );
  
  // Sort by date/time ascending
  history.sort((a, b) => {
    const tA = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
    const tB = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
    return tA - tB;
  });

  // Calculate intervals between consecutive positive restocks
  const intervals = [];
  for (let i = 1; i < history.length; i++) {
    const d1 = new Date(`${history[i-1].date}T${history[i-1].time || '00:00'}`);
    const d2 = new Date(`${history[i].date}T${history[i].time || '00:00'}`);
    const diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 0) {
      intervals.push(diffDays);
    }
  }

  // Priority C: If fewer than 3 restocks or fewer than 2 valid intervals, do NOT fabricate a date
  if (history.length < 2 || intervals.length < 1) {
    return 'Waiting for Restock';
  }

  // Priority B: Calculate average days across historical restock intervals
  const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

  // Next projected restock is latest actual restock plus average interval
  const lastRestock = history[history.length - 1];
  const lastRestockDate = new Date(`${lastRestock.date}T${lastRestock.time || '00:00'}`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stepMs = Math.max(1, Math.round(avgInterval)) * 24 * 60 * 60 * 1000;
  let estDate = new Date(lastRestockDate.getTime() + stepMs);
  while (estDate < today) {
    estDate = new Date(estDate.getTime() + stepMs);
  }

  return estDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------- DATABASE API ----------------------

export function isOrderStockDeducted(order) {
  if (!order) return false;

  // Explicit flag check (boolean true, string 'true', or number 1)
  if (order.stockDeducted === true || String(order.stockDeducted) === 'true' || order.stockDeducted === 1) {
    return true;
  }

  // Normal portion of a split order: available stock was committed/deducted upon order split
  if (Number(order.partialApprovedQty || 0) > 0 || Boolean(order.linkedReservationId)) {
    return true;
  }

  // Orders with explicit stock consumption tracked
  if (Number(order.consumedFromStock || 0) > 0 || order.stockCommitted === true) {
    return true;
  }

  // Active or fulfilled normal orders whose warehouse stock was already decremented upon acceptance/fulfillment
  const statusClean = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (['processing', 'to-ship', 'to-receive', 'delivered', 'completed'].includes(statusClean) && !order.isPreOrder) {
    return true;
  }

  return false;
}

export function getProducts() {
  let list = [];

  try {
    const storedProducts = JSON.parse(
      localStorage.getItem('aurora-products') || '[]'
    );

    if (Array.isArray(storedProducts)) {
      list = storedProducts.filter(p => p && p.name && !isStaleProduct(p));
    }
  } catch (error) {
    console.warn('[PRODUCTS] Invalid product data in localStorage. Restoring catalog.', error);
    list = [];
  }

  // Always make sure the built-in RiceFlow catalog exists.
  if (Array.isArray(DEFAULT_PRODUCTS)) {
    DEFAULT_PRODUCTS.forEach(defaultProduct => {
      const exists = list.some(
        product => String(product.id) === String(defaultProduct.id)
      );

      if (!exists) {
        list.push({ ...defaultProduct });
      }
    });
  }
  
  let orders = [];
  try {
    orders = (JSON.parse(localStorage.getItem('aurora-orders') || '[]') || []).filter(o => !isStaleOrderOrReservation(o));
  } catch (e) {
    orders = [];
  }

  // Calculate:
  // 1. waitingMap: Quantities still WAITING for stock allocation (Reserved Stock)
  // 2. allocatedResMap: Stock committed to active reservations (Allocated Reservation Stock)
  // 3. regularOrdersMap: Stock reserved for confirmed normal orders not yet deducted from physical warehouse stock
  const waitingMap = {};
  const allocatedResMap = {};
  const regularOrdersMap = {};

  orders.forEach(o => {
    if (!o || o.status === 'cancelled' || o.status === 'Cancelled' || o.status === 'rejected') {
      return;
    }
    if (o.status === 'completed' || o.status === 'delivered') {
      return;
    }
    if (isOrderStockDeducted(o)) {
      // Stock was already deducted/consumed from physical warehouse stock when order was placed/split.
      // Do NOT deduct again from newly restocked or current physical stock!
      return;
    }

    const isRes = o.isPreOrder || (o.items && o.items.some(it => it.isReservation));

    if (isRes && Array.isArray(o.items)) {
      o.items.forEach(it => {
        if (!it) return;
        const pId = String(
          it.product?.id ??
          it.productId ??
          (typeof it.product === 'string' || typeof it.product === 'number' ? it.product : '') ??
          ''
        ).trim();

        if (pId) {
          const totalQty = Number(it.quantity || 0);
          const allocatedQty = Math.min(totalQty, Math.max(0, Number(o.allocatedQuantity || 0)));
          const waitingQty = Math.max(0, totalQty - allocatedQty);

          if (waitingQty > 0) {
            waitingMap[pId] = (waitingMap[pId] || 0) + waitingQty;
          }
          if (allocatedQty > 0) {
            allocatedResMap[pId] = (allocatedResMap[pId] || 0) + allocatedQty;
          }
        }
      });
    } else if (!isRes && Array.isArray(o.items)) {
      o.items.forEach(it => {
        if (!it) return;
        const pId = String(
          it.product?.id ??
          it.productId ??
          (typeof it.product === 'string' || typeof it.product === 'number' ? it.product : '') ??
          ''
        ).trim();

        if (pId && !it.isReservation) {
          const qty = Number(it.quantity || 0);
          if (qty > 0) {
            // Check if product had a restock after this normal order was placed.
            // Stock available when normal order was accepted was already committed.
            // It MUST NOT deduct again from newly restocked physical stock.
            const matchedProd = list.find(pr => String(pr.id) === pId);
            const orderTime = o.createdAt ? new Date(o.createdAt).getTime() : 0;
            const restockTime = matchedProd?.lastRestockAt ? new Date(matchedProd.lastRestockAt).getTime() : 0;

            if (restockTime > 0 && orderTime > 0 && orderTime < restockTime) {
              return;
            }

            regularOrdersMap[pId] = (regularOrdersMap[pId] || 0) + qty;
          }
        }
      });
    }
  });

  return list.map(p => {
    const pId = String(p.id);
    const physical = Math.max(0, Number(p.stock || 0));
    const waitingReserved = waitingMap[pId] || 0;
    const allocatedRes = allocatedResMap[pId] || 0;
    const regularReserved = regularOrdersMap[pId] || 0;

    // Customer-orderable Current Stock = Physical stock minus committed reservation stock minus pending normal deductions
    const available = Math.max(0, physical - allocatedRes - regularReserved);

    return {
      ...p,
      stock: available, // client-facing customer-orderable Current Stock
      currentStock: physical, // physical warehouse stock
      reservedStock: waitingReserved, // Reserved Stock = waiting for allocation
      availableStock: available // customer-orderable Current Stock
    };
  });
}

export function saveProducts(products, bypassRoleCheck = false, targetDocInfo = null) {
  if (!bypassRoleCheck) {
    const admin = getCurrentAdmin();
    if (!admin || admin.role !== 'admin') {
      throw new Error("You do not have permission to perform this action.");
    }
  }
  const cleanList = products.map(p => {
    const { currentStock, reservedStock, availableStock, ...rest } = p;
    const finalStock = currentStock !== undefined ? currentStock : p.stock;
    return {
      ...rest,
      stock: finalStock // persist physical stock
    };
  });

  // Targeted Firestore persistence for single modified or added product
  if (targetDocInfo && (targetDocInfo.docId || targetDocInfo.id)) {
    const docId = String(targetDocInfo.docId || targetDocInfo.id);
    const docData = targetDocInfo.docData || targetDocInfo.data;
    if (docData && typeof saveFirestoreDoc === 'function') {
      saveFirestoreDoc('products', docId, docData).catch(err => {
        console.warn(`[FIREBASE] Failed targeted stock persist for product ${docId}:`, err);
      });
    }
  } else if (Array.isArray(cleanList) && typeof saveFirestoreDoc === 'function') {
    // Auto-detect changed products to write targeted documents without bulk collection dumping
    try {
      const prevProds = JSON.parse(localStorage.getItem('aurora-products') || '[]');
      const prevMap = new Map();
      prevProds.forEach(p => { if (p && p.id) prevMap.set(String(p.id), JSON.stringify(p)); });

      cleanList.forEach(p => {
        if (!p || !p.id || isStaleProduct(p)) return;
        const prevJson = prevMap.get(String(p.id));
        const currentJson = JSON.stringify(p);
        if (!prevJson || prevJson !== currentJson) {
          saveFirestoreDoc('products', p.id, p).catch(err => {
            console.warn(`[FIREBASE] Auto-detected product persist warning for ${p.id}:`, err);
          });
        }
      });
    } catch (diffErr) {
      console.warn('[FIREBASE] Error auto-diffing products in saveProducts:', diffErr);
    }
  }

  setItemAndSync('aurora-products', JSON.stringify(cleanList), targetDocInfo);

  // Trigger Low/Out of Stock notifications safely
  try {
    cleanList.forEach(p => {
      const stockQty = Number(p.stock || 0);
      const existingNotifs = getNotifications();
      
      if (stockQty === 0) {
        const alreadyNotified = existingNotifs.some(n => n.type === 'stock' && n.title === '📦 Out of Stock' && n.message.includes(p.name));
        if (!alreadyNotified) {
          addNotification(
            'admin',
            '📦 Out of Stock',
            `${p.name} is currently out of stock.`,
            { role: 'admin', type: 'stock', productId: p.id }
          );
        }
      } else if (stockQty > 0 && stockQty <= 20) {
        const alreadyNotified = existingNotifs.some(n => n.type === 'stock' && n.title === '📉 Low Stock Alert' && n.message.includes(p.name));
        if (!alreadyNotified) {
          addNotification(
            'admin',
            '📉 Low Stock Alert',
            `${p.name} has reached the low stock threshold.`,
            { role: 'admin', type: 'stock', productId: p.id }
          );
        }
      }
    });
  } catch (err) {
    console.warn('[NOTIFICATIONS] Failed to check low stock alerts:', err);
  }

  // Auto-allocation disabled on saveProducts. Reservation stock allocation must only trigger on explicit admin restock events.
}

export function getProductById(id) {
  return getProducts().find(p => p.id === id);
}

export function getReviews(all = true) {
  const raw = localStorage.getItem('aurora-reviews') || '[]';
  let list = [];
  try {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch (e) {
    list = [];
  }
  // Exclude seeded / fake reviews (numeric IDs 2-5, missing orderId, or unverified)
  const fakeReviewIds = ['2', '3', '4', '5'];
  list = list.filter(r => {
    if (!r) return false;
    const rid = String(r.id || '');
    if (fakeReviewIds.includes(rid)) return false;
    if (!r.orderId || String(r.orderId).trim() === '') return false;
    if (!r.verifiedPurchase) return false;
    return true;
  });
  if (all) {
    return list;
  }
  const user = getCurrentUser();
  if (!user) return list;
  return list.filter(r => String(r.userId) === String(user.id));
}

export function getProductReviews() {
  const list = getReviews(true);
  return list.filter(r => r.reviewType === 'product' || (r.productName && !r.reviewType));
}

export function getOrderingExperienceReviews() {
  const list = getReviews(true);
  return list.filter(r => r.reviewType === 'ordering-experience');
}

export function hasReviewedProduct(orderId, productId, userId) {
  if (!orderId || !productId) return false;
  const list = getReviews(true);
  const user = getCurrentUser();
  const targetUid = userId ? String(userId).trim() : (user?.id ? String(user.id).trim() : (user?.customerId ? String(user.customerId).trim() : null));
  const targetEmail = user?.email ? String(user.email).trim().toLowerCase() : null;

  return list.some(r => {
    const isProd = r.reviewType === 'product' || r.type === 'product' || (!r.reviewType && r.productName);
    if (!isProd) return false;
    const matchOrder = String(r.orderId || '').trim().toLowerCase() === String(orderId).trim().toLowerCase();
    const matchProd = String(r.productId || '').trim().toLowerCase() === String(productId).trim().toLowerCase() || 
                      (r.productName && String(r.productName).trim().toLowerCase() === String(productId).trim().toLowerCase());
    if (matchOrder && matchProd) {
      if (targetUid || targetEmail) {
        const rUid = String(r.userId || r.customerId || '').trim();
        const rEmail = String(r.customerEmail || '').trim().toLowerCase();
        if (targetUid && rUid && rUid === targetUid) return true;
        if (targetEmail && rEmail && rEmail === targetEmail) return true;
        if (targetEmail && user && rUid && (rUid === String(user.id) || rUid === String(user.customerId))) return true;
        return false;
      }
      return true;
    }
    return false;
  });
}

export function hasReviewedOrderingExperience(orderId, userId) {
  if (!orderId) return false;
  const list = getReviews(true);
  const user = getCurrentUser();
  const targetUid = userId ? String(userId).trim() : (user?.id ? String(user.id).trim() : (user?.customerId ? String(user.customerId).trim() : null));
  const targetEmail = user?.email ? String(user.email).trim().toLowerCase() : null;

  return list.some(r => {
    const isExp = r.reviewType === 'ordering-experience' || r.type === 'ordering_experience' || r.type === 'experience';
    if (!isExp) return false;
    const matchOrder = String(r.orderId || '').trim().toLowerCase() === String(orderId).trim().toLowerCase();
    if (matchOrder) {
      if (targetUid || targetEmail) {
        const rUid = String(r.userId || r.customerId || '').trim();
        const rEmail = String(r.customerEmail || '').trim().toLowerCase();
        if (targetUid && rUid && rUid === targetUid) return true;
        if (targetEmail && rEmail && rEmail === targetEmail) return true;
        if (targetEmail && user && rUid && (rUid === String(user.id) || rUid === String(user.customerId))) return true;
        return false;
      }
      return true;
    }
    return false;
  });
}

export function normalizeStatus(status) {
  if (!status) return '';
  return String(status).toLowerCase().trim().replace(/_/g, '-');
}

export function isCustomerOrderOwner(order, user) {
  if (!order) return false;
  const u = user || getCurrentUser();
  if (!u) return false;

  const uId = String(u.id || u.customerId || u.uid || '').trim();
  const uFbUid = String(u.firebaseUid || (typeof auth !== 'undefined' && auth?.currentUser?.uid) || '').trim();
  const uEmail = String(u.email || (typeof auth !== 'undefined' && auth?.currentUser?.email) || '').trim().toLowerCase();

  const oUserId = String(order.userId || '').trim();
  const oCustomerId = String(order.customerId || '').trim();
  const oFbUid = String(order.firebaseUid || '').trim();
  const oCustomerEmail = String(order.customerEmail || '').trim().toLowerCase();
  const oUserEmail = String(order.userEmail || '').trim().toLowerCase();
  const oOwnerEmail = String(order.ownerEmail || '').trim().toLowerCase();
  const oEmail = String(order.email || '').trim().toLowerCase();

  // 1. Current user ID matches order.userId or order.customerId
  if (uId && oUserId && uId === oUserId) return true;
  if (uId && oCustomerId && uId === oCustomerId) return true;

  // 2. Firebase Auth UID matching
  if (uFbUid && oFbUid && uFbUid === oFbUid) return true;
  if (uFbUid && oUserId && (uFbUid === oUserId || `user-${uFbUid}` === oUserId || uFbUid === oUserId.replace(/^user-/, ''))) return true;
  if (uFbUid && oCustomerId && (uFbUid === oCustomerId || `user-${uFbUid}` === oCustomerId || uFbUid === oCustomerId.replace(/^user-/, ''))) return true;
  if (uId && oFbUid && (uId === oFbUid || uId.replace(/^user-/, '') === oFbUid || `user-${oFbUid}` === uId)) return true;

  // 3. ID prefix normalization match (e.g. user-XXXX vs XXXX)
  if (uId && oUserId && uId.replace(/^user-/, '') === oUserId.replace(/^user-/, '')) return true;
  if (uId && oCustomerId && uId.replace(/^user-/, '') === oCustomerId.replace(/^user-/, '')) return true;

  // 4. Storage path containing authenticated Firebase UID
  if (uFbUid && order.storagePath && typeof order.storagePath === 'string' && order.storagePath.includes(`/${uFbUid}/`)) {
    return true;
  }

  // 5. Customer email matching (customerEmail / userEmail / ownerEmail / email)
  const oEmails = [oCustomerEmail, oUserEmail, oOwnerEmail, oEmail].filter(Boolean);
  if (uEmail && oEmails.includes(uEmail)) return true;

  return false;
}

export function isOrderDeliveredOrCompleted(order) {
  if (!order) return false;
  const s = normalizeStatus(order.status);
  return s === 'delivered' || s === 'completed' || s === 'order-completed' || s === 'order completed';
}

export function isOrderEligibleForReview(orderOrId, user) {
  if (!orderOrId) return false;
  let order = orderOrId;
  if (typeof orderOrId !== 'object' || orderOrId === null) {
    const orders = getOrders();
    order = orders.find(o => String(o.id).trim().toLowerCase() === String(orderOrId).trim().toLowerCase());
  }
  if (!order) return false;

  const u = user || getCurrentUser();
  if (!u) return false;

  // 1. Authenticated customer ownership check
  if (!isCustomerOrderOwner(order, u)) return false;

  // 2. Delivered / Completed status check
  if (!isOrderDeliveredOrCompleted(order)) return false;

  return true;
}

export function isOrderFullyReviewed(orderId, userId) {
  const orders = getOrders();
  const order = orders.find(o => String(o.id).trim().toLowerCase() === String(orderId).trim().toLowerCase());
  if (!order) return true;
  const u = userId || getCurrentUser()?.id;

  // Check products in order
  const items = (Array.isArray(order.items) && order.items.length > 0) ? order.items : [{
    product: { id: order.productId, name: order.productName || 'Rice Product' },
    quantity: order.quantity || 1
  }];

  for (const item of items) {
    const pId = item.productId || item.id || (item.product && item.product.id) || item.name || (item.product && item.product.name);
    if (pId && !hasReviewedProduct(order.id, pId, u)) {
      return false;
    }
  }

  // Check ordering experience
  if (!hasReviewedOrderingExperience(order.id, u)) {
    return false;
  }

  return true;
}

export async function submitProductReview({ orderId, productId, productName, rating, title, comment, photos = [] }) {
  const user = getCurrentUser();
  if (!user || (!user.id && !user.customerId && !user.email)) {
    return { success: false, error: 'You must be logged in to submit a review.' };
  }

  const orders = getOrders();
  const order = orders.find(o => String(o.id).trim().toLowerCase() === String(orderId).trim().toLowerCase());
  if (!order) {
    return { success: false, error: 'Order not found.' };
  }

  // Owner verification (Test 10 & Multi-identifier)
  if (!isCustomerOrderOwner(order, user)) {
    return { success: false, error: 'You can only review your own orders.' };
  }

  // Status verification (Test 9 - Delivered or Completed)
  if (!isOrderDeliveredOrCompleted(order)) {
    return { success: false, error: 'Reviews are only allowed for delivered or completed orders.' };
  }

  // Product in order verification (Test 8)
  const items = (Array.isArray(order.items) && order.items.length > 0) ? order.items : [{
    product: { id: order.productId, name: order.productName || 'Rice Product' },
    productId: order.productId,
    name: order.productName
  }];

  const targetItem = items.find(it => {
    const itId = String(it.productId || it.id || (it.product && it.product.id) || '').trim();
    const itName = String(it.name || (it.product && it.product.name) || '').trim().toLowerCase();
    const pIdStr = String(productId || '').trim();
    const pNameStr = String(productName || '').trim().toLowerCase();

    const idMatch = itId && (itId === pIdStr);
    const nameMatch = itName && (itName === pNameStr || itName === pIdStr.toLowerCase());
    return idMatch || nameMatch;
  });

  if (!targetItem) {
    return { success: false, error: 'This product was not part of your completed order.' };
  }

  // Duplicate check (Test 11)
  const effectiveProdId = targetItem.productId || targetItem.id || (targetItem.product && targetItem.product.id) || productId;
  if (hasReviewedProduct(order.id, effectiveProdId, user.id)) {
    return { success: false, error: 'You have already reviewed this product for this order.' };
  }

  // Rating validation (Test 3)
  const numRating = parseInt(rating, 10);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    return { success: false, error: 'Please select a star rating between 1 and 5.' };
  }

  // Title and comment validation (Test 4)
  const cleanTitle = (title || '').trim();
  const cleanComment = (comment || '').trim();
  if (!cleanTitle) {
    return { success: false, error: 'Please provide a review headline/title.' };
  }
  if (!cleanComment) {
    return { success: false, error: 'Please provide your review details.' };
  }

  // Photo limit check (Test 13 - max 5 photos)
  let cleanPhotos = [];
  if (Array.isArray(photos)) {
    if (photos.length > 5) {
      return { success: false, error: 'Maximum 5 photos allowed per review.' };
    }
    cleanPhotos = photos.slice(0, 5);
  }

  const finalProdName = targetItem.product?.name || targetItem.name || productName || 'Rice Product';
  const uId = String(user.id || user.customerId || '');
  const uEmail = String(user.email || order.customerEmail || '').trim().toLowerCase();
  const uName = user.fullName || user.name || 'Verified Customer';

  const newReview = {
    id: 'rev-prod-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    reviewType: 'product',
    type: 'product',
    orderId: String(order.id),
    productId: String(effectiveProdId),
    productName: finalProdName,
    userId: uId,
    customerId: uId,
    customerEmail: uEmail,
    name: uName,
    customerName: uName,
    userName: uName,
    rating: numRating,
    title: cleanTitle,
    comment: cleanComment,
    photos: cleanPhotos,
    verifiedPurchase: true,
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };

  const res = await addReview(newReview);
  return res;
}

export async function submitOrderingExperienceReview({ orderId, rating, comment = '' }) {
  const user = getCurrentUser();
  if (!user || (!user.id && !user.customerId && !user.email)) {
    return { success: false, error: 'You must be logged in to submit a review.' };
  }

  const orders = getOrders();
  const order = orders.find(o => String(o.id).trim().toLowerCase() === String(orderId).trim().toLowerCase());
  if (!order) {
    return { success: false, error: 'Order not found.' };
  }

  // Owner verification (Test 10 & Multi-identifier)
  if (!isCustomerOrderOwner(order, user)) {
    return { success: false, error: 'You can only review your own orders.' };
  }

  // Status verification (Test 9 - Delivered or Completed)
  if (!isOrderDeliveredOrCompleted(order)) {
    return { success: false, error: 'Reviews are only allowed for delivered or completed orders.' };
  }

  // Duplicate check (Test 12)
  if (hasReviewedOrderingExperience(order.id, user.id)) {
    return { success: false, error: 'You have already submitted an ordering experience review for this order.' };
  }

  // Rating validation (Test 6)
  const numRating = parseInt(rating, 10);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    return { success: false, error: 'Please select a star rating between 1 and 5.' };
  }

  const uId = String(user.id || user.customerId || '');
  const uEmail = String(user.email || order.customerEmail || '').trim().toLowerCase();
  const uName = user.fullName || user.name || 'Verified Customer';

  const newReview = {
    id: 'rev-exp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    reviewType: 'ordering-experience',
    type: 'ordering_experience',
    orderId: String(order.id),
    userId: uId,
    customerId: uId,
    customerEmail: uEmail,
    name: uName,
    customerName: uName,
    userName: uName,
    rating: numRating,
    title: 'Ordering Experience',
    comment: (comment || '').trim() || 'Smooth ordering, timely delivery, and verified transactions.',
    photos: [],
    verifiedPurchase: true,
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };

  const res = await addReview(newReview);
  return res;
}

export async function addReview(review) {
  if (!review) return { success: false, error: 'Review object is required.' };

  if (!review.id) {
    review.id = 'rev-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 7);
  }
  const user = getCurrentUser();
  if (user && !review.userId) {
    review.userId = String(user.id || user.customerId || '');
  }
  if (review.userId && !review.customerId) {
    review.customerId = review.userId;
  }
  if (user && !review.customerEmail && user.email) {
    review.customerEmail = String(user.email).trim().toLowerCase();
  }
  if (!review.name && user) {
    review.name = user.fullName || user.name || 'Verified Customer';
  }
  if (!review.customerName) {
    review.customerName = review.name || 'Verified Customer';
  }
  if (!review.userName) {
    review.userName = review.customerName;
  }
  if (!review.date) {
    review.date = new Date().toISOString().split('T')[0];
  }
  if (!review.createdAt) {
    review.createdAt = new Date().toISOString();
  }
  if (review.verifiedPurchase === undefined) {
    review.verifiedPurchase = true;
  }

  // 1. Direct write to Firestore reviews collection (Primary & Authoritative source)
  try {
    await saveFirestoreDoc('reviews', review.id, review);
  } catch (err) {
    console.error('[REVIEWS] Failed to write review to Firestore:', err);
    return { success: false, error: 'Could not save review to cloud database. Please try again.' };
  }

  // 2. Only after the Firestore write succeeds, update the local aurora-reviews cache
  const list = getReviews(true);
  const existingIdx = list.findIndex(r => String(r.id) === String(review.id));
  if (existingIdx !== -1) {
    list[existingIdx] = review;
  } else {
    list.unshift(review);
  }
  safeLocalStorageSet('aurora-reviews', JSON.stringify(list));

  // 3. Dispatch events to notify UI and listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-reviews' } }));
    window.dispatchEvent(new CustomEvent('aurora-reviews-updated', { detail: { review } }));
  }

  return { success: true, review };
}

export function getContactMessages() {
  const raw = localStorage.getItem('aurora-messages') || '[]';
  const list = JSON.parse(raw);
  const user = getCurrentUser();
  if (!user) return [];
  return list.filter(m => m.userId === user.id);
}

export async function saveContactMessage(msg) {
  const user = getCurrentUser();
  const timestamp = Date.now();
  const inquiryId = msg.id || ('msg-' + timestamp);

  const newMessage = {
    id: inquiryId,
    userId: user ? user.id : 'guest',
    name: (msg.name || '').trim(),
    email: (msg.email || '').trim(),
    phone: (user && user.phone) ? user.phone : (msg.phone || '').trim(),
    subject: (msg.subject || '').trim(),
    message: (msg.message || '').trim(),
    status: msg.status || 'Unread',
    createdAt: msg.createdAt || new Date().toISOString()
  };

  // 1. PRIMARY AND PERMANENT SOURCE OF TRUTH: Firebase Firestore contactMessages
  // This will reject/throw if network fails or Firestore write does not succeed.
  await saveContactMessageDoc(newMessage);

  // 2. Only after Firestore write succeeds: Update local cache
  const raw = localStorage.getItem('aurora-messages') || '[]';
  const list = JSON.parse(raw);
  const existingIdx = list.findIndex(m => m.id === newMessage.id);
  if (existingIdx !== -1) {
    list[existingIdx] = newMessage;
  } else {
    list.unshift(newMessage);
  }
  localStorage.setItem('aurora-messages', JSON.stringify(list));

  // 3. ONE genuine notification event for Admin/Staff using existing addNotification
  addNotification(
    'admin',
    'New Customer Inquiry',
    `${newMessage.name} sent a new inquiry: ${newMessage.subject}.`,
    {
      type: 'inquiry',
      targetType: 'contact',
      recordType: 'contact',
      targetId: newMessage.id,
      recordId: newMessage.id,
      destinationTab: 'inquiries'
    }
  );

  // 4. ONE genuine Activity Log using existing addActivityLog
  addActivityLog(
    'Customer Inquiry',
    'New customer inquiry submitted',
    `Customer: ${newMessage.name} — ${newMessage.subject}`
  );

  // 5. Fire sync events for local real-time reactive UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-messages' } }));
  }

  return newMessage;
}

export async function getAllContactMessages() {
  const admin = getCurrentAdmin();
  if (!admin) return [];

  // Fetch directly from Firestore collection contactMessages to guarantee fresh data
  try {
    const remote = await fetchFirestoreCollection('contactMessages');
    if (Array.isArray(remote)) {
      const localRaw = localStorage.getItem('aurora-messages') || '[]';
      const localList = JSON.parse(localRaw);
      const merged = mergeGenericCollections('contactMessages', localList, remote);
      // Sort newest first
      merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      localStorage.setItem('aurora-messages', JSON.stringify(merged));
      return merged;
    }
  } catch (err) {
    console.warn('[INQUIRIES] Error fetching contactMessages from Firestore:', err);
  }

  const localRaw = localStorage.getItem('aurora-messages') || '[]';
  const list = JSON.parse(localRaw);
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return list;
}

export async function updateInquiryStatus(inquiryId, newStatus) {
  if (!inquiryId || !newStatus) return;
  const admin = getCurrentAdmin();
  if (!admin) return;

  const localRaw = localStorage.getItem('aurora-messages') || '[]';
  const list = JSON.parse(localRaw);
  const item = list.find(m => String(m.id) === String(inquiryId));
  if (item) {
    item.status = newStatus;
    item.updatedAt = new Date().toISOString();
  }
  localStorage.setItem('aurora-messages', JSON.stringify(list));

  try {
    const updateData = item ? { ...item, status: newStatus, updatedAt: new Date().toISOString() } : { id: inquiryId, status: newStatus, updatedAt: new Date().toISOString() };
    await saveContactMessageDoc(updateData);
  } catch (err) {
    console.warn('[INQUIRIES] Error updating status in Firestore:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-messages' } }));
  }
}

// ---------------------- CART API ----------------------

export function getCart() {
  const user = getCurrentUser();
  const key = user ? `aurora-cart-${user.id}` : 'aurora-cart';
  return JSON.parse(localStorage.getItem(key) || '[]');
}

export function saveCart(cart) {
  const user = getCurrentUser();
  const key = user ? `aurora-cart-${user.id}` : 'aurora-cart';
  localStorage.setItem(key, JSON.stringify(cart));
}

export function addToCart(product, quantity, isReservation = false) {
  const cart = getCart();
  const existing = cart.find(item => item.product.id === product.id);
  if (existing) {
    existing.quantity += quantity;
    existing.isReservation = isReservation || existing.isReservation;
  } else {
    cart.push({ product, quantity, isReservation });
  }
  saveCart(cart);
}

export function removeFromCart(productId) {
  const cart = getCart().filter(item => item.product.id !== productId);
  saveCart(cart);
}

export function updateCartQty(productId, quantity) {
  if (quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  const cart = getCart().map(item => {
    if (item.product.id === productId) {
      item.quantity = quantity;
    }
    return item;
  });
  saveCart(cart);
}

export function clearCart() {
  saveCart([]);
}

export function clearCartItems(productIds) {
  const cart = getCart().filter(item => !productIds.includes(item.product.id));
  saveCart(cart);
}

// ---------------------- AUTH API ----------------------

export function getCurrentUser() {
  if (typeof window !== 'undefined' && window.__customerLogoutInProgress) {
    return null;
  }
  if (typeof localStorage === 'undefined' || localStorage.getItem('aurora-logged-in') !== 'true') {
    return null;
  }
  const saved = localStorage.getItem('aurora-user');
  if (!saved) return null;
  try {
    const user = JSON.parse(saved);
    if (!user || user.isArchived === true) {
      return null;
    }
    return user;
  } catch (_) {
    return null;
  }
}

export function getCurrentAdmin() {
  const saved = localStorage.getItem('aurora-admin-user');
  if (!saved) return null;
  try {
    const admin = JSON.parse(saved);
    if (!admin || !admin.role || (admin.role !== 'admin' && admin.role !== 'staff') || admin.isArchived) {
      return null;
    }
    return admin;
  } catch (_) {
    return null;
  }
}

export async function loginUser(emailOrUsername, password) {
  if (typeof window !== 'undefined') {
    window.__customerLogoutInProgress = false;
  }
  const cleanEmail = (emailOrUsername || '').trim().toLowerCase();
  if (!cleanEmail || !password) return false;

  // Check lockout first
  const remaining = checkLockout(cleanEmail);
  if (remaining) {
    throw new Error(`locked:${remaining}`);
  }

  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const hashedPassword = await hashPassword(password);

  let fbUid = null;
  let fbAuthRejected = false;

  // 1. Authoritative Firebase Authentication
  if (auth) {
    try {
      const userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      if (userCred && userCred.user) {
        fbUid = userCred.user.uid;
      }
    } catch (fbErr) {
      const code = fbErr?.code || '';
      console.log('[FIREBASE AUTH] Customer sign-in notice:', code || fbErr?.message);
      // If Firebase actively rejected the credentials, do not permit local fallback
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
        fbAuthRejected = true;
      }
    }
  }

  // If Firebase Authentication explicitly rejected the password, login MUST fail immediately!
  if (fbAuthRejected) {
    recordFailedAttempt(cleanEmail);
    return false;
  }

  // 2. If authenticated via Firebase (fbUid)
  if (fbUid) {
    // Authoritative check against Firestore customer and user records for archive status
    const archCheck = await checkCustomerArchivedInFirestore(cleanEmail, fbUid);
    if (archCheck && archCheck.isArchived === true) {
      // Immediately sign out and clear tokens
      if (auth && typeof signOut === 'function') {
        try { await signOut(auth); } catch (_) {}
      }
      localStorage.removeItem('aurora-user');
      localStorage.removeItem('aurora-logged-in');

      // Update local storage so this client is immediately aware
      const uIdx = users.findIndex(u => u.email && String(u.email).toLowerCase() === cleanEmail);
      if (uIdx !== -1) {
        users[uIdx].isArchived = true;
        users[uIdx].isActive = false;
        users[uIdx].status = 'Archived';
        safeLocalStorageSet('aurora-users', JSON.stringify(users));
      }
      const custs = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
      const cIdx = custs.findIndex(c => c.email && String(c.email).toLowerCase() === cleanEmail);
      if (cIdx !== -1) {
        custs[cIdx].isArchived = true;
        custs[cIdx].isActive = false;
        custs[cIdx].status = 'Archived';
        safeLocalStorageSet('aurora-customers', JSON.stringify(custs));
      }

      throw new Error('account-archived');
    }

    // Fetch authoritative customer and user profile from Firestore
    const remoteProfile = await fetchCustomerProfileFromFirestore(cleanEmail, fbUid);
    if (remoteProfile && remoteProfile.isArchived === true) {
      if (auth && typeof signOut === 'function') {
        try { await signOut(auth); } catch (_) {}
      }
      localStorage.removeItem('aurora-user');
      localStorage.removeItem('aurora-logged-in');
      throw new Error('account-archived');
    }

    const matchedIdx = users.findIndex(u => {
      if (!u.email || String(u.email).trim().toLowerCase() !== cleanEmail) return false;
      return true;
    });

    if (matchedIdx !== -1) {
      const matched = users[matchedIdx];
      if (matched.isArchived === true) {
        if (auth && typeof signOut === 'function') {
          try { await signOut(auth); } catch (_) {}
        }
        localStorage.removeItem('aurora-user');
        localStorage.removeItem('aurora-logged-in');
        throw new Error('account-archived');
      }

      // Merge with remote profile if available (remote profile is source of truth)
      const mergedUser = {
        ...matched,
        ...(remoteProfile || {}),
        firebaseUid: fbUid,
        password: hashedPassword
      };

      users[matchedIdx] = mergedUser;
      safeLocalStorageSet('aurora-users', JSON.stringify(users));
      syncUsersAndCustomers();

      resetFailedAttempts(cleanEmail);
      localStorage.setItem('aurora-user', JSON.stringify(mergedUser));
      localStorage.setItem('aurora-logged-in', 'true');
      if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
        try { renderLayout(); } catch (_) {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user' } }));
      }
      return true;
    }

    // If local record was missing from users array, restore authoritatively from remoteProfile or customer ledger
    const customers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
    const matchedCustomer = customers.find(c => c.email && String(c.email).trim().toLowerCase() === cleanEmail);
    if (matchedCustomer && matchedCustomer.isArchived === true) {
      if (auth && typeof signOut === 'function') {
        try { await signOut(auth); } catch (_) {}
      }
      localStorage.removeItem('aurora-user');
      localStorage.removeItem('aurora-logged-in');
      throw new Error('account-archived');
    }
    
    // Construct or restore user record safely using remoteProfile as primary source of truth
    const restoredUser = remoteProfile ? {
      ...remoteProfile,
      firebaseUid: fbUid,
      password: hashedPassword
    } : {
      id: matchedCustomer?.id ? (String(matchedCustomer.id).startsWith('user-') ? matchedCustomer.id : `user-${matchedCustomer.id}`) : `user-${fbUid}`,
      firebaseUid: fbUid,
      fullName: matchedCustomer?.name || matchedCustomer?.fullName || cleanEmail.split('@')[0],
      email: cleanEmail,
      phone: matchedCustomer?.phone || '',
      address: matchedCustomer?.shippingAddress || matchedCustomer?.address || '',
      gender: matchedCustomer?.gender || 'Other',
      password: hashedPassword,
      role: 'customer',
      createdAt: matchedCustomer?.createdAt || new Date().toISOString()
    };

    users.push(restoredUser);
    safeLocalStorageSet('aurora-users', JSON.stringify(users));
    syncUsersAndCustomers();

    resetFailedAttempts(cleanEmail);
    localStorage.setItem('aurora-user', JSON.stringify(restoredUser));
    localStorage.setItem('aurora-logged-in', 'true');
    if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
      try { renderLayout(); } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user' } }));
    }
    return true;
  }

  // 3. Fallback: Only for legacy local accounts NOT yet provisioned in Firebase Auth
  const legacyArchCheck = await checkCustomerArchivedInFirestore(cleanEmail, null);
  if (legacyArchCheck && legacyArchCheck.isArchived === true) {
    throw new Error('account-archived');
  }

  const isLocallyArchived = users.some(u => u.email && String(u.email).trim().toLowerCase() === cleanEmail && u.isArchived === true);
  if (isLocallyArchived) {
    throw new Error('account-archived');
  }

  const matchedIdx = users.findIndex(u => {
    if (!u.email || String(u.email).trim().toLowerCase() !== cleanEmail) return false;
    if (u.isArchived) return false;

    // If this local account already has a linked firebaseUid, Firebase Auth was required above
    if (u.firebaseUid) return false;

    const isStoredHashed = u.password && u.password.length === 64 && /^[0-9a-f]{64}$/i.test(u.password);
    if (isStoredHashed) {
      return u.password === hashedPassword;
    } else {
      if (u.password === password) {
        u.password = hashedPassword;
        localStorage.setItem('aurora-users', JSON.stringify(users));
        return true;
      }
      return false;
    }
  });

  if (matchedIdx !== -1) {
    const matched = users[matchedIdx];

    // Auto-provision into Firebase Auth
    if (auth) {
      try {
        const newCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (newCred && newCred.user) {
          fbUid = newCred.user.uid;
          matched.firebaseUid = fbUid;
        }
      } catch (createErr) {
        // If email already exists in Firebase, Firebase Auth is authoritative and the password was incorrect
        if (createErr.code === 'auth/email-already-in-use') {
          recordFailedAttempt(cleanEmail);
          return false;
        }
      }
    }

    matched.password = hashedPassword;
    users[matchedIdx] = matched;
    setItemAndSync('aurora-users', JSON.stringify(users), { colName: 'users', docId: matched.id, docData: matched });
    syncUsersAndCustomers();

    resetFailedAttempts(cleanEmail);
    localStorage.setItem('aurora-user', JSON.stringify(matched));
    localStorage.setItem('aurora-logged-in', 'true');
    if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
      try { renderLayout(); } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user' } }));
    }
    return true;
  }

  // Record failed attempt
  recordFailedAttempt(cleanEmail);
  return false;
}

export async function registerUser(userData) {
  const firstName = (userData.firstName || '').trim();
  const lastName = (userData.lastName || '').trim();
  const email = (userData.email || '').trim();
  const phone = (userData.phone || '').trim();
  const address = (userData.address || '').trim();
  const gender = (userData.gender || '').trim();
  const password = userData.password || '';

  if (!firstName) {
    throw new Error('Please enter your First Name.');
  }
  if (!lastName) {
    throw new Error('Please enter your Last Name.');
  }
  if (!email) {
    throw new Error('Please enter your Email Address.');
  }
  if (!phone) {
    throw new Error('Please enter your Contact Number.');
  }
  if (!address) {
    throw new Error('Please enter your Address.');
  }
  if (!gender) {
    throw new Error('Please select your Gender.');
  }
  if (!password) {
    throw new Error('Please enter your Password.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Please enter a valid email address format (e.g., username@domain.com).');
  }

  const normPhone = normalizePhilippinePhone(phone);
  if (!normPhone.isValid) {
    throw new Error('Please enter a valid Philippine mobile number.');
  }

  if (checkEmailExists(email)) {
    throw new Error('This email address is already registered. Please use a different email address.');
  }

  if (checkPhoneExists(normPhone.canonical)) {
    throw new Error('This phone number is already registered. Please use a different number or log in to your existing account.');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(password)) {
    throw new Error('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.');
  }

  let fbUid = null;
  if (auth) {
    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      if (userCred && userCred.user) {
        fbUid = userCred.user.uid;
      }
    } catch (fbErr) {
      if (fbErr.code === 'auth/email-already-in-use') {
        try {
          const reCred = await signInWithEmailAndPassword(auth, email, password);
          if (reCred && reCred.user) {
            fbUid = reCred.user.uid;
          }
        } catch (reErr) {
          throw new Error('This email address is already registered in Firebase Auth.');
        }
      } else {
        throw new Error(`Registration failed in Firebase Auth: ${fbErr.message}`);
      }
    }
  }

  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const fullName = `${firstName} ${lastName}`;

  const sanitizedUser = {
    firstName: sanitizeInput(firstName),
    lastName: sanitizeInput(lastName),
    fullName: sanitizeInput(fullName),
    name: sanitizeInput(fullName),
    username: sanitizeInput((email || '').split('@')[0]),
    email: sanitizeInput(String(email || '').toLowerCase()),
    phone: normPhone.canonical,
    phoneE164: normPhone.e164,
    phoneVerified: false,
    address: sanitizeInput(address),
    gender: sanitizeInput(gender)
  };

  const hashedPassword = await hashPassword(password);

  const newUser = {
    id: 'user-' + Date.now(),
    ...sanitizedUser,
    password: hashedPassword,
    firebaseUid: fbUid || null,
    isArchived: false,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  setItemAndSync('aurora-users', JSON.stringify(users));
  
  // Instantly synchronize with customer ledger
  syncUsersAndCustomers();

  // Persist newly generated customer record directly to Firestore customers collection
  try {
    const allCustomers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
    const cleanEmail = String(email || '').trim().toLowerCase();
    const matchedCustomer = allCustomers.find(c => {
      if (!c) return false;
      const cid = String(c.id || c.customerId || '').trim();
      const cUid = String(c.uid || c.firebaseUid || '').trim();
      const cEmail = String(c.email || '').trim().toLowerCase();
      return (cleanEmail && cEmail === cleanEmail) ||
             (fbUid && (cUid === fbUid || cid === fbUid)) ||
             (newUser.id && (cid === newUser.id || cUid === newUser.id));
    });

    let maxCusNum = 0;
    allCustomers.forEach(cust => {
      const match = String(cust.customerId || '').match(/^CUS-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCusNum) maxCusNum = num;
      }
    });
    const nextCustomerId = `CUS-${String(maxCusNum + 1).padStart(6, '0')}`;

    const custPayload = matchedCustomer ? {
      ...matchedCustomer,
      isVIP: matchedCustomer.isVIP ?? false
    } : {
      id: newUser.id,
      customerId: nextCustomerId,
      uid: fbUid || newUser.id,
      firebaseUid: fbUid || null,
      name: newUser.fullName,
      fullName: newUser.fullName,
      email: newUser.email,
      phone: newUser.phone,
      phoneE164: newUser.phoneE164,
      phoneVerified: false,
      address: newUser.address,
      shippingAddress: newUser.address,
      gender: newUser.gender || 'Female',
      profilePicture: null,
      totalSpent: 0,
      status: 'Active',
      isActive: true,
      isArchived: false,
      isVIP: false,
      recentOrders: [],
      createdAt: newUser.createdAt,
      updatedAt: newUser.createdAt
    };

    const custDocId = custPayload.id || newUser.id;
    await saveFirestoreDoc('customers', custDocId, custPayload);
  } catch (custErr) {
    console.warn('[FIREBASE] Notice saving customer to Firestore:', custErr);
  }

  // Also persist user document to Firestore users collection
  try {
    const userDocId = newUser.id || fbUid;
    if (userDocId) {
      await saveFirestoreDoc('users', userDocId, newUser);
      if (fbUid && fbUid !== userDocId) {
        saveFirestoreDoc('users', fbUid, newUser).catch(() => {});
      }
    }
  } catch (_) {}

  // Set session cache
  localStorage.setItem('aurora-user', JSON.stringify(newUser));
  localStorage.setItem('aurora-logged-in', 'true');
  
  return true;
}

export function updateUserPhoneVerified(userIdOrEmail, phoneInfo) {
  if (!userIdOrEmail || !phoneInfo) return null;
  const canonical = phoneInfo.canonical || phoneInfo.phone;
  const e164 = phoneInfo.e164 || phoneInfo.phoneE164;
  
  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const userIdx = users.findIndex(u => 
    (u.id && String(u.id) === String(userIdOrEmail)) || 
    (u.email && String(u.email).toLowerCase() === String(userIdOrEmail).toLowerCase())
  );
  
  let updatedUser = null;
  if (userIdx !== -1) {
    users[userIdx].phone = canonical;
    users[userIdx].phoneE164 = e164;
    users[userIdx].phoneVerified = true;
    users[userIdx].phoneVerifiedAt = new Date().toISOString();
    updatedUser = users[userIdx];
    const uDocId = updatedUser.id || updatedUser.firebaseUid || String(userIdOrEmail);
    setItemAndSync('aurora-users', JSON.stringify(users), { colName: 'users', docId: uDocId, docData: updatedUser });
    if (typeof saveFirestoreDoc === 'function') {
      saveFirestoreDoc('users', uDocId, updatedUser).catch(e => console.warn('[FIREBASE] updateUserPhoneVerified write error:', e));
    }
  }
  
  // Update active session if matching
  const current = getCurrentUser();
  if (current && (
    (current.id && String(current.id) === String(userIdOrEmail)) ||
    (current.email && String(current.email).toLowerCase() === String(userIdOrEmail).toLowerCase())
  )) {
    current.phone = canonical;
    current.phoneE164 = e164;
    current.phoneVerified = true;
    current.phoneVerifiedAt = new Date().toISOString();
    localStorage.setItem('aurora-user', JSON.stringify(current));
    if (!updatedUser) updatedUser = current;
  }
  
  syncUsersAndCustomers();
  return updatedUser;
}

export function logoutUser() {
  const admin = getCurrentAdmin();
  if (admin) {
    const target = admin.role === 'admin' ? 'Admin Portal' : 'Staff Portal';
    addActivityLog('Authentication', 'Logged out of the system', target);
  }
  localStorage.removeItem('aurora-user');
  localStorage.setItem('aurora-logged-in', 'false');
  localStorage.removeItem('aurora-admin-user');
  localStorage.setItem('aurora-admin-logged-in', 'false');
  sessionStorage.removeItem('login-redirect');
  sessionStorage.removeItem('riceflow_customer_active_order_id');
  localStorage.removeItem('riceflow_customer_active_order_id');
  sessionStorage.removeItem('riceflow_customer_active_tab');
  localStorage.removeItem('riceflow_customer_active_tab');

  // Immediately refresh customer header/account UI to logged-out Login state
  if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
    try {
      renderLayout();
    } catch (_) {}
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user', loggedOut: true } }));
  }

  if (auth && typeof signOut === 'function') {
    return signOut(auth).catch(err => console.warn('[FIREBASE AUTH] Signout error:', err));
  }
  return Promise.resolve();
}

export async function loginAdmin(email, password) {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !password) return false;

  // Check lockout first
  const remaining = checkLockout(cleanEmail);
  if (remaining) {
    throw new Error(`locked:${remaining}`);
  }

  if (!auth) {
    throw new Error('Authentication service is currently unavailable.');
  }

  // 1. Authoritative Firebase Authentication
  let userCred = null;
  try {
    userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  } catch (fbErr) {
    const code = fbErr?.code || '';
    console.log('[FIREBASE AUTH] Admin sign-in notice:', code || fbErr?.message);
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/user-not-found'
    ) {
      recordFailedAttempt(cleanEmail);
      return false;
    }
    throw fbErr;
  }

  if (!userCred || !userCred.user) {
    recordFailedAttempt(cleanEmail);
    return false;
  }

  const authenticatedUser = userCred.user;
  const fbUid = authenticatedUser.uid;

  // 2. Authoritative Firestore Role Verification from adminUsers collection
  let adminRecord = null;
  try {
    adminRecord = await fetchAdminUserFromFirestore(fbUid, cleanEmail);
  } catch (lookupErr) {
    console.warn('[FIREBASE] Error verifying admin role in Firestore:', lookupErr);
  }

  // If Firestore query returned null, fallback to local adminUsers array
  if (!adminRecord) {
    const localAdmins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
    adminRecord = localAdmins.find(a => {
      if (!a || a.isArchived) return false;
      const aUid = a.firebaseUid || a.id;
      const aEmail = String(a.email || '').toLowerCase().trim();
      return (aUid && aUid === fbUid) || (aEmail && aEmail === cleanEmail);
    }) || null;
  }

  // 3. Strict Role & Active Status Enforcement
  if (!adminRecord || (adminRecord.role !== 'admin' && adminRecord.role !== 'staff') || adminRecord.isArchived === true) {
    // If the authenticated Firebase user has no matching authorized adminUsers record, sign them out and deny access
    try {
      await signOut(auth);
    } catch (_) {}
    console.warn('[RBAC] User authenticated via Firebase Auth but is not authorized in Firestore adminUsers.');
    recordFailedAttempt(cleanEmail);
    return false;
  }

  const roleCode = adminRecord.role === 'admin' ? 'admin' : 'staff';

  const adminSession = {
    id: adminRecord.id || fbUid,
    firebaseUid: fbUid,
    email: cleanEmail,
    name: adminRecord.name || (roleCode === 'admin' ? 'Administrator' : 'Staff Member'),
    role: roleCode,
    status: adminRecord.status || 'Active',
    isArchived: false,
    phone: adminRecord.phone || '',
    avatar: adminRecord.avatar || ''
  };

  // Sync to local session state
  resetFailedAttempts(cleanEmail);
  localStorage.setItem('aurora-admin-user', JSON.stringify(adminSession));
  localStorage.setItem('aurora-admin-logged-in', 'true');

  // Update local adminUsers list
  const localAdmins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
  const existingIdx = localAdmins.findIndex(a => a && (a.firebaseUid === fbUid || String(a.email || '').toLowerCase().trim() === cleanEmail));
  if (existingIdx !== -1) {
    localAdmins[existingIdx] = { ...localAdmins[existingIdx], ...adminSession };
  } else {
    localAdmins.push(adminSession);
  }
  localStorage.setItem('aurora-admin-users', JSON.stringify(localAdmins));

  try {
    saveFirestoreDoc('adminUsers', fbUid, adminSession).catch(() => {});
    if (adminRecord.id && adminRecord.id !== fbUid) {
      saveFirestoreDoc('adminUsers', adminRecord.id, adminSession).catch(() => {});
    }
  } catch (_) {}

  try {
    initFirestoreSync(true).catch(e => console.warn('[FIREBASE] Admin login sync notice:', e));
  } catch (_) {}

  const target = roleCode === 'admin' ? 'Admin Portal' : 'Staff Portal';
  addActivityLog('Authentication', 'Logged into the system', target);
  return true;
}

export function logoutAdmin() {
  if (auth) {
    signOut(auth).catch(err => console.warn('[FIREBASE AUTH] Admin signout error:', err));
  }
  const admin = getCurrentAdmin();
  if (admin) {
    const target = admin.role === 'admin' ? 'Admin Portal' : 'Staff Portal';
    addActivityLog('Authentication', 'Logged out of the system', target);
  }
  localStorage.removeItem('aurora-admin-user');
  localStorage.setItem('aurora-admin-logged-in', 'false');
}

export function saveCurrentUser(user) {
  safeLocalStorageSet('aurora-user', JSON.stringify(user));
  // also save to list and sync targeted user document
  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const uidStr = String(user.id || user.uid || user.firebaseUid || '');
  const userEmail = String(user.email || '').trim().toLowerCase();

  let userIdx = users.findIndex(u => {
    if (!u) return false;
    const uUidStr = String(u.id || u.uid || u.firebaseUid || '');
    const uEmail = String(u.email || '').trim().toLowerCase();
    if (uidStr && uUidStr && uidStr === uUidStr) return true;
    if (userEmail && uEmail && userEmail === uEmail) return true;
    return false;
  });

  if (userIdx !== -1) {
    users[userIdx] = { ...users[userIdx], ...user };
  } else {
    users.push(user);
  }

  const syncDocId = user.id || user.uid || user.firebaseUid || (user.email ? user.email.replace(/[@.]/g, '_') : 'user_main');
  setItemAndSync('aurora-users', JSON.stringify(users), { colName: 'users', docId: syncDocId, docData: user });
}

export async function updateUser(updatedFields) {
  const user = getCurrentUser();
  if (!user) return false;

  const sanitizedFields = {};
  for (const key in updatedFields) {
    if (key === 'profilePicture' || key === 'avatar') {
      // Preserve base64 image data strings and URLs without corrupting forward slashes via HTML entity escaping
      sanitizedFields[key] = updatedFields[key];
    } else if (typeof updatedFields[key] === 'string') {
      sanitizedFields[key] = sanitizeInput(updatedFields[key]);
    } else {
      sanitizedFields[key] = updatedFields[key];
    }
  }

  // If profilePicture was not provided or is null without an explicit removal request, preserve existing profilePicture
  if (
    (sanitizedFields.profilePicture === undefined || (sanitizedFields.profilePicture === null && !updatedFields.removeProfilePicture)) &&
    user.profilePicture
  ) {
    sanitizedFields.profilePicture = user.profilePicture;
  }

  const updatedAt = new Date().toISOString();
  const updatedUser = { 
    ...user, 
    ...sanitizedFields,
    updatedAt 
  };

  // 1. Authoritatively persist to Firebase Firestore FIRST
  // If Firestore write fails, this throws and prevents claiming success
  await saveCustomerProfileToFirestore(updatedUser);

  // 2. Update active user session
  saveCurrentUser(updatedUser);

  // 3. Update aurora-users cache
  try {
    const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
    const userEmail = String(user.email || '').trim().toLowerCase();
    const userId = String(user.id || '');
    const uIdx = users.findIndex(u => (userId && String(u.id) === userId) || (u.email && String(u.email).trim().toLowerCase() === userEmail));
    if (uIdx !== -1) {
      users[uIdx] = { ...users[uIdx], ...updatedUser };
    } else {
      users.push(updatedUser);
    }
    safeLocalStorageSet('aurora-users', JSON.stringify(users));
  } catch (e) {
    console.warn('[USER] Error updating aurora-users in updateUser:', e);
  }

  // 4. Update corresponding customer in aurora-customers cache
  try {
    let rawCustomers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
    const uidStr = String(user.id || user.uid || user.firebaseUid || '');
    const userEmail = String(user.email || '').trim().toLowerCase();

    const updatedCustomers = rawCustomers.map(c => {
      if (!c) return c;
      const cid = String(c.id || c.customerId || '');
      const cUid = String(c.uid || c.firebaseUid || '');
      const cEmail = String(c.email || '').trim().toLowerCase();

      const isMatch = (uidStr && (cid === uidStr || cUid === uidStr)) ||
                      (userEmail && cEmail && userEmail === cEmail);

      if (isMatch) {
        const newName = sanitizedFields.fullName || sanitizedFields.name || c.name;
        return {
          ...c,
          name: newName,
          fullName: newName,
          phone: sanitizedFields.phone !== undefined ? sanitizedFields.phone : c.phone,
          phoneE164: sanitizedFields.phoneE164 !== undefined ? sanitizedFields.phoneE164 : c.phoneE164,
          phoneVerified: sanitizedFields.phoneVerified !== undefined ? sanitizedFields.phoneVerified : c.phoneVerified,
          gender: sanitizedFields.gender || c.gender,
          shippingAddress: sanitizedFields.address !== undefined ? sanitizedFields.address : (sanitizedFields.shippingAddress !== undefined ? sanitizedFields.shippingAddress : c.shippingAddress),
          address: sanitizedFields.address !== undefined ? sanitizedFields.address : (sanitizedFields.shippingAddress !== undefined ? sanitizedFields.shippingAddress : (c.address || c.shippingAddress)),
          profilePicture: sanitizedFields.profilePicture !== undefined ? sanitizedFields.profilePicture : c.profilePicture,
          updatedAt
        };
      }
      return c;
    });

    safeLocalStorageSet('aurora-customers', JSON.stringify(updatedCustomers));
  } catch (e) {
    console.warn('[USER] Error updating aurora-customers in updateUser:', e);
  }

  syncUsersAndCustomers();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-user' } }));
    window.dispatchEvent(new CustomEvent('aurora-customers-updated', { detail: { key: 'aurora-customers' } }));
  }

  return true;
}

export function updateUserFromCustomer(client) {
  if (!client) return;
  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const userIdx = users.findIndex(u => String(u.id) === String(client.id) || (u.email && client.email && String(u.email).toLowerCase() === String(client.email).toLowerCase()));
  if (userIdx !== -1) {
    users[userIdx] = {
      ...users[userIdx],
      fullName: client.name || users[userIdx].fullName,
      email: client.email || users[userIdx].email,
      phone: client.phone !== undefined ? client.phone : users[userIdx].phone,
      gender: client.gender || users[userIdx].gender,
      address: client.shippingAddress || users[userIdx].address,
      isArchived: client.isArchived ?? false,
      isActive: client.isActive !== false,
      status: client.status || (client.isArchived ? 'Archived' : (client.isActive === false ? 'Suspended' : 'Active')),
      updatedAt: client.updatedAt || new Date().toISOString()
    };
    safeLocalStorageSet('aurora-users', JSON.stringify(users));

    const updatedUser = users[userIdx];
    const docId = updatedUser.id || updatedUser.firebaseUid || client.id || client.uid;
    if (docId) {
      saveFirestoreDoc('users', docId, updatedUser).catch(e => console.warn('[FIREBASE] updateUserFromCustomer write error:', e));
    }
  }
}

export function syncUsersAndCustomers() {
  let rawCustomers = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const orders = (JSON.parse(localStorage.getItem('aurora-orders') || '[]') || []).filter(o => !isStaleOrderOrReservation(o));
  
  // 1. Filter out corrupted, dummy, or stale records
  const validRaw = rawCustomers.filter(c => {
    if (!c) return false;
    if (isStaleCustomer(c)) return false;
    const cid = String(c.id || c.customerId || '');
    const email = String(c.email || '').toLowerCase().trim();
    const name = String(c.name || c.fullName || '').trim();
    if (['1', '2', '3', '4', 'CUS-000001', 'CUS-000002', 'CUS-000003', 'CUS-000004'].includes(cid) && !email && !c.uid) return false;
    if (/^customer\d+@gmail\.com$/.test(email)) return false;
    if (cid === 'demo-user-1' || email === 'hello@gmail.com' || name.toLowerCase() === 'demo customer') return false;
    if (name === 'undefined' || email === 'undefined') return false;
    if (!cid && !email && !name) return false;
    return true;
  });

  // 2. Authoritatively deduplicate customers by UID or Email or ID
  const deduplicatedCustomers = [];
  validRaw.forEach(c => {
    const uid = String(c.uid || c.firebaseUid || '').trim();
    const email = String(c.email || '').trim().toLowerCase();
    const id = String(c.id || c.customerId || '').trim();

    const existingIdx = deduplicatedCustomers.findIndex(existing => {
      const exUid = String(existing.uid || existing.firebaseUid || '').trim();
      const exEmail = String(existing.email || '').trim().toLowerCase();
      const exId = String(existing.id || existing.customerId || '').trim();
      return (uid && exUid && uid === exUid) ||
             (email && exEmail && email === exEmail) ||
             (id && exId && id === exId);
    });

    if (existingIdx === -1) {
      deduplicatedCustomers.push({ ...c });
    } else {
      const existing = deduplicatedCustomers[existingIdx];
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const cTime = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
      const cIsNewer = cTime > existingTime;

      // Prefer canonical ID format: prefer ID starting with user-178... or containing numeric timestamp
      const preferCId = (c.id && /^user-\d+$/.test(c.id)) && (!existing.id || !/^user-\d+$/.test(existing.id));
      const canonicalId = preferCId ? c.id : (existing.id || c.id);

      // Prefer customerId e.g. CUS-000001
      const canonicalCustomerId = (existing.customerId && existing.customerId.startsWith('CUS-')) ? existing.customerId : (c.customerId || existing.customerId);

      // Deduplicate recent orders by ID (excluding stale pre-reset orders)
      const ordersMap = new Map();
      const isRecentStale = (o) => {
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
      (existing.recentOrders || []).forEach(o => { if (!isRecentStale(o)) ordersMap.set(String(o.id), o); });
      (c.recentOrders || []).forEach(o => { if (!isRecentStale(o)) ordersMap.set(String(o.id), o); });

      const primary = cIsNewer ? c : existing;
      const fallback = cIsNewer ? existing : c;

      const merged = {
        ...fallback,
        ...primary,
        id: canonicalId,
        customerId: canonicalCustomerId,
        uid: existing.uid || c.uid || (existing.firebaseUid || c.firebaseUid),
        email: existing.email || c.email,
        name: primary.name || primary.fullName || fallback.name || fallback.fullName,
        fullName: primary.fullName || primary.name || fallback.fullName || fallback.name,
        phone: primary.phone || fallback.phone || '',
        phoneE164: primary.phoneE164 || fallback.phoneE164 || '',
        phoneVerified: primary.phoneVerified ?? (fallback.phoneVerified ?? false),
        shippingAddress: primary.shippingAddress || primary.address || fallback.shippingAddress || fallback.address || '',
        address: primary.address || primary.shippingAddress || fallback.address || fallback.shippingAddress || '',
        gender: primary.gender || fallback.gender || 'Female',
        profilePicture: primary.profilePicture || fallback.profilePicture || null,
        totalSpent: Math.max(parseFloat(existing.totalSpent) || 0, parseFloat(c.totalSpent) || 0),
        isArchived: primary.isArchived !== undefined ? Boolean(primary.isArchived) : Boolean(fallback.isArchived),
        recentOrders: Array.from(ordersMap.values()),
        updatedAt: primary.updatedAt || fallback.updatedAt || new Date().toISOString()
      };
      deduplicatedCustomers[existingIdx] = merged;
    }
  });

  let customers = deduplicatedCustomers;
  let changed = (customers.length !== rawCustomers.length);

  customers = customers.map((c, index) => {
    const cid = String(c.id || c.customerId || '');
    const cUid = String(c.uid || c.firebaseUid || '');
    const cEmail = String(c.email || '').trim().toLowerCase();

    // Match corresponding user record if available
    const u = users.find(user => {
      if (!user) return false;
      const uid = String(user.id || user.uid || user.firebaseUid || '');
      const uEmail = String(user.email || '').trim().toLowerCase();
      if (cid && uid === cid) return true;
      if (cUid && uid === cUid) return true;
      if (cEmail && uEmail && cEmail === uEmail) return true;
      return false;
    });

    const uTime = (u && u.updatedAt) ? new Date(u.updatedAt).getTime() : 0;
    const cTime = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
    let isArchived = false;
    if (cTime >= uTime) {
      isArchived = c.isArchived !== undefined ? Boolean(c.isArchived) : Boolean(u && u.isArchived);
    } else {
      isArchived = (u && u.isArchived !== undefined) ? Boolean(u.isArchived) : Boolean(c.isArchived);
    }
    const isSuspended = !isArchived && (c.status === 'Suspended' || c.status === 'Inactive' || c.isActive === false || (u && (u.status === 'Suspended' || u.status === 'Inactive' || u.isActive === false)));
    const accountStatus = isArchived ? 'Archived' : (isSuspended ? 'Suspended' : 'Active');
    const isActive = !isSuspended && !isArchived;

    // Determine final name: prevent reverting real name to email prefix
    const isEmailPrefix = (str, email) => {
      if (!str || !email) return false;
      return str.toLowerCase() === email.split('@')[0].toLowerCase();
    };

    const uName = u ? String(u.fullName || u.name || '').trim() : '';
    let finalName = c.fullName || c.name || '';
    if (uName && (!finalName || isEmailPrefix(finalName, cEmail) || (!isEmailPrefix(uName, cEmail) && uName.length >= finalName.length))) {
      finalName = uName;
    }
    if (!finalName) {
      finalName = cEmail ? cEmail.split('@')[0] : 'Customer';
    }

    const finalPhone = (u && u.phone) ? u.phone : (c.phone || '');
    const finalPhoneE164 = (u && u.phoneE164) ? u.phoneE164 : (c.phoneE164 || '');
    const finalPhoneVerified = (u && u.phoneVerified !== undefined) ? u.phoneVerified : (c.phoneVerified ?? false);
    const finalGender = (u && u.gender) ? u.gender : (c.gender || 'Female');
    const finalAddress = (u && (u.address || u.shippingAddress)) ? (u.address || u.shippingAddress) : (c.shippingAddress || c.address || '');

    const userOrders = orders.filter(o => {
      const oUserId = String(o.userId || o.uid || '');
      const oCusId = String(o.customerId || '');
      const oEmail = String(o.customerEmail || o.email || '').trim().toLowerCase();
      if (cid && (oUserId === cid || oCusId === cid)) return true;
      if (cUid && (oUserId === cUid || oCusId === cUid)) return true;
      if (cEmail && oEmail && cEmail === oEmail) return true;
      return false;
    });

    const totalSpent = userOrders.reduce((sum, o) => sum + getCustomerVerifiedSpentAmount(o), 0);

    const recentOrders = userOrders.map(o => {
      const firstProduct = o.items && o.items[0] ? o.items[0].productName || o.items[0].product?.name || 'Rice Sack' : 'Rice Sack';
      const prodDesc = o.items && o.items.length > 1 ? `${firstProduct} + ${o.items.length - 1} more` : firstProduct;
      const amt = parseFloat(o.totalPrice || o.amount || o.billTotal || 0);
      
      let mappedStatus = 'Pending';
      if (o.status) {
        const s = String(o.status).toLowerCase();
        if (s === 'delivered' || s === 'completed') mappedStatus = 'Delivered';
        else if (s === 'processing' || s === 'shipped' || s === 'processed') mappedStatus = 'Processing';
        else if (s === 'cancelled') mappedStatus = 'Cancelled';
      }
      
      return {
        id: o.id,
        date: new Date(o.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        product: prodDesc,
        amount: amt,
        status: mappedStatus
      };
    });

    let existingCid = c.customerId || c.uid || c.firebaseUid;
    let finalCid = existingCid;
    if (!existingCid || existingCid.startsWith('user-') || existingCid.startsWith('demo-user') || /^\d+$/.test(String(existingCid))) {
      finalCid = `CUS-${String(index + 1).padStart(6, '0')}`;
    }

    const updatedClient = {
      ...c,
      customerId: finalCid,
      uid: c.uid || (u ? u.uid || u.firebaseUid : null) || c.id,
      name: finalName,
      fullName: finalName,
      email: cEmail || (u ? String(u.email || '').trim().toLowerCase() : ''),
      phone: finalPhone,
      phoneE164: finalPhoneE164,
      phoneVerified: finalPhoneVerified,
      gender: finalGender,
      shippingAddress: finalAddress,
      address: finalAddress,
      profilePicture: (u && u.profilePicture) ? u.profilePicture : (c.profilePicture || null),
      totalSpent: userOrders.length > 0 ? totalSpent : 0,
      status: accountStatus,
      isActive: isActive,
      isArchived: isArchived,
      recentOrders: recentOrders.length > 0 ? recentOrders : (c.recentOrders || []).filter(o => {
        if (!o || !o.id) return false;
        const oid = String(o.id).trim();
        if (CONFIRMED_STALE_ORDER_IDS.has(oid) || CONFIRMED_STALE_RESERVATION_IDS.has(oid)) return false;
        if (o.date) {
          const dMs = new Date(`${o.date} 23:59:59`).getTime();
          const bMs = new Date(RESET_TIMESTAMP_BOUNDARY).getTime();
          if (!isNaN(dMs) && !isNaN(bMs) && dMs < bMs) return false;
        }
        return orders.some(validOrd => String(validOrd.id) === oid);
      })
    };

    if (JSON.stringify(c) !== JSON.stringify(updatedClient)) {
      changed = true;
    }

    return updatedClient;
  });

  // Ensure all registered customer users exist in aurora-customers ledger
  users.forEach((u) => {
    if (!u) return;
    if (isStaleUser(u)) return;
    const uid = String(u.id || u.uid || u.firebaseUid || '');
    const uEmail = String(u.email || '').trim().toLowerCase();
    
    // Skip if already in customers list
    const alreadyExists = customers.some(c => {
      const cid = String(c.id || c.customerId || '');
      const cUid = String(c.uid || c.firebaseUid || '');
      const cEmail = String(c.email || '').trim().toLowerCase();
      return (cid && uid === cid) || (cUid && uid === cUid) || (cEmail && uEmail && cEmail === uEmail);
    });

    if (!alreadyExists && (uEmail || u.fullName || u.name)) {
      changed = true;
      const userOrders = orders.filter(o => {
        const oUserId = String(o.userId || o.uid || '');
        const oEmail = String(o.customerEmail || o.email || '').trim().toLowerCase();
        return (uid && oUserId === uid) || (uEmail && oEmail && uEmail === oEmail);
      });

      const totalSpent = userOrders.reduce((sum, o) => sum + getCustomerVerifiedSpentAmount(o), 0);
      const isSuspended = u.status === 'Suspended' || u.status === 'Inactive' || u.isActive === false;
      const isArchived = u.isArchived ?? false;
      const accountStatus = isArchived ? 'Archived' : (isSuspended ? 'Suspended' : 'Active');
      const isActive = !isSuspended && !isArchived;

      const uName = String(u.fullName || u.name || '').trim() || (uEmail ? uEmail.split('@')[0] : 'Customer');

      let maxCusNum = 0;
      customers.forEach(cust => {
        const match = String(cust.customerId || '').match(/^CUS-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxCusNum) maxCusNum = num;
        }
      });
      const nextCustomerId = `CUS-${String(maxCusNum + 1).padStart(6, '0')}`;

      const newCustomerEntry = {
        id: uid || nextCustomerId,
        customerId: nextCustomerId,
        uid: u.firebaseUid || uid,
        name: uName,
        fullName: uName,
        email: uEmail,
        phone: u.phone || '',
        phoneE164: u.phoneE164 || '',
        phoneVerified: u.phoneVerified ?? false,
        gender: u.gender || 'Female',
        shippingAddress: u.address || '',
        address: u.address || '',
        profilePicture: u.profilePicture || null,
        totalSpent: totalSpent,
        status: accountStatus,
        isActive: isActive,
        isArchived: isArchived,
        recentOrders: []
      };
      customers.push(newCustomerEntry);
    }
  });

  if (changed) {
    safeLocalStorageSet('aurora-customers', JSON.stringify(customers));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-customers' } }));
    }
  }
}

export async function changePassword(currentPassword, newPassword) {
  const user = getCurrentUser();
  if (user) {
    const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
    const hashedCurrent = await hashPassword(currentPassword);
    const hashedNew = await hashPassword(newPassword);
    
    const foundUserIndex = users.findIndex(u => u.email === user.email);
    if (foundUserIndex !== -1) {
      const u = users[foundUserIndex];
      const isStoredHashed = u.password && u.password.length === 64 && /^[0-9a-f]{64}$/i.test(u.password);
      const matches = isStoredHashed ? (u.password === hashedCurrent) : (u.password === currentPassword);
      if (matches) {
        u.password = hashedNew;
        user.password = hashedNew;
        safeLocalStorageSet('aurora-user', JSON.stringify(user));
        safeLocalStorageSet('aurora-users', JSON.stringify(users));
        return true;
      }
    }
  }
  return false;
}

/**
 * Sends an authoritative Firebase Authentication password reset email configured
 * to open the custom RiceFlow branded password reset page.
 * @param {string} email - The customer's registered email address
 * @returns {Promise<{success: boolean}>}
 */
export async function sendUserPasswordReset(email) {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Please enter your email address.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  if (!auth) {
    throw new Error('Authentication service is currently unavailable. Please try again later.');
  }

  try {
    // ActionCodeSettings pointing to RiceFlow's custom reset-password page
    const currentOrigin = typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : 'https://rice-f0b23.firebaseapp.com';

    const customResetUrl = `${currentOrigin}/reset-password.html`;

    const actionCodeSettings = {
      url: customResetUrl,
      handleCodeInApp: true,
    };

    try {
      // First attempt: pass the application domain custom URL
      await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
      return { success: true };
    } catch (codeSettingsErr) {
      const subCode = codeSettingsErr?.code || '';
      console.warn('[FIREBASE AUTH] Notice for action code continue URI:', subCode, codeSettingsErr?.message);
      
      // If the current origin is not in Firebase's Authorized Domains list, fallback to standard reset link
      if (subCode === 'auth/unauthorized-continue-uri' || subCode === 'auth/invalid-continue-uri') {
        try {
          const fallbackSettings = {
            url: 'https://rice-f0b23.firebaseapp.com/reset-password.html',
            handleCodeInApp: true,
          };
          await sendPasswordResetEmail(auth, cleanEmail, fallbackSettings);
          return { success: true };
        } catch {
          await sendPasswordResetEmail(auth, cleanEmail);
          return { success: true };
        }
      }
      throw codeSettingsErr;
    }
  } catch (error) {
    const code = error?.code || '';
    console.error('[FIREBASE AUTH] Password reset request error:', code || error?.message);
    if (code === 'auth/invalid-email') {
      throw new Error('Please enter a valid email address.');
    } else if (code === 'auth/user-not-found') {
      throw new Error('user-not-found');
    } else if (code === 'auth/too-many-requests') {
      throw new Error('Too many reset attempts. Please wait a while and try again.');
    } else if (code === 'auth/network-request-failed') {
      throw new Error('Unable to send the reset email right now. Please check your internet connection and try again.');
    } else if (code === 'auth/operation-not-allowed') {
      throw new Error('Password reset is currently unavailable. Please contact the administrator.');
    } else if (code === 'auth/internal-error') {
      throw new Error('An internal error occurred while processing your request. Please try again.');
    } else {
      throw new Error('Something went wrong while sending the reset email. Please try again.');
    }
  }
}

/**
 * Verifies a Firebase Authentication password reset code (oobCode).
 * @param {string} oobCode - The one-time code from the reset link
 * @returns {Promise<string>} - Resolves with the user's registered email address
 */
export async function verifyResetCode(oobCode) {
  if (!oobCode || typeof oobCode !== 'string' || !oobCode.trim()) {
    throw new Error('missing-code');
  }
  if (!auth) {
    throw new Error('Authentication service is currently unavailable.');
  }
  try {
    const email = await verifyPasswordResetCode(auth, oobCode.trim());
    return email;
  } catch (error) {
    const code = error?.code || '';
    console.error('[FIREBASE AUTH] Verify reset code error:', code || error?.message);
    if (code === 'auth/expired-action-code') {
      throw new Error('expired');
    } else if (code === 'auth/invalid-action-code') {
      throw new Error('invalid');
    } else if (code === 'auth/user-disabled') {
      throw new Error('user-disabled');
    } else if (code === 'auth/user-not-found') {
      throw new Error('user-not-found');
    } else {
      throw new Error('invalid');
    }
  }
}

/**
 * Confirms and saves the new password in Firebase Authentication.
 * Validates that the new password differs from previous password if existing hash is available.
 * Synchronizes local password hash when matched.
 * @param {string} oobCode - The one-time code from the reset link
 * @param {string} newPassword - The validated new password string
 * @param {string} [verifiedEmail] - Optional verified email of the account
 * @returns {Promise<{success: boolean}>}
 */
export async function completePasswordReset(oobCode, newPassword, verifiedEmail = '') {
  if (!oobCode || typeof oobCode !== 'string' || !oobCode.trim()) {
    throw new Error('Invalid or missing reset link code.');
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (!auth) {
    throw new Error('Authentication service is currently unavailable.');
  }

  const cleanEmail = (verifiedEmail || '').trim().toLowerCase();
  const users = JSON.parse(localStorage.getItem('aurora-users') || '[]');
  const admins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
  const hashedNew = await hashPassword(newPassword);

  // Check if proposed new password is identical to the previous password if safely detectable
  if (cleanEmail) {
    const matchedUser = users.find(u => u.email && String(u.email).trim().toLowerCase() === cleanEmail) ||
                        admins.find(a => a.email && String(a.email).trim().toLowerCase() === cleanEmail);
    if (matchedUser && matchedUser.password) {
      const isStoredHashed = matchedUser.password.length === 64 && /^[0-9a-f]{64}$/i.test(matchedUser.password);
      const isOldPassword = isStoredHashed ? (matchedUser.password === hashedNew) : (matchedUser.password === newPassword);
      if (isOldPassword) {
        throw new Error('Your new password must be different from your previous password.');
      }
    }
  }

  try {
    // 1. Authoritatively update password in Firebase Authentication
    await confirmPasswordReset(auth, oobCode.trim(), newPassword);

    // 2. Pre-hash and update local compatibility record for synchronization
    try {
      let updatedUserList = false;
      const updatedUsers = users.map(u => {
        if (cleanEmail && u.email && String(u.email).trim().toLowerCase() === cleanEmail) {
          updatedUserList = true;
          return { ...u, password: hashedNew };
        }
        return u;
      });

      if (updatedUserList) {
        setItemAndSync('aurora-users', JSON.stringify(updatedUsers));
      }

      let updatedAdminList = false;
      const updatedAdmins = admins.map(a => {
        if (cleanEmail && a.email && String(a.email).trim().toLowerCase() === cleanEmail) {
          updatedAdminList = true;
          return { ...a, password: hashedNew };
        }
        return a;
      });

      if (updatedAdminList) {
        setItemAndSync('aurora-admin-users', JSON.stringify(updatedAdmins));
      }

      // Also update active session if current session matches
      const currentUser = JSON.parse(localStorage.getItem('aurora-user') || 'null');
      if (currentUser && currentUser.email && String(currentUser.email).trim().toLowerCase() === cleanEmail) {
        currentUser.password = hashedNew;
        localStorage.setItem('aurora-user', JSON.stringify(currentUser));
      }
    } catch (syncErr) {
      console.warn('[RICEFLOW] Local compatibility hash update notice:', syncErr);
    }

    return { success: true };
  } catch (error) {
    const code = error?.code || '';
    console.error('[FIREBASE AUTH] Confirm password reset error:', code || error?.message);
    if (code === 'auth/expired-action-code') {
      throw new Error('expired');
    } else if (code === 'auth/invalid-action-code') {
      throw new Error('invalid');
    } else if (code === 'auth/weak-password') {
      throw new Error('Password is too weak. Please use at least 8 characters with letters and numbers.');
    } else {
      throw new Error(error.message || 'Failed to update password. Please request a new reset link.');
    }
  }
}

// ---------------------- 48-HOUR PAYMENT REJECTION DEADLINE CANCELLATION ----------------------

export function evaluateOrderPaymentRejectionDeadline(order) {
  if (!order || isStaleOrderOrReservation(order)) return false;

  const currentStatus = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (currentStatus === 'cancelled' || currentStatus === 'completed') {
    return false;
  }
  if (order.autoCancelledDueToRejectionDeadline && currentStatus === 'cancelled') {
    return false;
  }

  // Must have paymentRejected flag true and must NOT have corrected proof uploaded
  if (!order.paymentRejected || order.hasCorrectedProof === true) {
    return false;
  }

  // Must have an applicable rejected-payment correction deadline (use latest of reuploadDeadline, paymentRejectedAt + 48h, reuploadRequestedAt + 48h)
  const candidateDeadlines = [];
  if (order.reuploadDeadline) {
    const parsed = new Date(order.reuploadDeadline).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed);
  }
  if (order.paymentRejectedAt) {
    const parsed = new Date(order.paymentRejectedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + (48 * 60 * 60 * 1000));
  }
  if (order.reuploadRequestedAt) {
    const parsed = new Date(order.reuploadRequestedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + (48 * 60 * 60 * 1000));
  }
  const deadlineMs = candidateDeadlines.length > 0 ? Math.max(...candidateDeadlines) : null;

  // Do not cancel records that do not have an applicable rejected-payment correction deadline
  if (!deadlineMs) {
    return false;
  }

  const now = new Date();
  if (now.getTime() < deadlineMs) {
    return false; // Still within allowed 48-hour window
  }

  // 48-Hour Deadline has expired! Automatically cancel order or reservation
  const isRes = isReservationOrder(order);
  const nowIso = now.toISOString();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const formattedDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  order.status = 'cancelled';
  order.cancelledAt = nowIso;
  order.updatedAt = nowIso;
  order.cancelledBy = 'System Auto-Cancellation';
  order.cancellationDate = `${formattedDate}, ${formattedTime}`;
  order.cancellationReason = isRes
    ? 'Automatically cancelled: Payment proof correction deadline expired (48 hours).'
    : 'Automatically cancelled: Payment proof correction deadline expired (48 hours).';
  order.autoCancelledDueToRejectionDeadline = true;
  order.paymentStatus = 'rejected_expired';
  order.paymentVerified = false;

  // Determine actual recorded refundable payment
  let actualPaid = 0;
  if (order.amountPaid !== undefined && order.amountPaid !== null && !isNaN(Number(order.amountPaid)) && Number(order.amountPaid) > 0) {
    actualPaid = Number(order.amountPaid);
  } else if (order.depositAmount !== undefined && order.depositAmount !== null && !isNaN(Number(order.depositAmount)) && Number(order.depositAmount) > 0) {
    actualPaid = Number(order.depositAmount);
  } else if (order.originalAmountPaid !== undefined && order.originalAmountPaid !== null && !isNaN(Number(order.originalAmountPaid)) && Number(order.originalAmountPaid) > 0) {
    actualPaid = Number(order.originalAmountPaid);
  } else if (order.amountPaidBeforeCancellation !== undefined && order.amountPaidBeforeCancellation !== null && !isNaN(Number(order.amountPaidBeforeCancellation)) && Number(order.amountPaidBeforeCancellation) > 0) {
    actualPaid = Number(order.amountPaidBeforeCancellation);
  } else if (order.amountCollected !== undefined && order.amountCollected !== null && !isNaN(Number(order.amountCollected)) && Number(order.amountCollected) > 0) {
    actualPaid = Number(order.amountCollected);
  }

  // COD orders have not paid upfront
  const isCod = String(order.paymentMethod || '').toLowerCase() === 'cod' || String(order.deliveryOption || '').toLowerCase() === 'cod';
  if (isCod) {
    actualPaid = 0;
  }

  const formattedAmount = Number(actualPaid || 0).toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(actualPaid) ? 0 : 2,
    maximumFractionDigits: 2
  });

  if (actualPaid > 0) {
    order.refundStatus = 'Refund Information Needed';
    order.refundAmount = actualPaid;
    order.refundReason = 'Cancelled: Payment proof correction deadline expired (48 hours)';
    order.refundRequestedAt = nowIso;
    order.originalAmountPaid = actualPaid;
    order.amountPaidBeforeCancellation = actualPaid;
  } else {
    order.refundStatus = 'No Refund Needed';
    order.refundAmount = 0;
    order.refundReason = 'Cancelled: Payment proof correction deadline expired (no payment received)';
  }

  if (isRes) {
    order.allocatedQuantity = 0;
  } else {
    // Regular order: release / restore physical warehouse stock if stock was deducted
    if (order.stockDeducted) {
      const existingHistory = typeof getInventoryHistory === 'function' ? getInventoryHistory() : [];
      const alreadyRestored = existingHistory.some(h => 
        (h.remarks && h.remarks.includes(`#${order.id}`)) &&
        (h.remarks.includes('Returned') || h.remarks.includes('Restored'))
      );

      if (!alreadyRestored) {
        const currentProducts = getProducts();
        let prodsChanged = false;
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(it => {
            if (it.isReservation) return;
            const itId = it.product?.id || it.productId || it.id;
            if (itId) {
              const pIdx = currentProducts.findIndex(p => String(p.id) === String(itId));
              if (pIdx !== -1) {
                const qty = Number(it.quantity || 0);
                if (qty > 0) {
                  currentProducts[pIdx].stock = Number(currentProducts[pIdx].stock || 0) + qty;
                  if (currentProducts[pIdx].currentStock !== undefined) {
                    currentProducts[pIdx].currentStock = Number(currentProducts[pIdx].currentStock || 0) + qty;
                  }
                  addInventoryHistory({
                    productId: currentProducts[pIdx].id,
                    productName: currentProducts[pIdx].name,
                    quantityAdded: qty,
                    remarks: `Returned/Restored from cancelled order #${order.id}`
                  }, true);
                  prodsChanged = true;
                }
              }
            }
          });
        }
        if (prodsChanged) {
          saveProducts(currentProducts, true);
        }
      }
      order.stockDeducted = false;
      order.consumedFromStock = 0;
    }
  }

  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    id: 'hist-deadline-cancel-' + Date.now(),
    status: 'Cancelled',
    changedBy: 'System Auto-Cancellation',
    changedAt: `${formattedDate}, ${formattedTime}`,
    note: actualPaid > 0
      ? `${isRes ? 'Reservation' : 'Order'} automatically cancelled because the 48-hour payment proof correction deadline expired without correction. Refund required: ₱${formattedAmount}.`
      : `${isRes ? 'Reservation' : 'Order'} automatically cancelled because the 48-hour payment proof correction deadline expired without correction. No payment received.`
  });

  try {
    addActivityLog(
      isRes ? 'Reservation' : 'Order',
      actualPaid > 0
        ? `System automatically cancelled ${isRes ? 'Reservation' : 'Order'} #${order.id} because the 48-hour payment correction deadline expired. Refund required: ₱${formattedAmount}.`
        : `System automatically cancelled ${isRes ? 'Reservation' : 'Order'} #${order.id} because the 48-hour payment correction deadline expired. No refund required (no payment received).`,
      `${isRes ? 'Reservation' : 'Order'} #${order.id}`
    );
  } catch (e) {}

  // Customer notification
  const custId = order.userId || order.customerId;
  if (custId) {
    if (actualPaid > 0) {
      addNotification(
        custId,
        isRes ? 'Reservation Cancelled — Refund Required' : 'Order Cancelled — Refund Required',
        isRes
          ? `Your reservation #${order.id} has been automatically cancelled because corrected payment proof was not submitted within the 48-hour deadline. You are due a refund of ₱${formattedAmount}. Please submit your GCash or bank details so the store can process your refund.`
          : `Your order #${order.id} has been automatically cancelled because corrected payment proof was not submitted within the 48-hour deadline. You are due a refund of ₱${formattedAmount}. Please submit your GCash or bank details so the store can process your refund.`,
        {
          role: 'customer',
          type: isRes ? 'reservation' : 'order',
          targetType: isRes ? 'reservation' : 'order',
          reservationId: isRes ? String(order.id) : undefined,
          orderId: String(order.id),
          targetId: String(order.id),
          tab: isRes ? 'reservations' : 'cancelled',
          eventKey: `${isRes ? 'res' : 'order'}-cancelled-deadline-${order.id}`,
          notificationId: `notif-${isRes ? 'res' : 'order'}-cancelled-deadline-${order.id}`
        }
      );
    } else {
      addNotification(
        custId,
        isRes ? 'Reservation Cancelled' : 'Order Cancelled',
        isRes
          ? `Your reservation #${order.id} has been automatically cancelled because corrected payment proof was not submitted within the 48-hour deadline. No refund is needed because no payment was received.`
          : `Your order #${order.id} has been automatically cancelled because corrected payment proof was not submitted within the 48-hour deadline. No refund is needed because no payment was received.`,
        {
          role: 'customer',
          type: isRes ? 'reservation' : 'order',
          targetType: isRes ? 'reservation' : 'order',
          reservationId: isRes ? String(order.id) : undefined,
          orderId: String(order.id),
          targetId: String(order.id),
          tab: isRes ? 'reservations' : 'cancelled',
          eventKey: `${isRes ? 'res' : 'order'}-cancelled-deadline-${order.id}`,
          notificationId: `notif-${isRes ? 'res' : 'order'}-cancelled-deadline-${order.id}`
        }
      );
    }
  }

  // Admin/Staff auto-cancellation notification
  try {
    addNotification(
      'admin',
      'Auto-Cancellation: 48-Hour Deadline Expired',
      actualPaid > 0
        ? `${isRes ? 'Reservation' : 'Order'} #${order.id} (${order.fullName || 'Customer'}) was automatically cancelled because the 48-hour payment correction deadline expired.\n\nRefund Required: ₱${formattedAmount}.\n\nAwaiting customer refund details.`
        : `${isRes ? 'Reservation' : 'Order'} #${order.id} (${order.fullName || 'Customer'}) was automatically cancelled because the 48-hour payment correction deadline expired.\n\nNo refund required (no payment received).`,
      {
        role: 'admin',
        type: isRes ? 'reservation' : 'order',
        targetType: isRes ? 'reservation' : 'order',
        orderId: String(order.id),
        reservationId: isRes ? String(order.id) : undefined,
        targetId: String(order.id),
        eventKey: `admin-auto-cancel-${order.id}`,
        notificationId: `notif-admin-auto-cancel-${order.id}`
      }
    );
  } catch (e) {}

  try {
    const rawOrd = localStorage.getItem('aurora-orders');
    if (rawOrd) {
      const parsedOrd = JSON.parse(rawOrd);
      const matchIdx = parsedOrd.findIndex(o => String(o.id) === String(order.id));
      if (matchIdx !== -1) {
        parsedOrd[matchIdx] = { ...parsedOrd[matchIdx], ...order };
        localStorage.setItem('aurora-orders', JSON.stringify(parsedOrd));
      }
    }
    saveFirestoreDoc('orders', String(order.id), order);
  } catch (e) {}

  try {
    if (typeof allocateStockToReservations === 'function') {
      allocateStockToReservations();
    }
  } catch (e) {}

  return true;
}

export function getReservationPaymentDeadlineMs(order) {
  if (!order) return null;

  const ordId = String(order.id || '').trim();
  const allocatedQty = Number(order.allocatedQuantity || 0);
  let totalQtyNeeded = Number(order.quantity || 0);
  if (Array.isArray(order.items) && order.items.length > 0) {
    const resItem = order.items.find(it => it && (it.isReservation || it.product || it.productId)) || order.items[0];
    if (resItem && Number(resItem.quantity || 0) > 0) {
      totalQtyNeeded = Number(resItem.quantity);
    }
  }
  const isFullyAllocated = totalQtyNeeded > 0 ? allocatedQty >= totalQtyNeeded : allocatedQty > 0;

  const candidateDeadlines = [];
  const FortyEightHoursMs = 48 * 60 * 60 * 1000;

  if (order.paymentDeadline) {
    const parsed = new Date(order.paymentDeadline).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      candidateDeadlines.push(parsed);
    }
  }

  if (isFullyAllocated || order.notifiedForPayment) {
    const allocationTimestamps = [
      order.stockAllocatedAt,
      order.restockAllocatedAt,
      order.actualRestockDate
    ];

    for (const ts of allocationTimestamps) {
      if (ts) {
        const parsed = new Date(ts).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          candidateDeadlines.push(parsed + FortyEightHoursMs);
        }
      }
    }
  }

  if (Array.isArray(order.statusHistory)) {
    for (let i = 0; i < order.statusHistory.length; i++) {
      const entry = order.statusHistory[i];
      if (!entry) continue;
      const st = String(entry.status || '').toLowerCase();
      const note = String(entry.note || '').toLowerCase();
      if (
        st.includes('stock allocated') ||
        note.includes('stock fully allocated') ||
        note.includes('upload down payment within 48 hours')
      ) {
        const parsed = new Date(entry.changedAt || entry.timestamp || '').getTime();
        if (!isNaN(parsed) && parsed > 0) {
          candidateDeadlines.push(parsed + FortyEightHoursMs);
        }
      }
    }
  }

  // Check persisted notifications and activity logs for the earliest authoritative
  // full-allocation / 48-hour down-payment request timestamp for this reservation
  if (ordId && typeof localStorage !== 'undefined') {
    try {
      const rawNotifs = localStorage.getItem('aurora-notifications');
      if (rawNotifs) {
        const notifs = JSON.parse(rawNotifs);
        if (Array.isArray(notifs)) {
          for (let i = 0; i < notifs.length; i++) {
            const n = notifs[i];
            if (!n) continue;
            const matchesOrder =
              String(n.reservationId || '').trim() === ordId ||
              String(n.targetId || '').trim() === ordId ||
              String(n.recordId || '').trim() === ordId ||
              String(n.orderId || '').trim() === ordId;
            if (!matchesOrder) continue;

            const titleLower = String(n.title || '').toLowerCase();
            const msgLower = String(n.message || '').toLowerCase();
            if (
              titleLower.includes('down payment required') ||
              titleLower.includes('reserved rice available') ||
              msgLower.includes('upload your down payment within 48 hours')
            ) {
              let notifMs = n.timestamp ? new Date(n.timestamp).getTime() : NaN;
              if (isNaN(notifMs) || notifMs <= 0) {
                const idMatch = String(n.id || n.notificationId || '').match(/^notif-(\d{10,15})/);
                if (idMatch) notifMs = Number(idMatch[1]);
              }
              if ((isNaN(notifMs) || notifMs <= 0) && n.createdDate) {
                notifMs = new Date(`${n.createdDate} ${n.createdTime || '00:00'}`).getTime();
              }
              if (!isNaN(notifMs) && notifMs > 0) {
                candidateDeadlines.push(notifMs + FortyEightHoursMs);
              }
            }
          }
        }
      }
    } catch (e) {}

    try {
      const rawLogs = localStorage.getItem('aurora-activity-logs');
      if (rawLogs) {
        const logs = JSON.parse(rawLogs);
        if (Array.isArray(logs)) {
          for (let i = 0; i < logs.length; i++) {
            const l = logs[i];
            if (!l) continue;
            const actionStr = String(l.action || '');
            if (!actionStr.includes(ordId)) continue;
            const allocMatch = actionStr.match(/total allocated:\s*(\d+)\s*\/\s*(\d+)/i);
            if (allocMatch) {
              const allocNum = Number(allocMatch[1]);
              const neededNum = Number(allocMatch[2]);
              if (neededNum > 0 && allocNum >= neededNum) {
                let logMs = l.timestamp ? new Date(l.timestamp).getTime() : NaN;
                if (isNaN(logMs) || logMs <= 0) {
                  const idMatch = String(l.id || '').match(/^log-(\d{10,15})/);
                  if (idMatch) logMs = Number(idMatch[1]);
                }
                if (!isNaN(logMs) && logMs > 0) {
                  candidateDeadlines.push(logMs + FortyEightHoursMs);
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  if (candidateDeadlines.length === 0) {
    return null;
  }

  return Math.min(...candidateDeadlines);
}

export function hasValidReservationPaymentProof(order) {
  if (!order || order.paymentRejected) return false;
  if (order.status === 'payment_verification' || order.paymentStatus === 'pending_verification') {
    return true;
  }
  if (order.paymentProofDataUrl && String(order.paymentProofDataUrl).length > 20) {
    return true;
  }
  if (order.paymentProofUrl && String(order.paymentProofUrl).length > 3 && order.paymentProofUrl !== 'none') {
    return true;
  }
  if (order.paymentProof) {
    const p = String(order.paymentProof).trim();
    if (p.startsWith('data:')) return true;
    if (p !== 'none' && p !== 'null' && p !== 'undefined' && p.length > 3) return true;
  }
  return false;
}

export function evaluateReservationPaymentDeadline(order, skipReallocate = false) {
  if (!order || isStaleOrderOrReservation(order)) return false;
  if (!isReservationOrder(order)) return false;

  const currentStatus = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (
    currentStatus === 'cancelled' ||
    currentStatus === 'completed' ||
    currentStatus === 'delivered' ||
    currentStatus === 'processing' ||
    currentStatus === 'to-ship' ||
    currentStatus === 'to-receive' ||
    currentStatus === 'ready-for-processing' ||
    currentStatus === 'ready' ||
    currentStatus === 'rejected'
  ) {
    return false;
  }

  // Payment already satisfied or proof already uploaded awaiting review
  const isPaymentSatisfied =
    order.paymentVerified === true ||
    order.paymentStatus === 'verified' ||
    order.paymentStatus === 'paid';
  if (isPaymentSatisfied || hasValidReservationPaymentProof(order)) {
    return false;
  }

  // Rejected-proof correction deadline is handled separately by evaluateOrderPaymentRejectionDeadline
  if (order.paymentRejected) {
    return false;
  }

  const deadlineMs = getReservationPaymentDeadlineMs(order);
  if (!deadlineMs) {
    return false;
  }

  const allocatedQty = Number(order.allocatedQuantity || 0);
  const authoritativeDeadlineIso = new Date(deadlineMs).toISOString();
  const authoritativeAllocIso = new Date(deadlineMs - (48 * 60 * 60 * 1000)).toISOString();

  if (!order.paymentDeadline || new Date(order.paymentDeadline).getTime() > deadlineMs) {
    order.paymentDeadline = authoritativeDeadlineIso;
    order.notifiedForPayment = true;
    if (!order.stockAllocatedAt || new Date(order.stockAllocatedAt).getTime() > (deadlineMs - 48 * 60 * 60 * 1000)) {
      order.stockAllocatedAt = authoritativeAllocIso;
    }
  }

  const now = new Date();
  if (now.getTime() <= deadlineMs) {
    return false;
  }

  // 48-Hour allocation payment deadline has expired without down payment submission!
  const nowIso = now.toISOString();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const formattedDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  order.paymentDeadline = authoritativeDeadlineIso;
  order.notifiedForPayment = true;
  if (!order.stockAllocatedAt || new Date(order.stockAllocatedAt).getTime() > (deadlineMs - 48 * 60 * 60 * 1000)) {
    order.stockAllocatedAt = authoritativeAllocIso;
  }
  order.status = 'cancelled';
  order.allocatedQuantity = 0;
  order.cancelledAt = nowIso;
  order.updatedAt = nowIso;
  order.cancelledBy = 'System Auto-Cancellation';
  order.cancellationDate = `${formattedDate}, ${formattedTime}`;
  order.cancellationReason = 'Automatically cancelled: Down payment was not submitted within the 48-hour payment deadline.';
  order.autoCancelledDueToPaymentDeadline = true;
  order.paymentVerified = false;
  order.refundStatus = 'No Refund Needed';
  order.refundAmount = 0;
  order.refundReason = 'Cancelled: 48-hour down payment deadline expired (no payment received)';

  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  const alreadyHasExpiredHist = order.statusHistory.some(
    h => h && String(h.status || '').toLowerCase() === 'cancelled (expired)'
  );
  if (!alreadyHasExpiredHist) {
    order.statusHistory.push({
      id: 'hist-exp-' + Date.now(),
      status: 'Cancelled (Expired)',
      changedBy: 'System Auto-Cancellation',
      changedAt: `${formattedDate}, ${formattedTime}`,
      note: 'Reservation automatically expired because the 48-hour payment window elapsed without payment verification or receipt upload. Allocated stock has been released.'
    });
  }

  try {
    const existingLogs = getActivityLogs();
    const alreadyLogged = existingLogs.some(
      l => l && String(l.target || '') === `Reservation #${order.id}` && String(l.action || '').includes('automatically cancelled')
    );
    if (!alreadyLogged) {
      addActivityLog(
        'Reservations',
        `System automatically cancelled Reservation #${order.id} because the 48-hour down payment deadline expired without payment submission. Allocated stock (${allocatedQty} sacks) released.`,
        `Reservation #${order.id}`
      );
    }
  } catch (e) {}

  const custId = order.userId || order.customerId || '';
  if (custId) {
    addNotification(
      custId,
      '❌ Reservation Cancelled',
      'Your reservation was automatically cancelled because the 48-hour payment window elapsed without a payment upload. Allocated stock has been released to the next customer in line.',
      {
        role: 'customer',
        type: 'reservation',
        targetType: 'reservation',
        reservationId: String(order.id),
        orderId: String(order.id),
        targetId: String(order.id),
        tab: 'cancelled',
        eventKey: `res-cancelled-paydeadline-${order.id}`,
        notificationId: `notif-res-cancelled-paydeadline-${order.id}`
      }
    );
  }

  try {
    addNotification(
      'admin',
      'Auto-Cancellation: 48-Hour Deadline Expired',
      `Reservation #${order.id} (${order.fullName || 'Customer'}) was automatically cancelled because the 48-hour down payment deadline expired without payment submission.\n\nAllocated stock (${allocatedQty} sacks) has been released to the reservation queue.`,
      {
        role: 'admin',
        type: 'reservation',
        targetType: 'reservation',
        orderId: String(order.id),
        reservationId: String(order.id),
        targetId: String(order.id),
        isSystemAuto: true,
        eventKey: `admin-res-auto-cancel-paydeadline-${order.id}`,
        notificationId: `notif-admin-res-auto-cancel-paydeadline-${order.id}`
      }
    );
  } catch (e) {}

  try {
    registerPendingOrderWrite(order.id, order);
    const rawOrd = localStorage.getItem('aurora-orders');
    if (rawOrd) {
      const parsedOrd = JSON.parse(rawOrd);
      const matchIdx = parsedOrd.findIndex(o => String(o.id) === String(order.id));
      if (matchIdx !== -1) {
        parsedOrd[matchIdx] = { ...parsedOrd[matchIdx], ...order };
        localStorage.setItem('aurora-orders', JSON.stringify(parsedOrd));
      }
    }
    saveFirestoreDoc('orders', String(order.id), order);
  } catch (e) {}

  if (!skipReallocate) {
    try {
      if (typeof allocateStockToReservations === 'function') {
        allocateStockToReservations();
      }
    } catch (e) {}
  }

  return true;
}

export function checkAndCancelExpiredPaymentRejections() {
  if (!isOrdersHydrated()) return;
  if (typeof window !== 'undefined' && window._checkingExpiredRejections) return;
  if (typeof window !== 'undefined') window._checkingExpiredRejections = true;
  try {
    const raw = localStorage.getItem('aurora-orders') || '[]';
    const list = (JSON.parse(raw) || []).filter(o => !isStaleOrderOrReservation(o));
    let modified = false;
    let reservationExpired = false;
    const modifiedOrders = [];

    list.forEach(order => {
      const changedRejection = evaluateOrderPaymentRejectionDeadline(order);
      const changedResDeadline = evaluateReservationPaymentDeadline(order, true);
      if (changedRejection || changedResDeadline) {
        modified = true;
        if (changedResDeadline) reservationExpired = true;
        modifiedOrders.push(order);
      }
    });

    if (modified) {
      localStorage.setItem('aurora-orders', JSON.stringify(list));
      modifiedOrders.forEach(order => {
        try {
          registerPendingOrderWrite(order.id, order);
          saveFirestoreDoc('orders', String(order.id), order);
        } catch (e) {
          console.warn('[AUTO-CANCEL] Firestore doc save error:', e);
        }
      });
      if (reservationExpired && typeof allocateStockToReservations === 'function') {
        try {
          allocateStockToReservations();
        } catch (e) {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders' } }));
        window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { orders: list } }));
      }
    }

    // Evaluate customer-side 48-hour reminder milestones for active deadlines
    try {
      checkAndSendCustomer48HourReminders(list);
    } catch (remErr) {
      console.warn('[REMINDERS] Customer 48-hour reminder evaluation notice:', remErr);
    }
  } catch (err) {
    console.error('Error checking expired rejected orders:', err);
  } finally {
    if (typeof window !== 'undefined') window._checkingExpiredRejections = false;
  }
}

// ---------------------- 48-HOUR CUSTOMER REMINDER VISIBILITY HELPERS ----------------------

export function formatDeadlineTimestamp(deadlineMs) {
  if (!deadlineMs || isNaN(Number(deadlineMs)) || Number(deadlineMs) <= 0) return 'N/A';
  const d = new Date(Number(deadlineMs));
  if (isNaN(d.getTime())) return 'N/A';
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

export function formatDeadlineCountdown(deadlineMs, includeSeconds = true) {
  if (!deadlineMs || isNaN(Number(deadlineMs))) {
    return {
      expired: true,
      remainingMs: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      shortText: 'Expired',
      detailedText: 'Deadline Expired',
      urgencyLevel: 'expired'
    };
  }
  const diff = Number(deadlineMs) - Date.now();
  if (diff <= 0) {
    return {
      expired: true,
      remainingMs: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      shortText: 'Expired',
      detailedText: 'Deadline Expired',
      urgencyLevel: 'expired'
    };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  let urgencyLevel = 'normal';
  if (diff <= 2 * 3600 * 1000) {
    urgencyLevel = 'critical';
  } else if (diff <= 6 * 3600 * 1000) {
    urgencyLevel = 'urgent';
  } else if (diff <= 12 * 3600 * 1000) {
    urgencyLevel = 'urgent';
  } else if (diff <= 24 * 3600 * 1000) {
    urgencyLevel = 'warning';
  }

  const pad2 = n => String(n).padStart(2, '0');
  const shortText = includeSeconds
    ? `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s left`
    : `${hours}h ${minutes}m left`;
  const detailedText = includeSeconds
    ? `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s remaining`
    : `${hours}h ${minutes}m remaining`;

  return {
    expired: false,
    remainingMs: diff,
    hours,
    minutes,
    seconds,
    shortText,
    detailedText,
    urgencyLevel
  };
}

export function getOrderPaymentReuploadDeadlineMs(order) {
  if (!order || isStaleOrderOrReservation(order)) return null;
  const currentStatus = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (currentStatus === 'cancelled' || currentStatus === 'completed') return null;
  if (!order.paymentRejected || order.hasCorrectedProof === true) return null;

  const candidateDeadlines = [];
  if (order.reuploadDeadline) {
    const parsed = new Date(order.reuploadDeadline).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed);
  }
  if (order.paymentRejectedAt) {
    const parsed = new Date(order.paymentRejectedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + 48 * 60 * 60 * 1000);
  }
  if (order.reuploadRequestedAt) {
    const parsed = new Date(order.reuploadRequestedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + 48 * 60 * 60 * 1000);
  }
  return candidateDeadlines.length > 0 ? Math.max(...candidateDeadlines) : null;
}

export function getActiveReservationPaymentDeadlineInfo(order) {
  if (!order || isStaleOrderOrReservation(order)) return null;
  if (!isReservationOrder(order)) return null;

  const currentStatus = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (
    currentStatus === 'cancelled' ||
    currentStatus === 'completed' ||
    currentStatus === 'delivered' ||
    currentStatus === 'processing' ||
    currentStatus === 'to-ship' ||
    currentStatus === 'to-receive' ||
    currentStatus === 'ready-for-processing' ||
    currentStatus === 'ready' ||
    currentStatus === 'rejected'
  ) {
    return null;
  }

  // Workflow B handles rejected payment proofs separately
  if (order.paymentRejected) return null;

  const isPaymentSatisfied =
    order.paymentVerified === true ||
    order.paymentStatus === 'verified' ||
    order.paymentStatus === 'paid';
  if (isPaymentSatisfied || hasValidReservationPaymentProof(order)) {
    return null;
  }

  const deadlineMs = getReservationPaymentDeadlineMs(order);
  if (!deadlineMs) return null;

  const countdown = formatDeadlineCountdown(deadlineMs, true);
  const firstItem = Array.isArray(order.items) && order.items.length > 0 ? order.items[0] : null;
  const varietyName = firstItem?.product?.name || firstItem?.productName || firstItem?.name || order.productName || 'Reserved Rice';
  const totalQtyNeeded = Number(firstItem?.quantity || order.quantity || 1);
  const allocatedQty = Number(order.allocatedQuantity || totalQtyNeeded);

  const totalVal = Number(order.total || order.totalPrice || order.totalBill || 0) ||
    ((Number(firstItem?.product?.price || firstItem?.price || 0) * totalQtyNeeded) + (order.deliveryOption === 'delivery' ? 80 : 0));
  const isFull = order.paymentType === 'full' || order.paymentType === 'full_advance' || order.paymentOption === 'Full Payment' || order.paymentOption === 'full';
  const requiredAmount = isFull
    ? totalVal
    : (order.depositAmount && Number(order.depositAmount) > 0 ? Number(order.depositAmount) : Math.round(totalVal * 0.3));

  return {
    workflow: 'reservation_payment',
    orderId: String(order.id),
    isReservation: true,
    deadlineMs,
    deadlineFormatted: formatDeadlineTimestamp(deadlineMs),
    expired: countdown.expired,
    remainingMs: countdown.remainingMs,
    shortCountdown: countdown.shortText,
    detailedCountdown: countdown.detailedText,
    urgencyLevel: countdown.urgencyLevel,
    varietyName,
    allocatedQty,
    totalQtyNeeded,
    requiredAmount,
    paymentLabel: isFull ? 'Full Payment' : '30% Down Payment'
  };
}

export function getActivePaymentReuploadDeadlineInfo(order) {
  if (!order || isStaleOrderOrReservation(order)) return null;
  const deadlineMs = getOrderPaymentReuploadDeadlineMs(order);
  if (!deadlineMs) return null;

  const countdown = formatDeadlineCountdown(deadlineMs, true);
  const isRes = isReservationOrder(order);
  const firstItem = Array.isArray(order.items) && order.items.length > 0 ? order.items[0] : null;
  const varietyName = firstItem?.product?.name || firstItem?.productName || firstItem?.name || order.productName || 'Rice Order';
  const totalQty = Number(firstItem?.quantity || order.quantity || 1);

  return {
    workflow: 'payment_reupload',
    orderId: String(order.id),
    isReservation: isRes,
    deadlineMs,
    deadlineFormatted: formatDeadlineTimestamp(deadlineMs),
    expired: countdown.expired,
    remainingMs: countdown.remainingMs,
    shortCountdown: countdown.shortText,
    detailedCountdown: countdown.detailedText,
    urgencyLevel: countdown.urgencyLevel,
    varietyName,
    totalQty,
    rejectionReason: order.paymentRejectionReason || 'Payment screenshot needs correction',
    rejectionExplanation: order.paymentRejectionExplanation || order.paymentRejectionDetails || ''
  };
}

export function checkAndSendCustomer48HourReminders(ordersInput = null) {
  if (typeof localStorage === 'undefined') return;
  const list = Array.isArray(ordersInput)
    ? ordersInput
    : (JSON.parse(localStorage.getItem('aurora-orders') || '[]') || []).filter(o => !isStaleOrderOrReservation(o));

  if (!list || list.length === 0) return;

  let sentMap = {};
  try {
    sentMap = JSON.parse(localStorage.getItem('aurora-customer-deadline-reminders') || '{}') || {};
  } catch (_) {
    sentMap = {};
  }
  let mapChanged = false;

  const resolveMilestone = (remainingMs) => {
    if (remainingMs <= 0) return null;
    const oneHour = 3600 * 1000;
    if (remainingMs <= 2 * oneHour) {
      return { key: '2h', label: 'Final 2-Hour Reminder' };
    }
    if (remainingMs <= 6 * oneHour) {
      return { key: '6h', label: '6-Hour Reminder' };
    }
    if (remainingMs <= 12 * oneHour) {
      return { key: '12h', label: '12-Hour Reminder' };
    }
    if (remainingMs <= 24 * oneHour) {
      return { key: '24h', label: '24-Hour Reminder' };
    }
    return null;
  };

  list.forEach(order => {
    if (!order) return;
    const custId = order.userId || order.customerId;
    if (!custId) return;

    // WORKFLOW A: Reservation 48-Hour Payment Deadline
    const resPayInfo = getActiveReservationPaymentDeadlineInfo(order);
    if (resPayInfo && !resPayInfo.expired) {
      const milestone = resolveMilestone(resPayInfo.remainingMs);
      if (milestone) {
        const dedupKey = `res-pay-rem-${milestone.key}-${order.id}-${resPayInfo.deadlineMs}`;
        if (!sentMap[dedupKey]) {
          sentMap[dedupKey] = Date.now();
          mapChanged = true;
          const amtFormatted = Number(resPayInfo.requiredAmount || 0).toLocaleString();
          addNotification(
            custId,
            `⏰ ${milestone.label}: Reservation Down Payment Due (#${order.id})`,
            `Your allocated stock (${resPayInfo.allocatedQty} sack${resPayInfo.allocatedQty !== 1 ? 's' : ''} of ${resPayInfo.varietyName}) for Reservation #${order.id} is awaiting your ${resPayInfo.paymentLabel} of ₱${amtFormatted}.00. Please submit your payment proof before ${resPayInfo.deadlineFormatted} (${resPayInfo.shortCountdown}) to avoid automatic cancellation.`,
            {
              role: 'customer',
              type: 'reservation',
              targetType: 'reservation',
              reservationId: String(order.id),
              orderId: String(order.id),
              targetId: String(order.id),
              tab: 'reservations',
              destinationTab: 'reservations',
              scrollPayment: true,
              eventKey: dedupKey,
              notificationId: `notif-${dedupKey}`
            }
          );
        }
      }
    }

    // WORKFLOW B: Payment-Proof 48-Hour Re-upload Deadline
    const reuploadInfo = getActivePaymentReuploadDeadlineInfo(order);
    if (reuploadInfo && !reuploadInfo.expired) {
      const milestone = resolveMilestone(reuploadInfo.remainingMs);
      if (milestone) {
        const dedupKey = `reupload-rem-${milestone.key}-${order.id}-${reuploadInfo.deadlineMs}`;
        if (!sentMap[dedupKey]) {
          sentMap[dedupKey] = Date.now();
          mapChanged = true;
          const recLabel = reuploadInfo.isReservation ? `Reservation #${order.id}` : `Order #${order.id}`;
          addNotification(
            custId,
            `⚠️ ${milestone.label}: Re-upload Payment Proof (${recLabel})`,
            `Your payment proof for ${recLabel} (${reuploadInfo.varietyName}) was rejected (${reuploadInfo.rejectionReason}). Please upload a corrected payment screenshot before ${reuploadInfo.deadlineFormatted} (${reuploadInfo.shortCountdown}) to prevent automatic cancellation.`,
            {
              role: 'customer',
              type: reuploadInfo.isReservation ? 'reservation' : 'order',
              targetType: reuploadInfo.isReservation ? 'reservation' : 'order',
              reservationId: reuploadInfo.isReservation ? String(order.id) : undefined,
              orderId: String(order.id),
              targetId: String(order.id),
              tab: reuploadInfo.isReservation ? 'reservations' : 'to-pay',
              destinationTab: reuploadInfo.isReservation ? 'reservations' : 'to-pay',
              scrollPayment: true,
              eventKey: dedupKey,
              notificationId: `notif-${dedupKey}`
            }
          );
        }
      }
    }
  });

  if (mapChanged) {
    try {
      localStorage.setItem('aurora-customer-deadline-reminders', JSON.stringify(sentMap));
    } catch (_) {}
  }
}

export function updateAllLiveDeadlineCountdowns() {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll('[data-live-deadline-ms]');
  nodes.forEach(el => {
    const rawMs = Number(el.getAttribute('data-live-deadline-ms'));
    if (!rawMs || isNaN(rawMs)) return;
    const mode = el.getAttribute('data-live-deadline-mode') || 'short';
    const prefix = el.getAttribute('data-live-deadline-prefix') || '⏱️ ';
    const cd = formatDeadlineCountdown(rawMs, true);
    const nextText = cd.expired
      ? '⚠️ Deadline Expired'
      : `${prefix}${mode === 'detailed' ? cd.detailedText : cd.shortText}`;
    if (el.textContent !== nextText) {
      el.textContent = nextText;
    }
  });
}

if (typeof window !== 'undefined' && !window.__aurora_deadline_checker_started) {
  window.__aurora_deadline_checker_started = true;
  setInterval(() => {
    try {
      checkAndCancelExpiredPaymentRejections();
      checkAndAutoCompleteOrders();
    } catch (e) {}
  }, 15000);
  setInterval(() => {
    try {
      updateAllLiveDeadlineCountdowns();
    } catch (e) {}
  }, 1000);
}

// ---------------------- ORDERS & QUEUE API ----------------------

export function checkAndAutoCompleteOrders() {
  if (!isOrdersHydrated()) return;
  if (typeof window !== 'undefined' && window._checkingAutoComplete) return;
  if (typeof window !== 'undefined') window._checkingAutoComplete = true;
  try {
    const raw = localStorage.getItem('aurora-orders') || '[]';
    const list = (JSON.parse(raw) || []).filter(o => !isStaleOrderOrReservation(o));
    let modified = false;
    const now = new Date();
    
    const updatedList = list.map(order => {
      if (order && !isStaleOrderOrReservation(order) && order.status === 'delivered') {
        // Resolve authoritative delivery timestamp and deadline
        let deliveredMs = null;
        if (order.deliveredAt) {
          deliveredMs = new Date(order.deliveredAt).getTime();
        } else if (order.customerConfirmationDeadline) {
          deliveredMs = new Date(order.customerConfirmationDeadline).getTime() - (48 * 60 * 60 * 1000);
        } else if (order.deliveredDate) {
          const timeStr = order.deliveredTime || '00:00';
          deliveredMs = new Date(`${order.deliveredDate} ${timeStr}`).getTime();
        }

        if ((!deliveredMs || isNaN(deliveredMs)) && order.statusHistory) {
          const delHist = order.statusHistory.find(h => (h.status || '').toLowerCase() === 'delivered');
          if (delHist && delHist.changedAt) {
            deliveredMs = new Date(delHist.changedAt).getTime();
          }
        }

        const deadlineDate = deliveredMs && !isNaN(deliveredMs) 
          ? new Date(deliveredMs + (48 * 60 * 60 * 1000))
          : (order.customerConfirmationDeadline ? new Date(order.customerConfirmationDeadline) : null);

        if (deadlineDate && now.getTime() >= deadlineDate.getTime()) {
          modified = true;
          const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const completionDate = `${months[deadlineDate.getMonth()]} ${deadlineDate.getDate()}, ${deadlineDate.getFullYear()}`;
          const completionTime = deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const completedAtIso = deadlineDate.toISOString();
          
          addNotification(
            order.userId || order.customerId || '',
            'Order Automatically Completed',
            `Your order #${order.id} has been automatically marked as completed after 48 hours of successful delivery.`,
            { 
              role: 'customer', 
              type: 'order', 
              orderId: order.id,
              eventKey: `order-completed-${order.id}`,
              notificationId: `notif-order-completed-${order.id}`,
              createdDate: completionDate,
              createdTime: completionTime,
              timestamp: completedAtIso
            }
          );

          const historyItem = {
            id: 'hist-' + deadlineDate.getTime() + '-auto',
            status: 'Completed',
            changedBy: 'System',
            changedAt: `${completionDate}, ${completionTime}`,
            note: '✔ Order automatically completed after 48 hours of delivery (no issues reported).'
          };

          let stockDeducted = order.stockDeducted;
          if (!stockDeducted) {
            const currentProducts = getProducts();
            if (order.items) {
              order.items.forEach(it => {
                if (it.product && it.product.id) {
                  const pIdx = currentProducts.findIndex(p => String(p.id) === String(it.product.id));
                  if (pIdx !== -1) {
                    const qty = Number(it.quantity || 0);
                    currentProducts[pIdx].stock = Math.max(0, Number(currentProducts[pIdx].stock || 0) - qty);
                    if (currentProducts[pIdx].currentStock !== undefined) {
                      currentProducts[pIdx].currentStock = Math.max(0, Number(currentProducts[pIdx].currentStock || 0) - qty);
                    }
                    
                    addInventoryHistory({
                      productName: currentProducts[pIdx].name,
                      quantityAdded: -qty,
                      remarks: `Fulfillment release for order #${order.id}`
                    }, true);
                  }
                }
              });
            }
            saveProducts(currentProducts, true);
            stockDeducted = true;
          }

          // Financial verification check:
          // Fully electronic payment (GCash full payment) requires no cash turnover audit.
          // Physical cash / COD / partial deposit orders MUST NOT be automatically marked financially verified.
          const isFullElectronic = order.financialStatus === 'No Cash Collection Required' || 
            (order.paymentMethod === 'gcash' && (order.paymentType === 'full' || order.paymentOption === 'Full Payment') && (order.paymentVerified || order.financialVerification));
          
          const isFinancialVerified = Boolean(
            order.financialVerification === true || 
            order.cashAuditStatus === 'Audited' || 
            isFullElectronic
          );

          let finStatus = order.financialStatus;
          if (isFullElectronic) {
            finStatus = 'No Cash Collection Required';
          } else if (isFinancialVerified) {
            finStatus = 'Verified';
          } else {
            finStatus = 'Pending Turnover';
          }

          return {
            ...order,
            status: 'completed',
            completedAt: completedAtIso,
            completionDate: completionDate,
            completionTime: completionTime,
            completionType: 'System Auto Completed',
            completionMethod: 'Automatic Completion',
            completionReason: 'Auto Completed (48 Hours - No Issue Reported)',
            customerConfirmation: true,
            customerConfirmationDate: completionDate,
            customerConfirmationTime: completionTime,
            financialVerification: isFinancialVerified,
            financialStatus: finStatus,
            stockDeducted,
            statusHistory: [...(order.statusHistory || []).filter(h => h.status !== 'Completed'), historyItem]
          };
        }
      }
      return order;
    });

    if (modified) {
      localStorage.setItem('aurora-orders', JSON.stringify(updatedList));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders' } }));
      }
    }
  } catch (err) {
    console.error('Error auto completing orders:', err);
  } finally {
    if (typeof window !== 'undefined') window._checkingAutoComplete = false;
  }
}

export function getOrders() {
  checkAndAutoCompleteOrders();
  checkAndCancelExpiredPaymentRejections();
  const raw = localStorage.getItem('aurora-orders') || '[]';
  const list = JSON.parse(raw).filter(o => !isStaleOrderOrReservation(o));
  console.log('[DEBUG] getOrders retrieved orders count:', list.length);
  const mapped = list.map(o => {
    let total = Number(o.total || o.totalBill || 0);
    if (!total || total === 0) {
      // Recalculate total dynamically from items and delivery option to ensure it's never 0
      const sub = (o.items || []).reduce((acc, item) => {
        const price = item.product?.price || 0;
        const qty = item.quantity || 0;
        return acc + (price * qty);
      }, 0);
      const fee = o.deliveryOption === 'delivery' ? 80 : 0;
      total = sub + fee;
    }
    
    // Retrieve actual values from saved order, preserving them exactly.
    let amountPaid = o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) ? Number(o.amountPaid) : undefined;
    let remainingAmount = o.remainingAmount !== undefined && o.remainingAmount !== null && !isNaN(Number(o.remainingAmount)) ? Number(o.remainingAmount) : (o.remainingBalance !== undefined ? Number(o.remainingBalance) : undefined);

    const isReservation = Boolean(o.isPreOrder || (o.items && o.items.some(i => i.isReservation)));
    const isFullPayment = o.paymentType === 'full' || o.paymentType === 'full_advance' || o.paymentOption === 'Full Payment' || o.paymentOption === 'full' || o.paymentType === 'Full Payment';

    if (isReservation) {
      if (isFullPayment) {
        amountPaid = total;
        remainingAmount = 0;
      } else {
        if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0 && Number(o.depositAmount) < total) {
          amountPaid = Number(o.depositAmount);
        } else if (typeof amountPaid === 'number' && amountPaid > 0 && amountPaid < total) {
          // Keep valid partial downpayment amount
        } else {
          amountPaid = Math.round(total * 0.3);
        }
        remainingAmount = Math.max(0, total - amountPaid);
      }
    } else {
      const isDownPayment = o.paymentType === 'downpayment' || o.paymentType === 'deposit' || o.paymentType === 'down' || (o.paymentMethod || '').toLowerCase() === 'cash';

      if (amountPaid === undefined) {
        if (o.status === 'completed' || o.status === 'delivered') {
          amountPaid = total;
        } else if (o.status === 'cancelled' || o.status === 'rejected' || o.paymentRejected) {
          amountPaid = 0;
        } else {
          const statusClean = (o.status || '').toLowerCase().replace(/_/g, '-');
          const isVerified = o.paymentVerified === true || o.isVerifiedPayment === true || ['to-ship', 'processing', 'to-receive'].includes(statusClean);
          if (isVerified) {
            if (isDownPayment) {
              amountPaid = Math.floor(total * 0.3);
            } else {
              amountPaid = total;
            }
          } else {
            amountPaid = 0;
          }
        }
      }

      if (remainingAmount === undefined) {
        if (o.status === 'completed' || o.status === 'cancelled') {
          remainingAmount = 0;
        } else {
          remainingAmount = Math.max(0, total - amountPaid);
        }
      }
    }

    // Force completed state to be fully paid
    if (o.status === 'completed') {
      remainingAmount = 0;
      amountPaid = total;
    }

    // Determine Financial Audit / Cash Turnover Status
    let financialStatus = o.financialStatus;
    let amountCollected = o.amountCollected !== undefined ? Number(o.amountCollected) : undefined;
    let collectedBy = o.collectedBy || o.deliveryVerificationBy || o.verifiedBy || o.assignedDeliveryPersonName || o.driverName || o.staffName || o.assignedStaff || 'Staff Member';
    let collectedDate = o.collectedDate || o.deliveredDate || o.deliveryVerificationDate || (o.createdAt ? new Date(o.createdAt).toLocaleDateString() : new Date().toLocaleDateString());
    let collectedTime = o.collectedTime || o.deliveredTime || '10:00 AM';

    if (o.isReplacement || o.replacementDelivery) {
      financialStatus = 'No Cash Collection Required';
      amountCollected = 0;
    } else if (o.status === 'delivered' || o.status === 'completed') {
      if (!financialStatus) {
        if (o.paymentType === 'full' || o.paymentType === 'full_advance' || o.paymentMethod === 'gcash' && !isReservation && o.paymentType !== 'deposit' && o.paymentType !== 'downpayment') {
          financialStatus = 'No Cash Collection Required';
          amountCollected = 0;
        } else {
          financialStatus = o.status === 'completed' ? 'Verified' : 'Pending Turnover';
          if (amountCollected === undefined) {
            const isDown = o.paymentType === 'deposit' || o.paymentType === 'downpayment' || o.paymentType === 'down' || o.isPreOrder;
            const depositPaid = isDown ? Math.floor(total * 0.3) : (o.paymentMethod === 'gcash' ? total : 0);
            amountCollected = Math.max(0, total - depositPaid);
          }
        }
      }
    } else {
      if (!financialStatus) {
        if (o.paymentType === 'full' || o.paymentType === 'full_advance') {
          financialStatus = 'No Cash Collection Required';
          amountCollected = 0;
        }
      }
    }

    if (financialStatus === 'No Cash Collection Required') {
      amountCollected = 0;
    } else if (amountCollected === undefined) {
      const isDown = o.paymentType === 'deposit' || o.paymentType === 'downpayment' || o.paymentType === 'down' || o.isPreOrder;
      const depositPaid = isDown ? Math.floor(total * 0.3) : (o.paymentMethod === 'gcash' ? total : 0);
      amountCollected = Math.max(0, total - depositPaid);
    }

    // Order completion workflow state fields
    let customerConfirmation = Boolean(o.customerConfirmation);
    if (o.status === 'completed' && !customerConfirmation) {
      customerConfirmation = true;
    }

    const customerConfirmationDate = o.customerConfirmationDate || (customerConfirmation ? (o.completedAt ? new Date(o.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })) : null);
    const customerConfirmationTime = o.customerConfirmationTime || (customerConfirmation ? (o.completedAt ? new Date(o.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '10:00 AM') : null);

    let financialVerification = Boolean(o.financialVerification || o.cashAuditStatus === 'Audited');
    if (financialStatus === 'Verified' || financialStatus === 'No Cash Collection Required') {
      financialVerification = true;
    } else if (financialStatus === 'Pending Turnover') {
      financialVerification = false;
    }

    const verifiedBy = o.verifiedBy || (financialVerification ? 'Administrator' : null);
    const verifiedDate = o.verifiedDate || (financialVerification ? (collectedDate || new Date().toLocaleDateString()) : null);
    const verifiedTime = o.verifiedTime || (financialVerification ? (collectedTime || '10:00 AM') : null);

    let completionType = o.completionType || 'Pending';
    if (o.status === 'completed' && (completionType === 'Pending' || !completionType)) {
      if (o.isReplacement || o.replacementDelivery) {
        completionType = 'Replacement Completed';
      } else if (o.customerConfirmation === 'Auto Completed (48 Hours)' || o.completionMethod === 'Automatic Completion') {
        completionType = 'System Auto Completed';
      } else if (customerConfirmation) {
        completionType = 'Customer Confirmed';
      } else {
        completionType = 'Full Workflow Verified';
      }
    }

    return {
      ...o,
      total: total,
      totalBill: total,
      amountPaid: amountPaid,
      remainingAmount: remainingAmount,
      remainingBalance: remainingAmount,
      financialStatus: financialStatus || (o.isReplacement ? 'No Cash Collection Required' : 'Pending Turnover'),
      financialVerification: financialVerification,
      amountCollected: amountCollected,
      collectedBy: collectedBy,
      collectedDate: collectedDate,
      collectedTime: collectedTime,
      customerConfirmation: customerConfirmation,
      customerConfirmationDate: customerConfirmationDate,
      customerConfirmationTime: customerConfirmationTime,
      verifiedBy: verifiedBy,
      verifiedDate: verifiedDate,
      verifiedTime: verifiedTime,
      completionType: completionType,
      createdAt: o.createdAt
    };
  });

  // Evaluate 48-hour auto completion & dual condition fulfillment & 48-hour rejection/allocation payment deadline cancellation ONLY after Firestore orders are hydrated
  let autoCompletedAny = false;
  let deadlineCancelledAny = false;
  let reservationAllocationExpiredAny = false;
  const deadlineModifiedOrders = [];

  if (isOrdersHydrated()) {
    mapped.forEach(order => {
      if (isStaleOrderOrReservation(order)) return;
      if (order.status === 'delivered') {
        const changed = evaluateOrderCompletion(order);
        if (changed) autoCompletedAny = true;
      }
      const cancelledRejection = evaluateOrderPaymentRejectionDeadline(order);
      const cancelledAllocationDeadline = evaluateReservationPaymentDeadline(order, true);
      if (cancelledRejection || cancelledAllocationDeadline) {
        deadlineCancelledAny = true;
        if (cancelledAllocationDeadline) reservationAllocationExpiredAny = true;
        deadlineModifiedOrders.push(order);
      }
    });

    if (autoCompletedAny || deadlineCancelledAny) {
      try {
        localStorage.setItem('aurora-orders', JSON.stringify(mapped));
      } catch(e) {}

      if (deadlineModifiedOrders.length > 0) {
        deadlineModifiedOrders.forEach(ord => {
          try {
            registerPendingOrderWrite(ord.id, ord);
            saveFirestoreDoc('orders', String(ord.id), ord);
          } catch (e) {
            console.warn('[AUTO-CANCEL] Error saving cancelled order to Firestore:', e);
          }
        });
      }

      if (reservationAllocationExpiredAny && typeof allocateStockToReservations === 'function') {
        try {
          allocateStockToReservations();
        } catch (e) {}
      }

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-orders' } }));
          window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { orders: mapped } }));
        }
      } catch (e) {}
    }
  }

  // Sort oldest first (ascending order) for chronological FCFS workflow prioritization
  mapped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return mapped;
}

export function getCashToAudit(order) {
  if (!order) return 0;
  const isReplacement = Boolean(
    order.isReplacement ||
    order.replacementDelivery ||
    order.amountPaid === 'Original Payment' ||
    order.financialStatus === 'No Cash Collection Required'
  );
  if (isReplacement) return 0;

  if (order.amountCollected !== undefined && order.amountCollected !== null) {
    return Number(order.amountCollected);
  }

  const totalBill = Number(order.total || (order.items || []).reduce((acc, item) => acc + ((item.product?.price || 0) * (item.quantity || 0)), 0) + (order.deliveryOption === 'delivery' ? 80 : 0));

  if (order.paymentMethod === 'gcash' && (order.paymentType === 'full' || order.paymentType === 'full_advance')) {
    return 0;
  }

  if (order.paymentType === 'deposit' || order.paymentType === 'downpayment' || order.paymentType === 'down' || order.isPreOrder) {
    const depositPaid = Math.floor(totalBill * 0.3);
    return Math.max(0, totalBill - depositPaid);
  }

  return totalBill;
}

export function evaluateOrderCompletion(order) {
  if (!order || order.status === 'completed' || order.status === 'cancelled') {
    return false;
  }

  if (order.status !== 'delivered') {
    return false;
  }

  // Stop automatic completion if issue is reported
  if (order.status === 'issue-reported' || order.issueReported || (order.reportedIssue && order.reportedIssue.status === 'pending-review')) {
    return false;
  }

  const isFinancialVerified = Boolean(
    order.financialVerification === true || 
    order.financialStatus === 'Verified' || 
    order.financialStatus === 'No Cash Collection Required'
  );

  const isCustomerConfirmed = Boolean(order.customerConfirmation === true || order.customerConfirmation === 'Confirmed');

  if (isCustomerConfirmed && isFinancialVerified) {
    order.status = 'completed';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const now = new Date();
    const formattedDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!order.customerConfirmationDate) {
      order.customerConfirmationDate = formattedDate;
    }
    order.completionType = 'Full Workflow Verified';
    order.financialVerification = true;
    if (order.financialStatus !== 'No Cash Collection Required') {
      order.financialStatus = 'Verified';
    }
    order.completedAt = order.completedAt || order.customerConfirmedAt || now.toISOString();

    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
      id: 'hist-comp-' + Date.now(),
      status: 'Completed',
      changedBy: 'System / Admin Workflow',
      changedAt: `${formattedDate}, ${formattedTime}`,
      note: 'Order successfully completed following customer confirmation and financial audit verification.'
    });

    try {
      addActivityLog(
        'Delivery',
        `Order ticket #${order.id} marked as Completed following customer confirmation and verified financial audit.`,
        `Order #${order.id}`
      );
    } catch (e) {}

    return true;
  }

  // Check 48-Hour Auto Completion Rule:
  // Order Status = Delivered AND financialVerification == true AND customerConfirmation == false/pending AND No Issue Report AND 48 hours have passed
  let autoCompleted48h = false;
  let deadlineDate = null;

  if (!isCustomerConfirmed && isFinancialVerified) {
    let deliveredMs = null;
    if (order.deliveredAt) {
      deliveredMs = new Date(order.deliveredAt).getTime();
    } else if (order.customerConfirmationDeadline) {
      deliveredMs = new Date(order.customerConfirmationDeadline).getTime() - (48 * 60 * 60 * 1000);
    } else if (order.deliveredDate) {
      const timeStr = order.deliveredTime || '00:00';
      deliveredMs = new Date(`${order.deliveredDate} ${timeStr}`).getTime();
    }

    if ((!deliveredMs || isNaN(deliveredMs)) && order.statusHistory) {
      const delHist = order.statusHistory.find(h => (h.status || '').toLowerCase() === 'delivered');
      if (delHist && delHist.changedAt) {
        deliveredMs = new Date(delHist.changedAt).getTime();
      }
    }

    if (deliveredMs && !isNaN(deliveredMs)) {
      deadlineDate = new Date(deliveredMs + (48 * 60 * 60 * 1000));
      if (Date.now() >= deadlineDate.getTime()) {
        autoCompleted48h = true;
      }
    }
  }

  // Only auto-complete on 48h timeout when payment is verified
  if (isFinancialVerified && autoCompleted48h && deadlineDate) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const completionDate = `${months[deadlineDate.getMonth()]} ${deadlineDate.getDate()}, ${deadlineDate.getFullYear()}`;
    const completionTime = deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const completedAtIso = deadlineDate.toISOString();

    order.status = 'completed';
    order.customerConfirmation = 'Auto Completed (48 Hours)';
    order.completionType = 'System Auto Completed';
    order.completionMethod = 'Automatic Completion';
    order.customerConfirmationDate = completionDate;
    order.customerConfirmationTime = completionTime;
    order.financialVerification = true;
    if (order.financialStatus !== 'No Cash Collection Required') {
      order.financialStatus = 'Verified';
    }

    order.completedAt = completedAtIso;

    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
      id: 'hist-comp-' + deadlineDate.getTime(),
      status: 'Completed',
      changedBy: 'System Auto-Completion',
      changedAt: `${completionDate}, ${completionTime}`,
      note: 'Order automatically completed after 48 hours because no customer issue was reported.'
    });

    try {
      addActivityLog(
        'Delivery',
        `Order ticket #${order.id} automatically completed after 48 hours because no customer issue was reported.`,
        `Order #${order.id}`
      );
    } catch (e) {}

    if (order.userId || order.customerId) {
      addNotification(
        order.userId || order.customerId,
        'Order Completed Automatically',
        `Your order #${order.id} has been automatically completed because no issue was reported within 48 hours after delivery.`,
        { 
          orderId: order.id, 
          type: 'order',
          eventKey: `order-completed-${order.id}`,
          notificationId: `notif-order-completed-${order.id}`,
          createdDate: completionDate,
          createdTime: completionTime,
          timestamp: completedAtIso
        }
      );
    }

    return true;
  }

  return false;
}

export function isReservationOrder(o) {
  if (!o) return false;
  // If ID starts with RES or res-, it's definitely a reservation!
  const idStr = String(o.id || '').toUpperCase().replace(/^#/, '');
  if (idStr.startsWith('RES')) return true;

  // Explicit boolean or type declarations
  if (o.isPreOrder === true || o.orderType === 'reservation' || o.type === 'reservation' || o.transactionType === 'reservation') return true;
  if (o.items && Array.isArray(o.items) && o.items.some(i => i && i.isReservation === true)) return true;

  const statusClean = (o.status || '').toLowerCase().replace(/_/g, '-');
  if (statusClean === 'pre-order' || statusClean === 'pre_order' || statusClean.includes('pre-order')) return true;

  if (o.isPreOrder === false || o.orderType === 'order' || o.type === 'order' || o.transactionType === 'order') {
    return false;
  }

  return false;
}

export function isReservationWaitingForReupload(order) {
  if (!order) return false;
  const statusClean = String(order.status || '').toLowerCase().replace(/_/g, '-');
  if (statusClean === 'cancelled' || statusClean === 'rejected' || statusClean === 'expired') return false;
  if (order.paymentStatus === 'rejected_expired' || order.autoCancelledDueToRejectionDeadline === true) return false;
  if (order.paymentVerified) return false;
  if (!order.paymentRejected && order.paymentStatus !== 'rejected') return false;
  if (order.hasCorrectedProof) return false;
  if (order.paymentStatus === 'pending_verification') return false;

  const candidateDeadlines = [];
  if (order.reuploadDeadline) {
    const parsed = new Date(order.reuploadDeadline).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed);
  }
  if (order.paymentRejectedAt) {
    const parsed = new Date(order.paymentRejectedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + (48 * 60 * 60 * 1000));
  }
  if (order.reuploadRequestedAt) {
    const parsed = new Date(order.reuploadRequestedAt).getTime();
    if (!isNaN(parsed) && parsed > 0) candidateDeadlines.push(parsed + (48 * 60 * 60 * 1000));
  }
  const deadlineMs = candidateDeadlines.length > 0 ? Math.max(...candidateDeadlines) : null;
  if (deadlineMs && Date.now() > deadlineMs) {
    return false;
  }

  return true;
}

export function isCancelledOrRejectedOrder(o) {
  if (!o) return false;
  const statusClean = (o.status || '').toLowerCase().replace(/_/g, '-');
  return statusClean === 'cancelled' || statusClean === 'rejected' || statusClean === 'expired' || o.paymentRejected === true;
}

export function getVerifiedCustomerPaymentInfo(o) {
  if (!o) return { isVerified: false, amount: 0, isReservation: false };
  if (isCancelledOrRejectedOrder(o) || o.isReplacement) {
    return { isVerified: false, amount: 0, isReservation: false };
  }

  const isRes = isReservationOrder(o);
  const statusClean = (o.status || '').toLowerCase().replace(/_/g, '-');

  // Check if status or payment flag indicates an approved/verified order or transaction
  const isVerifiedStatus = [
    'processing',
    'to-ship',
    'preparing',
    'to-receive',
    'shipped',
    'in-transit',
    'delivered',
    'completed',
    'fulfilled',
    'ready_for_processing',
    'ready-for-processing'
  ].includes(statusClean);

  const isVerifiedFlag = o.paymentVerified === true || o.isVerifiedPayment === true || o.paymentStatus === 'verified' || o.paymentStatus === 'paid';

  if (!isVerifiedStatus && !isVerifiedFlag) {
    return { isVerified: false, amount: 0, isReservation: isRes };
  }

  // Calculate transaction sales amount
  let amount = 0;
  if (isRes) {
    // For reservation: deposit amount, amountPaid, or total
    if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
      amount = Number(o.amountPaid);
    } else if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
      amount = Number(o.depositAmount);
    } else {
      const tot = Number(o.total || o.totalPrice || o.totalBill || 0);
      const isFull = o.paymentType === 'full' || o.paymentOption === 'Full Payment';
      amount = isFull ? tot : Math.round(tot * 0.3);
    }
  } else {
    // For regular approved order: verified amount actually paid/collected
    const tot = Number(o.total || o.totalPrice || o.totalBill || 0);
    const isFullPayment = o.paymentType === 'full' || 
                          o.paymentType === 'full_advance' || 
                          o.paymentOption === 'Full Payment' || 
                          o.paymentOption === 'full' || 
                          o.paymentType === 'Full Payment' || 
                          o.financialStatus === 'No Cash Collection Required';

    const isDown = o.paymentType === 'deposit' || 
                   o.paymentType === 'downpayment' || 
                   o.paymentType === 'down' || 
                   o.paymentOption === '30% Down Payment' || 
                   (o.remainingAmount !== undefined && Number(o.remainingAmount) > 0) ||
                   (o.remainingBalance !== undefined && Number(o.remainingBalance) > 0);

    const isCompleted = statusClean === 'completed' || statusClean === 'fulfilled';
    const isTurnoverVerified = o.financialVerification === true || 
                               o.financialStatus === 'Verified' || 
                               o.cashAuditStatus === 'Audited';

    if (isCompleted || (statusClean === 'delivered' && isTurnoverVerified)) {
      // Completed order or delivered with turnover verified: full total collected
      amount = tot > 0 ? tot : Number(o.amountPaid || 0);
    } else if (isFullPayment) {
      // Full payment in advance: full total collected
      amount = tot > 0 ? tot : Number(o.amountPaid || 0);
    } else if (isDown) {
      // Customer paid downpayment only (order in processing, to-ship, to-receive, or delivered pending turnover)
      if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0 && Number(o.amountPaid) < tot) {
        amount = Number(o.amountPaid);
      } else if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
        amount = Number(o.depositAmount);
      } else if (o.remainingAmount !== undefined && Number(o.remainingAmount) > 0 && tot > Number(o.remainingAmount)) {
        amount = tot - Number(o.remainingAmount);
      } else {
        amount = Math.floor(tot * 0.3);
      }
    } else {
      if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
        amount = Number(o.amountPaid);
      } else {
        amount = tot;
      }
    }

    if (tot > 0 && amount > tot) {
      amount = tot;
    }
  }

  return { isVerified: true, amount: amount, isReservation: isRes };
}

export function isOrderVerified(o) {
  return getVerifiedCustomerPaymentInfo(o).isVerified;
}

export function getCustomerVerifiedSpentAmount(o) {
  if (!o || o.isReplacement) return 0;

  const statusClean = (o.status || '').toLowerCase().replace(/_/g, '-');
  const isCancelled = statusClean === 'cancelled' || statusClean === 'rejected' || o.status === 'Cancelled';

  // Check if payment was approved / verified
  const isPaymentVerified = o.paymentVerified === true || o.isVerifiedPayment === true || o.paymentStatus === 'verified' || o.paymentStatus === 'paid';
  const isStatusVerified = [
    'processing',
    'to-ship',
    'preparing',
    'to-receive',
    'shipped',
    'in-transit',
    'delivered',
    'completed',
    'fulfilled',
    'ready_for_processing',
    'ready-for-processing'
  ].includes(statusClean);
  const isFinanciallyVerified = o.financialVerification === true || o.financialStatus === 'Verified' || o.cashAuditStatus === 'Audited';

  // Check if statusHistory records payment verification
  const hadVerifiedHistory = Array.isArray(o.statusHistory) && o.statusHistory.some(h => {
    const hNote = (h.note || '').toLowerCase();
    const hStatus = (h.status || '').toLowerCase();
    return hStatus.includes('processing') || hNote.includes('verified') || hNote.includes('approved');
  });

  const wasPaymentEverVerified = isPaymentVerified || isFinanciallyVerified || hadVerifiedHistory;

  // Rejected payment without verified approval contributes 0
  if (o.paymentRejected === true && !isPaymentVerified) {
    return 0;
  }

  const tot = Number(o.total || o.totalPrice || o.totalBill || 0);

  // If order is cancelled:
  if (isCancelled) {
    // Customer cancelled before any payment / unverified: contributes 0
    if (!wasPaymentEverVerified) {
      return 0;
    }
    // Customer cancelled after down payment was verified: only the verified down payment actually paid counts
    if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
      return Math.min(Number(o.amountPaid), tot > 0 ? tot : Number(o.amountPaid));
    }
    if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
      return Math.min(Number(o.depositAmount), tot > 0 ? tot : Number(o.depositAmount));
    }
    const isDown = o.paymentType === 'deposit' || 
                   o.paymentType === 'downpayment' || 
                   o.paymentType === 'down' || 
                   o.paymentOption === '30% Down Payment' || 
                   (o.remainingAmount !== undefined && Number(o.remainingAmount) > 0) ||
                   (o.remainingBalance !== undefined && Number(o.remainingBalance) > 0);
    if (isDown && tot > 0) {
      return Math.floor(tot * 0.3);
    }
    if ((o.paymentType === 'full' || o.paymentOption === 'Full Payment') && tot > 0) {
      return tot;
    }
    return tot > 0 ? Math.floor(tot * 0.3) : 0;
  }

  // Payment not yet verified (e.g. pending approval): contributes 0
  if (!isPaymentVerified && !isStatusVerified && !isFinanciallyVerified) {
    return 0;
  }

  const isRes = isReservationOrder(o);

  if (isRes) {
    if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
      return Number(o.amountPaid);
    }
    if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
      return Number(o.depositAmount);
    }
    const isFull = o.paymentType === 'full' || o.paymentOption === 'Full Payment';
    return isFull ? tot : Math.round(tot * 0.3);
  }

  // Standard regular order:
  const isFullPayment = o.paymentType === 'full' || 
                        o.paymentType === 'full_advance' || 
                        o.paymentOption === 'Full Payment' || 
                        o.paymentOption === 'full' || 
                        o.paymentType === 'Full Payment' || 
                        o.financialStatus === 'No Cash Collection Required';

  const isBalanceVerified = statusClean === 'completed' || 
                            o.financialVerification === true || 
                            o.financialStatus === 'Verified' || 
                            o.cashAuditStatus === 'Audited';

  // Balance later paid and verified OR Full Payment verified:
  if (isBalanceVerified || isFullPayment) {
    return tot > 0 ? tot : Number(o.amountPaid || 0);
  }

  // Down payment only verified:
  const isDown = o.paymentType === 'deposit' || 
                 o.paymentType === 'downpayment' || 
                 o.paymentType === 'down' || 
                 o.paymentOption === '30% Down Payment' || 
                 (o.remainingAmount !== undefined && Number(o.remainingAmount) > 0) ||
                 (o.remainingBalance !== undefined && Number(o.remainingBalance) > 0);

  if (isDown) {
    if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0 && Number(o.amountPaid) < tot) {
      return Number(o.amountPaid);
    }
    if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
      return Number(o.depositAmount);
    }
    if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
      return Number(o.amountPaid);
    }
    return Math.floor(tot * 0.3);
  }

  if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
    return Number(o.amountPaid);
  }

  return tot;
}

export function getAllOrders() {
  return getOrders();
}

export function getActualRecordedPaidAmount(order) {
  if (!order) return 0;

  // If order was already cancelled and has preserved paid amount, return it
  if (order.status === 'cancelled') {
    if (order.originalAmountPaid !== undefined && !isNaN(Number(order.originalAmountPaid))) {
      return Number(order.originalAmountPaid);
    }
    if (order.amountPaidBeforeCancellation !== undefined && !isNaN(Number(order.amountPaidBeforeCancellation))) {
      return Number(order.amountPaidBeforeCancellation);
    }
  }

  // Normal orders only for Step 1 (reservations preserved for later step)
  const isRes = isReservationOrder(order);
  if (isRes) {
    return 0;
  }

  // Cash on delivery / Cash on pickup is NOT a paid amount until physically collected and verified
  const method = String(order.paymentMethod || '').trim().toLowerCase();
  if (method === 'cash' || method === 'cod') {
    const isCollected = order.financialStatus === 'Verified' || 
                        order.financialVerification === true || 
                        order.cashAuditStatus === 'Audited';
    if (!isCollected) {
      return 0;
    }
  }

  // A rejected payment proof screenshot alone must NOT be treated as received money
  if (order.paymentRejected === true && !order.paymentVerified && order.paymentStatus !== 'verified') {
    return 0;
  }

  // Determine if payment is verified/recorded
  const isVerified = order.paymentVerified === true || 
                     order.isVerifiedPayment === true || 
                     order.paymentStatus === 'verified' || 
                     order.paymentStatus === 'paid';

  if (!isVerified) {
    return 0;
  }

  const tot = Number(order.total || order.totalPrice || order.totalBill || 0);

  const isDown = order.paymentType === 'deposit' || 
                 order.paymentType === 'downpayment' || 
                 order.paymentType === 'down' || 
                 order.paymentOption === '30% Down Payment' || 
                 (order.remainingAmount !== undefined && Number(order.remainingAmount) > 0) ||
                 (order.remainingBalance !== undefined && Number(order.remainingBalance) > 0);

  if (isDown) {
    if (order.amountPaid !== undefined && order.amountPaid !== null && !isNaN(Number(order.amountPaid)) && Number(order.amountPaid) > 0 && Number(order.amountPaid) < tot) {
      return Number(order.amountPaid);
    }
    if (order.depositAmount !== undefined && order.depositAmount !== null && !isNaN(Number(order.depositAmount)) && Number(order.depositAmount) > 0) {
      return Number(order.depositAmount);
    }
    return Math.floor(tot * 0.3);
  }

  // Full payment
  if (order.amountPaid !== undefined && order.amountPaid !== null && !isNaN(Number(order.amountPaid)) && Number(order.amountPaid) > 0) {
    return Number(order.amountPaid);
  }

  return tot;
}

export function setItemAndSync(key, value, targetDocInfo = null) {
  safeLocalStorageSet(key, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key } }));
    window.dispatchEvent(new CustomEvent('aurora-orders-updated', { detail: { key } }));
  }

  // Asynchronously sync collection or document to Firestore
  const keyToCol = {
    'aurora-products': 'products',
    'aurora-users': 'users',
    'aurora-admin-users': 'adminUsers',
    'aurora-customers': 'customers',
    'aurora-orders': 'orders',
    'aurora-activity-logs': 'activityLogs',
    'aurora-notifications': 'notifications',
    'aurora-inventory-history': 'inventoryHistory',
    'aurora-reviews': 'reviews',
    'aurora-messages': 'contactMessages'
  };
  const col = keyToCol[key];
  if (col) {
    // Append-only or document-authoritative collections must never be bulk overwritten from local cache
    const docAuthoritativeOnly = ['activityLogs', 'inventoryHistory', 'notifications', 'reviews', 'contactMessages'];
    if (docAuthoritativeOnly.includes(col)) {
      if (targetDocInfo && (targetDocInfo.docId || targetDocInfo.id)) {
        const docId = targetDocInfo.docId || targetDocInfo.id;
        const docData = targetDocInfo.docData || targetDocInfo.data;
        if (docId && docData) {
          saveFirestoreDoc(col, docId, docData);
        }
      }
      return;
    }

    try {
      if (targetDocInfo) {
        const docCol = targetDocInfo.colName || col;
        const docId = targetDocInfo.docId || targetDocInfo.id;
        const docData = targetDocInfo.docData || targetDocInfo.data;
        if (docCol && docId && docData && typeof saveFirestoreDoc === 'function') {
          saveFirestoreDoc(docCol, docId, docData);
        }
      }
    } catch (err) {
      console.warn('[FIREBASE] setItemAndSync error:', err);
    }
  }
}

export async function saveOrderDoc(order) {
  if (!order || !order.id) return;
  const orders = getOrders();
  const idx = orders.findIndex(o => String(o.id) === String(order.id));
  if (idx !== -1) {
    orders[idx] = order;
  } else {
    orders.unshift(order);
  }
  registerPendingOrderWrite(order.id, order);
  saveOrders(orders, { colName: 'orders', docId: order.id, docData: order });
  try {
    await saveFirestoreDoc('orders', order.id, order);
  } catch (err) {
    console.warn('[FIREBASE] Error saving order doc directly:', err);
  }
}

export function saveOrders(orders, targetDocInfo = null) {
  if (targetDocInfo && (targetDocInfo.docId || targetDocInfo.id)) {
    const docId = String(targetDocInfo.docId || targetDocInfo.id);
    const docData = targetDocInfo.docData || targetDocInfo.data;
    if (docData) {
      registerPendingOrderWrite(docId, docData);
      saveFirestoreDoc('orders', docId, docData).catch(err => {
        console.warn('[FIREBASE] Targeted saveOrders Firestore write warning:', err);
      });
    }
  } else if (Array.isArray(orders) && typeof saveFirestoreDoc === 'function') {
    // Auto-detect newly created or modified orders for targeted Firestore persistence
    try {
      const prevOrders = JSON.parse(localStorage.getItem('aurora-orders') || '[]');
      const prevMap = new Map();
      prevOrders.forEach(o => { if (o && o.id) prevMap.set(String(o.id), JSON.stringify(o)); });

      orders.forEach(o => {
        if (!o || !o.id || isStaleOrderOrReservation(o)) return;
        const prevJson = prevMap.get(String(o.id));
        const currentJson = JSON.stringify(o);
        if (!prevJson || prevJson !== currentJson) {
          registerPendingOrderWrite(o.id, o);
          saveFirestoreDoc('orders', o.id, o).catch(err => {
            console.warn('[FIREBASE] Auto-detected order persist warning for', o.id, err);
          });
        }
      });
    } catch (diffErr) {
      console.warn('[FIREBASE] Error auto-diffing orders in saveOrders:', diffErr);
    }
  }

  try {
    setItemAndSync('aurora-orders', JSON.stringify(orders), targetDocInfo);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.warn('[STORAGE] LocalStorage quota exceeded. Compressing payment proof cache without deleting any orders...');
      // Strip paymentProofDataUrl only if it is a large base64 data: URL (Firebase Storage holds the persistent copy)
      for (let i = 0; i < orders.length; i++) {
        if (orders[i].paymentProofDataUrl && typeof orders[i].paymentProofDataUrl === 'string' && orders[i].paymentProofDataUrl.startsWith('data:')) {
          orders[i].paymentProofDataUrl = orders[i].paymentProofUrl || '';
        }
      }
      try {
        setItemAndSync('aurora-orders', JSON.stringify(orders), targetDocInfo);
      } catch (retryErr) {
        console.warn('[STORAGE] Failed to save orders cache after stripping data URLs:', retryErr);
      }
    } else {
      throw e;
    }
  }
  syncUsersAndCustomers();
}

export function generateReservationId(existingOrders = null) {
  const ordersList = existingOrders || getOrders() || [];
  let candidateId = '';
  let attempts = 0;
  do {
    const randNum = Math.floor(100000 + Math.random() * 900000);
    candidateId = `RES-${randNum}`;
    attempts++;
  } while (
    (ordersList.some(o => o && String(o.id) === candidateId) ||
     (typeof CONFIRMED_STALE_RESERVATION_IDS !== 'undefined' && CONFIRMED_STALE_RESERVATION_IDS.has(candidateId))) &&
    attempts < 100
  );
  return candidateId;
}

export function addOrder(orderData) {
  console.log('[DEBUG] addOrder called with orderData:', orderData);
  const orders = getOrders();
  const now = new Date();
  
  // Decide starting status based on payment proof
  const startStatus = orderData.status || 'to-pay'; // matching custom flow
  
  const user = getCurrentUser();
  const customerEmail = orderData.customerEmail || user?.email || '';
  const userId = user ? user.id : (orderData.userId || '');
  const customerId = user ? user.id : (orderData.customerId || '');
  
  const clonedItems = orderData.items ? JSON.parse(JSON.stringify(orderData.items)) : [];
  
  const newOrder = {
    ...orderData,
    items: clonedItems,
    userId,
    customerId,
    customerEmail,
    id: (() => {
      if (orderData.id) return orderData.id;
      const isPreOrder = !!orderData.isPreOrder;
      const hasResItem = clonedItems.some(i => i.isReservation);
      if (isPreOrder || hasResItem) {
        return generateReservationId(orders);
      }
      
      const prefix = 'RF';
      let maxNum = 200000;
      
      orders.forEach(o => {
        if (o.id && String(o.id).startsWith(prefix)) {
          const numPart = parseInt(String(o.id).substring(prefix.length), 10);
          if (!isNaN(numPart) && numPart > maxNum) {
            maxNum = numPart;
          }
        }
      });
      return prefix + (maxNum + 1);
    })(),
    createdAt: orderData.createdAt ? new Date(orderData.createdAt).toISOString() : now.toISOString(),
    updatedAt: orderData.updatedAt ? new Date(orderData.updatedAt).toISOString() : (orderData.createdAt ? new Date(orderData.createdAt).toISOString() : now.toISOString()),
    status: startStatus,
    queuePosition: (() => {
      if (orderData.queuePosition !== undefined && typeof orderData.queuePosition === 'number') return orderData.queuePosition;
      if (orderData.isPreOrder || clonedItems.some(i => i.isReservation)) {
        const activeRes = orders.filter(o => 
          (o.isPreOrder || (o.items && o.items.some(it => it.isReservation))) &&
          o.status !== 'cancelled' && o.status !== 'completed' && o.status !== 'delivered'
        );
        return activeRes.length + 1;
      }
      return undefined;
    })(),
    statusHistory: orderData.statusHistory ? JSON.parse(JSON.stringify(orderData.statusHistory)) : [
      {
        id: Date.now().toString() + '-init',
        status: 'New Order',
        changedBy: 'System',
        changedAt: now.toLocaleString(),
        note: 'Order submitted by customer'
      }
    ]
  };

  console.log('[DEBUG] Generated new order object:', newOrder);

  // Process partial stock split or reservation conversion if stock is insufficient
  let finalOrder = newOrder;
  let createdReservation = null;

  if (!orderData.skipReservation) {
    const res = processOrderStockAndSplitIfNeeded(newOrder);
    if (res && res.finalOrder) {
      finalOrder = res.finalOrder;
      createdReservation = res.createdReservation;
      if (createdReservation) {
        finalOrder.createdReservation = createdReservation;
      }
    } else if (res && res.id) {
      finalOrder = res;
    }
  } else {
    // Normal order placed with skipReservation (available stock portion only)
    const products = getProducts();
    let prodsChanged = false;
    const affectedProductIds = new Set();
    (finalOrder.items || []).forEach(it => {
      const pId = it.product?.id || it.productId || it.id;
      const p = products.find(prod => String(prod.id) === String(pId));
      if (p) {
        const qty = Number(it.quantity || 0);
        p.stock = Math.max(0, Number(p.stock || 0) - qty);
        if (p.currentStock !== undefined) {
          p.currentStock = Math.max(0, Number(p.currentStock || 0) - qty);
        } else {
          p.currentStock = p.stock;
        }
        affectedProductIds.add(String(p.id));
        addInventoryHistory({
          productId: p.id,
          productName: p.name,
          quantityAdded: -qty,
          remarks: `Order placed: #${finalOrder.id}`
        }, true);
        prodsChanged = true;
      }
    });
    if (prodsChanged) {
      saveProducts(products, true);
      if (affectedProductIds.size > 0 && typeof saveFirestoreDoc === 'function') {
        affectedProductIds.forEach(pId => {
          const prod = products.find(p => String(p.id) === String(pId));
          if (prod) {
            const { reservedStock, availableStock, ...rest } = prod;
            const physicalStock = prod.currentStock !== undefined ? Number(prod.currentStock) : Number(prod.stock);
            saveFirestoreDoc('products', String(pId), {
              ...rest,
              stock: physicalStock,
              currentStock: physicalStock
            }).catch(err => {
              console.warn(`[FIREBASE] Failed targeted stock persist for product ${pId}:`, err);
            });
          }
        });
      }
    }
    finalOrder.stockDeducted = true;
    finalOrder.consumedFromStock = (finalOrder.items || []).reduce((acc, it) => acc + Number(it.quantity || 0), 0);
    finalOrder.consumedAt = finalOrder.createdAt || new Date().toISOString();
  }

  // Ensure finalOrder ID prefix matches its role (RF for regular order, res- for pre-order)
  if (!finalOrder.isPreOrder && finalOrder.id && String(finalOrder.id).toLowerCase().startsWith('res-')) {
    let maxNum = 200000;
    orders.forEach(o => {
      if (o.id && String(o.id).startsWith('RF')) {
        const numPart = parseInt(String(o.id).substring(2), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    });
    finalOrder.id = 'RF' + (maxNum + 1);
  } else if (finalOrder.isPreOrder && finalOrder.id && !String(finalOrder.id).toUpperCase().startsWith('RES-')) {
    finalOrder.id = generateReservationId(orders);
  }

  const latestOrders = getOrders();
  if (createdReservation && !latestOrders.some(o => o.id === createdReservation.id)) {
    latestOrders.unshift(createdReservation);
  }
  if (!latestOrders.some(o => o.id === finalOrder.id)) {
    latestOrders.unshift(finalOrder);
  }
  registerPendingOrderWrite(finalOrder.id, finalOrder);
  saveOrders(latestOrders, { colName: 'orders', docId: finalOrder.id, docData: finalOrder });
  saveFirestoreDoc('orders', finalOrder.id, finalOrder).catch(err => {
    console.warn('[FIREBASE] Error saving order doc directly in addOrder:', err);
  });
  if (createdReservation) {
    registerPendingOrderWrite(createdReservation.id, createdReservation);
    saveFirestoreDoc('orders', createdReservation.id, createdReservation).catch(err => {
      console.warn('[FIREBASE] Error saving split reservation doc directly in addOrder:', err);
    });
  }
  console.log('[DEBUG] Saved orders array to localStorage. New count:', latestOrders.length);

  // Send real-time notifications for the newly placed order/reservation
  const isPre = !!finalOrder.isPreOrder || (finalOrder.items && finalOrder.items.some(i => i.isReservation));
  
  // A. Notify Customer
  if (isPre) {
    addNotification(
      userId,
      '📌 Reservation Submitted',
      'Your reservation has been successfully submitted.',
      { role: 'customer', type: 'reservation', reservationId: finalOrder.id }
    );
  } else {
    addNotification(
      userId,
      '🛒 Order Submitted',
      `Your order #${finalOrder.id} has been submitted successfully and is waiting for administrator approval.`,
      { role: 'customer', type: 'order', orderId: finalOrder.id }
    );
  }

  if (createdReservation) {
    addNotification(
      userId,
      '📌 Reservation Created for Remaining Stock',
      `A reservation ticket #${createdReservation.id} was created for the out-of-stock quantity and placed in the queue.`,
      { role: 'customer', type: 'reservation', reservationId: createdReservation.id }
    );
  }

  // B. Notify Admin & Staff
  if (isPre) {
    addNotification(
      'admin',
      '📌 New Reservation',
      'A customer submitted a reservation request.',
      { role: 'admin', type: 'reservation', reservationId: finalOrder.id }
    );
  } else {
    addNotification(
      'admin',
      '🛒 New Order Received',
      'A new customer order is waiting for review.',
      { role: 'admin', type: 'new-order', orderId: finalOrder.id }
    );
  }

  if (createdReservation) {
    addNotification(
      'admin',
      '📌 New Linked Reservation',
      `New reservation #${createdReservation.id} linked to order #${finalOrder.id} in queue.`,
      { role: 'admin', type: 'reservation', reservationId: createdReservation.id }
    );
  }

  // C. Notify Admin & Staff if GCash payment receipt is uploaded
  if (finalOrder.paymentMethod === 'gcash' && finalOrder.paymentProofDataUrl) {
    addNotification(
      'admin',
      '💳 Payment Submitted',
      'A customer uploaded a payment receipt.',
      { role: 'admin', type: 'payment', orderId: finalOrder.id }
    );
  }

  return finalOrder;
}

function isValidStaffOrDriverName(name, order = null, issue = null) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();

  const forbidden = [
    'n/a', 'unknown', 'driver', 'none', 'null', 'undefined', 'customer',
    'customer self-confirmation', 'system', 'system auto-completion',
    'not yet assigned', 'not assigned yet', 'unassigned'
  ];

  if (forbidden.some(f => lower === f)) return false;

  if (order) {
    const custValues = [
      order.fullName,
      order.customerName,
      order.customerEmail,
      order.userId,
      order.customerId,
      order.recipientName,
      order.phone
    ];
    for (const val of custValues) {
      if (val && typeof val === 'string' && val.trim()) {
        const cLower = val.trim().toLowerCase();
        if (cLower.length > 1 && (lower === cLower || lower.includes(cLower) || cLower.includes(lower))) {
          return false;
        }
      }
    }
  }

  if (issue) {
    const issueCustValues = [
      issue.customerName,
      issue.customerEmail,
      issue.userId,
      issue.customerId
    ];
    for (const val of issueCustValues) {
      if (val && typeof val === 'string' && val.trim()) {
        const cLower = val.trim().toLowerCase();
        if (cLower.length > 1 && (lower === cLower || lower.includes(cLower) || cLower.includes(lower))) {
          return false;
        }
      }
    }
  }

  return true;
}

export function getAssignedStaffName(order, issue = null) {
  if (!order) return 'Not Assigned Yet';

  if (issue && issue.decisionHistory && issue.decisionHistory.reviewerName) {
    if (isValidStaffOrDriverName(issue.decisionHistory.reviewerName, order, issue)) {
      return issue.decisionHistory.reviewerName.trim();
    }
  }

  const staffCandidates = [
    order.approvedByName,
    order.preparedByName,
    order.verifiedByName,
    order.verifiedBy,
    order.deliveryVerificationBy,
    order.assignedStaff,
    order.preparedBy,
    order.staffName
  ];

  for (const candidate of staffCandidates) {
    if (isValidStaffOrDriverName(candidate, order, issue)) {
      return candidate.trim();
    }
  }

  if (order.statusHistory && Array.isArray(order.statusHistory)) {
    for (let i = order.statusHistory.length - 1; i >= 0; i--) {
      const step = order.statusHistory[i];
      if (step && step.changedByRole && (step.changedByRole === 'admin' || step.changedByRole === 'staff')) {
        if (isValidStaffOrDriverName(step.changedBy, order, issue)) {
          return step.changedBy.trim();
        }
      }
    }
  }

  return 'Not Assigned Yet';
}

export function getAssignedDeliveryPersonName(order, issue = null) {
  if (!order) return 'Not Assigned Yet';

  const driverCandidates = [
    order.deliveredByName,
    order.assignedDeliveryPersonName,
    order.driverName,
    order.assignedDriver,
    order.deliveryVerificationBy,
    order.verifiedByName,
    order.verifiedBy
  ];

  for (const candidate of driverCandidates) {
    if (isValidStaffOrDriverName(candidate, order, issue)) {
      return candidate.trim();
    }
  }

  return 'Not Assigned Yet';
}

export function updateOrderStatus(orderId, status, note = '', extraFields = {}) {
  const orders = getOrders();
  const now = new Date();
  const labels = {
    'to-pay': 'New Order',
    'processing': 'Processing',
    'to-ship': 'Preparing',
    'to-receive': 'Shipped',
    'delivered': 'Delivered',
    'completed': 'Completed',
    'cancelled': 'Cancelled'
  };

  const admin = getCurrentAdmin();
  const changerName = admin ? admin.name : (getCurrentUser()?.fullName || 'Customer');

  // Find if the order being completed is a replacement order
  const orderBeingUpdated = orders.find(o => o.id === orderId);
  const isTargetReplacementAndCompleted = orderBeingUpdated && orderBeingUpdated.isReplacement && status === 'completed';
  const originalOrderId = isTargetReplacementAndCompleted ? orderBeingUpdated.originalOrderId : null;

  const updated = orders.map(order => {
    // We update either the target order being updated OR the linked original order if the replacement is completed
    const shouldUpdate = order.id === orderId || (originalOrderId && order.id === originalOrderId);

    if (shouldUpdate) {
      // For original order, status becomes completed, but we can customize the note/history
      const currentStatus = order.id === originalOrderId ? 'completed' : status;
      const historyNote = order.id === originalOrderId 
        ? `✔ Original order automatically completed as Replacement Order #${orderId} was successfully fulfilled.`
        : (note || `Status updated to ${labels[status] || status}`);

      const historyItem = {
        id: 'hist-' + Date.now() + (order.id === originalOrderId ? '-orig' : ''),
        status: labels[currentStatus] || currentStatus,
        changedBy: changerName,
        changedAt: now.toLocaleString(),
        note: historyNote
      };

      let paymentVerified = order.paymentVerified;
      let remainingAmount = order.remainingAmount;
      let amountPaid = order.amountPaid;
      let stockDeducted = order.stockDeducted;

      if (admin) {
        const adminId = admin.id || admin.uid || 'admin-01';
        const adminName = admin.name || admin.fullName || 'Admin User';
        const adminRole = admin.role || 'admin';

        if (currentStatus === 'processing') {
          order.approvedByUID = adminId;
          order.approvedByName = adminName;
          order.approvedByRole = adminRole;
          order.approvedAt = now.toISOString();
        }

        if (currentStatus === 'to-ship' || currentStatus === 'processing') {
          order.preparedByUID = adminId;
          order.preparedByName = adminName;
          order.preparedByRole = adminRole;
          order.preparedAt = now.toISOString();
          order.assignedStaff = adminName;
          order.staffName = adminName;
        }

        if (currentStatus === 'to-receive' || currentStatus === 'delivered' || currentStatus === 'completed') {
          if (currentStatus === 'delivered' || currentStatus === 'to-receive') {
            order.deliveredByUID = adminId;
            order.deliveredByName = adminName;
            order.deliveredByRole = adminRole;
            order.deliveryVerifiedAt = now.toISOString();
            order.deliveryVerificationBy = adminName;
            order.verifiedBy = adminName;
            order.verifiedByUID = adminId;
            order.verifiedByName = adminName;
          }
        }
      }

      if (currentStatus === 'to-ship' || currentStatus === 'processing' || currentStatus === 'to-receive') {
        paymentVerified = true;
        if (!amountPaid || amountPaid === 0) {
          if (order.paymentType === 'deposit' || order.paymentType === 'downpayment' || order.paymentType === 'down' || order.paymentMethod === 'cash') {
            amountPaid = Math.floor(order.total * 0.3);
            remainingAmount = Math.max(0, order.total - amountPaid);
          } else {
            amountPaid = order.total;
            remainingAmount = 0;
          }
        }
      }

      if (currentStatus === 'completed' || currentStatus === 'delivered') {
        const isFullAdvance = order.paymentType === 'full' || order.paymentType === 'full_advance' || order.paymentOption === 'Full Payment' || order.paymentOption === 'full';
        if (currentStatus === 'completed' || isFullAdvance) {
          remainingAmount = 0;
          amountPaid = order.total;
        }
        paymentVerified = true;

        if (currentStatus === 'delivered') {
          if (order.isReplacement || order.replacementDelivery) {
            order.financialStatus = 'No Cash Collection Required';
            order.amountCollected = 0;
          } else if (order.paymentType === 'full' || order.paymentType === 'full_advance') {
            order.financialStatus = 'No Cash Collection Required';
            order.amountCollected = 0;
          } else {
            if (!order.financialStatus || order.financialStatus === 'Pending Turnover') {
              order.financialStatus = 'Pending Turnover';
              const isDown = order.paymentType === 'deposit' || order.paymentType === 'downpayment' || order.paymentType === 'down' || order.isPreOrder;
              const depositPaid = isDown ? Math.floor(order.total * 0.3) : (order.paymentMethod === 'gcash' ? order.total : 0);
              order.amountCollected = Math.max(0, order.total - depositPaid);
            }
          }
          order.collectedBy = changerName;
          order.collectedDate = now.toLocaleDateString();
          order.collectedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        }

        if (!stockDeducted) {
          // Physical deduction of stock from product inventory database
          const currentProducts = getProducts();
          if (order.items) {
            order.items.forEach(it => {
              const itId = it.product?.id || it.productId || it.id;
              if (itId) {
                const pIdx = currentProducts.findIndex(p => String(p.id) === String(itId));
                if (pIdx !== -1) {
                  const qty = Number(it.quantity || 0);
                  currentProducts[pIdx].stock = Math.max(0, Number(currentProducts[pIdx].stock || 0) - qty);
                  if (currentProducts[pIdx].currentStock !== undefined) {
                    currentProducts[pIdx].currentStock = Math.max(0, Number(currentProducts[pIdx].currentStock || 0) - qty);
                  }
                  
                  // Record to Inventory History
                  addInventoryHistory({
                    productName: currentProducts[pIdx].name,
                    quantityAdded: -qty,
                    remarks: `Fulfillment release for order #${order.id}`
                  }, true);
                }
              }
            });
          }
          saveProducts(currentProducts, true);
          stockDeducted = true;
        }

        // If this is the original order, we should update the reported issue status too!
        if (currentStatus === 'completed' && order.id === originalOrderId && order.reportedIssue) {
          order.reportedIssue.status = 'completed';
          order.reportedIssue.resolvedAt = now.toISOString();
        }
      }

      let cancelledAt = order.cancelledAt;
      if (currentStatus === 'cancelled') {
        cancelledAt = now.toISOString();
        const isRes = isReservationOrder(order);
        // CRITICAL: Reservations never deduct physical warehouse stock on placement, so cancelling a reservation must NOT add stock back to warehouse inventory!
        if (stockDeducted && !isRes) {
          const currentProducts = getProducts();
          if (order.items) {
            order.items.forEach(it => {
              if (it.isReservation) return; // Skip reservation items
              const itId = it.product?.id || it.productId || it.id;
              if (itId) {
                const pIdx = currentProducts.findIndex(p => String(p.id) === String(itId));
                if (pIdx !== -1) {
                  const qty = Number(it.quantity || 0);
                  if (qty <= 0) return;
                  currentProducts[pIdx].stock = Number(currentProducts[pIdx].stock || 0) + qty;
                  if (currentProducts[pIdx].currentStock !== undefined) {
                    currentProducts[pIdx].currentStock = Number(currentProducts[pIdx].currentStock || 0) + qty;
                  }
                  
                  // Record to Inventory History
                  addInventoryHistory({
                    productName: currentProducts[pIdx].name,
                    quantityAdded: qty,
                    remarks: `Returned/Restored from cancelled order #${order.id}`
                  }, true);
                }
              }
            });
          }
          saveProducts(currentProducts, true);
          stockDeducted = false;
        }
      }

      // Send notifications with precise metadata mapping
      const isRep = order.isReplacement;
      let notificationTitle = isRep ? 'Replacement Update' : 'Order Update';
      let notificationMessage = isRep 
        ? `Your Replacement Order #${order.id} status is now ${currentStatus}.` 
        : `Your Order #${order.id} status is now ${currentStatus}.`;
      let notifType = 'order';

      if (currentStatus === 'to-ship') {
        notificationTitle = isRep ? 'Replacement Preparing' : 'Order Approved';
        notificationMessage = isRep 
          ? `Replacement Order #${order.id} is now Preparing.` 
          : `Your order #${order.id} has been approved and is now being prepared.`;
        notifType = 'order';
      } else if (currentStatus === 'processing') {
        notificationTitle = isRep ? 'Replacement Being Prepared' : 'Order Being Prepared';
        notificationMessage = isRep 
          ? `Our staff is now preparing your Replacement Order #${order.id}.` 
          : `Our staff is now preparing your order #${order.id}.`;
        notifType = 'order';
      } else if (currentStatus === 'to-receive') {
        const isPickup = (order.deliveryOption || '').toLowerCase() === 'pickup';
        notificationTitle = isPickup ? 'Ready for Pickup' : 'Out for Delivery';
        notificationMessage = isPickup 
          ? `Your order #${order.id} is now ready for pickup.` 
          : `Your order #${order.id} is now on its way (Out for Delivery).`;
        notifType = isPickup ? 'reservation' : 'order';
      } else if (currentStatus === 'delivered') {
        notificationTitle = 'Order Delivered';
        notificationMessage = `Your order #${order.id} has been successfully delivered. Please inspect your items. If everything is correct, tap Mark as Completed. If you notice any issue, tap Report an Issue within 48 hours.`;
        notifType = 'order';
      } else if (currentStatus === 'completed') {
        notificationTitle = 'Order Completed';
        notificationMessage = isRep 
          ? `Your Replacement Order #${order.id} has been completed. Thank you for choosing us!` 
          : `Your order #${order.id} has been completed. Thank you for purchasing from us!`;
        notifType = 'completed';
      } else if (currentStatus === 'cancelled') {
        const isClientAction = !getCurrentAdmin();
        if (isClientAction) {
          // Send to Admin/Staff
          addNotification(
            'admin',
            'Customer Cancelled Order',
            `Customer ${order.fullName} cancelled Order #${order.id}.`,
            { role: 'admin', type: 'order' }
          );
        } else {
          // Send to Customer
          notificationTitle = isRep ? 'Replacement Cancelled' : 'Order Rejected';
          notificationMessage = isRep 
            ? `Your Replacement Order #${order.id} has been cancelled.` 
            : `Your order #${order.id} has been rejected. Reason: ${historyNote || 'Cancelled by admin'}.`;
          notifType = 'issue';
        }
      }

      // Only notify customer if it wasn't a customer cancellation (since customer knows they cancelled it themselves)
      const isClientCancellation = currentStatus === 'cancelled' && !getCurrentAdmin();
      if (!isClientCancellation) {
        const isResItem = Boolean(order.isPreOrder || (order.items && order.items.some(i => i.isReservation)));
        addNotification(
          order.userId || order.customerId || '',
          notificationTitle,
          notificationMessage,
          { 
            role: 'customer', 
            type: isResItem ? 'reservation' : notifType, 
            reservationId: isResItem ? order.id : undefined,
            orderId: isResItem ? undefined : order.id 
          }
        );
      }

      // If original order is completed, notify about it as well
      if (order.id === originalOrderId) {
        addNotification(
          order.userId || order.customerId || '',
          'Issue Report Completed',
          `Your delivery issue claim for Order #${order.id} has been fully completed and resolved with the fulfillment of Replacement Order #${orderId}.`,
          { role: 'customer', type: 'order', orderId: order.id }
        );
      }

      const placeholders = ['n/a', 'unknown', 'staff', 'staff name', 'admin', 'system', 'system admin', 'admin (system)', 'administrator', ''];
      const hasStaff = order.staffName && !placeholders.includes(String(order.staffName).trim().toLowerCase());
      const hasAssigned = order.assignedStaff && !placeholders.includes(String(order.assignedStaff).trim().toLowerCase());

      const finalStaffName = hasStaff ? order.staffName : (admin ? changerName : (order.staffName || ''));
      const finalAssignedStaff = hasAssigned ? order.assignedStaff : (admin ? changerName : (order.assignedStaff || ''));

      const cancellationFields = currentStatus === 'cancelled' ? {
        refundStatus: extraFields.refundStatus || order.refundStatus || 'No Refund Needed',
        refundAmount: extraFields.refundAmount !== undefined ? extraFields.refundAmount : (order.refundAmount !== undefined ? order.refundAmount : 0),
        refundReason: extraFields.refundReason || order.refundReason || '',
        originalAmountPaid: extraFields.originalAmountPaid !== undefined ? extraFields.originalAmountPaid : (order.originalAmountPaid !== undefined ? order.originalAmountPaid : (order.amountPaid || 0)),
        amountPaidBeforeCancellation: extraFields.amountPaidBeforeCancellation !== undefined ? extraFields.amountPaidBeforeCancellation : (order.amountPaidBeforeCancellation !== undefined ? order.amountPaidBeforeCancellation : (order.amountPaid || 0)),
        ...extraFields
      } : {};

      return {
        ...order,
        status: currentStatus,
        paymentVerified,
        remainingAmount,
        amountPaid,
        stockDeducted,
        consumedFromStock: currentStatus === 'cancelled' ? 0 : order.consumedFromStock,
        cancelledAt,
        cancelledBy: currentStatus === 'cancelled' ? (getCurrentAdmin() ? 'Admin' : 'Customer') : order.cancelledBy,
        cancellationDate: currentStatus === 'cancelled' ? now.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : order.cancellationDate,
        cancellationReason: currentStatus === 'cancelled' ? (historyNote || 'Cancelled by customer') : order.cancellationReason,
        staffName: finalStaffName,
        assignedStaff: finalAssignedStaff,
        statusHistory: [...(order.statusHistory || []), historyItem],
        ...cancellationFields
      };
    }
    return order;
  });

  const updatedOrderObj = updated.find(o => String(o.id) === String(orderId));
  if (updatedOrderObj) {
    registerPendingOrderWrite(updatedOrderObj.id, updatedOrderObj);
    saveOrders(updated, { colName: 'orders', docId: updatedOrderObj.id, docData: updatedOrderObj });
    saveFirestoreDoc('orders', updatedOrderObj.id, updatedOrderObj).catch(() => {});
  } else {
    saveOrders(updated);
  }
  if (originalOrderId) {
    const origOrderObj = updated.find(o => String(o.id) === String(originalOrderId));
    if (origOrderObj) {
      registerPendingOrderWrite(origOrderObj.id, origOrderObj);
      saveFirestoreDoc('orders', origOrderObj.id, origOrderObj).catch(() => {});
    }
  }

  // Synchronize with 'aurora-issue-reports' to mark completed
  if (isTargetReplacementAndCompleted && originalOrderId) {
    const issueReports = JSON.parse(localStorage.getItem('aurora-issue-reports') || '[]');
    const repIndex = issueReports.findIndex(r => r.orderId === originalOrderId);
    if (repIndex !== -1) {
      issueReports[repIndex].status = 'completed';
      issueReports[repIndex].resolvedAt = now.toISOString();
      localStorage.setItem('aurora-issue-reports', JSON.stringify(issueReports));
    }
  }
}

export function verifyPayment(orderId, approveBool, reason = 'Incorrect payment details') {
  if (approveBool) {
    updateOrderStatus(orderId, 'to-ship', 'Downpayment verified by admin');
    addActivityLog('Payments', `Approved and verified payment for Order Ticket #${orderId}`, `Order #${orderId}`);
    
    // Also trigger Customer "💳 Payment Verified" notification
    const orders = getOrders();
    const order = orders.find(o => o.id === orderId);
    if (order) {
      const isRes = Boolean(order.isPreOrder || (order.items && order.items.some(i => i.isReservation)));
      addNotification(
        order.userId || order.customerId || '',
        '💳 Payment Verified',
        isRes ? `Your payment for Reservation #${order.id} has been verified.` : `Your payment for Order #${order.id} has been verified.`,
        { role: 'customer', type: isRes ? 'reservation' : 'order', reservationId: isRes ? order.id : undefined, orderId: isRes ? undefined : order.id }
      );
    }
  } else {
    // Instead of cancelling, we keep it as 'to-pay' but mark payment as rejected so they can re-upload
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      const order = orders[idx];
      const nowIso = new Date().toISOString();
      const deadlineIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      order.status = 'to-pay';
      order.paymentVerified = false;
      order.paymentRejected = true;
      order.paymentStatus = 'rejected';
      order.hasCorrectedProof = false;
      order.paymentReuploadedAt = null;
      order.autoCancelledDueToRejectionDeadline = false;
      order.paymentRejectionReason = reason;
      order.paymentRejectedAt = nowIso;
      order.reuploadRequestedAt = nowIso;
      order.reuploadDeadline = deadlineIso;
      order.updatedAt = nowIso;
      
      const historyItem = {
        id: 'hist-pay-decline-' + Date.now(),
        status: 'Payment Pending',
        changedBy: 'Admin (System)',
        changedAt: new Date().toLocaleString(),
        note: `❌ Payment verification failed: ${reason}. Awaiting re-upload.`
      };
      order.statusHistory = [...(order.statusHistory || []), historyItem];
      orders[idx] = order;
      saveOrders(orders, { colName: 'orders', docId: String(order.id), docData: order });
      try {
        saveFirestoreDoc('orders', String(order.id), order);
      } catch (e) {}

      // Trigger Customer "⚠ Payment Verification Failed" notification
      addNotification(
        order.userId || order.customerId || '',
        '⚠ Payment Verification Failed',
        'Your payment proof was rejected. Please upload a new payment receipt.',
        { role: 'customer', type: 'order', orderId: order.id, scrollPayment: 1 }
      );

      addActivityLog('Payments', `Declined GCash payment for Order Ticket #${orderId}. Reason: ${reason}`, `Order #${orderId}`);
    }
  }
}

export function cancelOrder(orderId) {
  const user = getCurrentUser();
  const orders = getOrders();
  const o = orders.find(ord => ord.id === orderId);
  if (o && user && (
    o.customerEmail === user.email || 
    o.ownerEmail === user.email || 
    (o.userId && String(o.userId) === String(user.id)) || 
    (o.customerId && String(o.customerId) === String(user.id))
  )) {
    const isRes = isReservationOrder(o);

    // Step 1: Customer cancels a normal order
    if (!isRes) {
      // 1. Capture actual paid amount BEFORE cancellation logic modifies anything
      let actualPaid = 0;
      if (o.amountPaid !== undefined && o.amountPaid !== null && !isNaN(Number(o.amountPaid)) && Number(o.amountPaid) > 0) {
        actualPaid = Number(o.amountPaid);
      } else if (o.depositAmount !== undefined && o.depositAmount !== null && !isNaN(Number(o.depositAmount)) && Number(o.depositAmount) > 0) {
        actualPaid = Number(o.depositAmount);
      } else if (o.originalAmountPaid !== undefined && o.originalAmountPaid !== null && !isNaN(Number(o.originalAmountPaid)) && Number(o.originalAmountPaid) > 0) {
        actualPaid = Number(o.originalAmountPaid);
      } else if (o.amountPaidBeforeCancellation !== undefined && o.amountPaidBeforeCancellation !== null && !isNaN(Number(o.amountPaidBeforeCancellation)) && Number(o.amountPaidBeforeCancellation) > 0) {
        actualPaid = Number(o.amountPaidBeforeCancellation);
      } else if (o.amountCollected !== undefined && o.amountCollected !== null && !isNaN(Number(o.amountCollected)) && Number(o.amountCollected) > 0) {
        actualPaid = Number(o.amountCollected);
      }

      // Detect full payment vs down payment
      const pType = String(o.paymentType || '').toLowerCase();
      const pOpt = String(o.paymentOption || '').toLowerCase();
      const isExplicitDown = pType === 'deposit' || pType === 'downpayment' || pType === 'down' || pOpt.includes('down') || pOpt.includes('deposit') || pOpt.includes('30%');
      const hasRemainingBalance = (o.remainingAmount !== undefined && Number(o.remainingAmount) > 0) || (o.remainingBalance !== undefined && Number(o.remainingBalance) > 0);
      const isExplicitFull = pType === 'full' || pType === 'full_advance' || pType === 'full payment' || pOpt === 'full payment' || pOpt === 'full' || o.financialStatus === 'No Cash Collection Required';
      const tot = Number(o.total || o.totalPrice || o.totalBill || 0);
      const isFull = actualPaid > 0 && !isExplicitDown && !hasRemainingBalance && (isExplicitFull || (tot > 0 && actualPaid >= tot));

      const formattedAmount = Number(actualPaid || 0).toLocaleString(undefined, {
        minimumFractionDigits: Number.isInteger(actualPaid) ? 0 : 2,
        maximumFractionDigits: 2
      });

      if (isFull && actualPaid > 0) {
        // Customer paid in full:
        // refundStatus = "Refund Information Needed"
        // refundAmount = original actual amount paid
        // refundReason = "Customer cancelled after full payment"
        const extraFields = {
          refundStatus: 'Refund Information Needed',
          refundAmount: actualPaid,
          refundReason: 'Customer cancelled after full payment',
          refundRequestedAt: new Date().toISOString(),
          originalAmountPaid: actualPaid,
          amountPaidBeforeCancellation: actualPaid
        };

        updateOrderStatus(orderId, 'cancelled', 'Cancelled by customer', extraFields);

        // Customer notification
        addNotification(
          o.userId || o.customerId || user.id || '',
          'Order Cancelled — Refund Required',
          `Your order #${orderId} has been cancelled as requested.\n\nYou are due a refund of ₱${formattedAmount}.\n\nPlease submit your GCash or bank details so the store can process your refund.`,
          { role: 'customer', type: 'order', orderId: orderId }
        );

        // Admin notification
        addNotification(
          'admin',
          'Refund Required',
          `Order #${orderId} was cancelled by the customer after full payment.\n\nRefund amount: ₱${formattedAmount}.\n\nPlease review the order and wait for the customer's refund details.`,
          { role: 'admin', type: 'order', orderId: orderId }
        );
      } else if (actualPaid > 0) {
        // Down payment cancellation:
        // refundStatus = "No Refund Needed"
        // refundAmount = 0
        const extraFields = {
          refundStatus: 'No Refund Needed',
          refundAmount: 0,
          refundReason: 'Customer cancelled order (non-refundable per store cancellation policy)',
          originalAmountPaid: actualPaid,
          amountPaidBeforeCancellation: actualPaid
        };

        updateOrderStatus(orderId, 'cancelled', 'Cancelled by customer', extraFields);

        // Customer notification
        addNotification(
          o.userId || o.customerId || user.id || '',
          'Order Cancelled',
          `Your order #${orderId} has been cancelled as requested.\n\nUnder our store cancellation policy, the down payment is not refundable when the customer chooses to cancel.`,
          { role: 'customer', type: 'order', orderId: orderId }
        );
      } else {
        // Unpaid order cancellation:
        const extraFields = {
          refundStatus: 'No Refund Needed',
          refundAmount: 0,
          refundReason: 'Customer cancelled unpaid order',
          originalAmountPaid: 0,
          amountPaidBeforeCancellation: 0
        };

        updateOrderStatus(orderId, 'cancelled', 'Cancelled by customer', extraFields);

        // Customer notification
        addNotification(
          o.userId || o.customerId || user.id || '',
          'Order Cancelled',
          `Your order #${orderId} has been cancelled as requested.\n\nNo refund is needed because no payment was made.`,
          { role: 'customer', type: 'order', orderId: orderId }
        );
      }
    } else {
      // Reservations preserved untouched for later step
      updateOrderStatus(orderId, 'cancelled', 'Cancelled by customer');
    }
  } else {
    throw new Error("Unauthorized action");
  }
}

export function submitCustomerRefundDetails(orderId, details) {
  const user = getCurrentUser();
  const orders = getOrders();
  const order = orders.find(ord => String(ord.id) === String(orderId));
  if (!order) throw new Error("Order not found");
  if (!user || (!isCustomerOrderOwner(order, user) && 
      order.customerEmail !== user.email && 
      order.ownerEmail !== user.email && 
      String(order.userId) !== String(user.id) && 
      String(order.customerId) !== String(user.id))) {
    throw new Error("Unauthorized action");
  }

  const now = new Date().toISOString();
  const updated = orders.map(o => {
    if (String(o.id) === String(orderId)) {
      return {
        ...o,
        refundStatus: 'Refund Information Submitted',
        refundSubmittedAt: now,
        refundMethod: details.method || (details.bankName ? 'Bank' : 'GCash'),
        refundAccountName: details.accountName || '',
        refundAccountNumber: details.accountNumber || details.gcashNumber || '',
        refundGcashNumber: details.gcashNumber || (details.method === 'GCash' ? details.accountNumber : ''),
        refundBankName: details.bankName || ''
      };
    }
    return o;
  });

  const updatedOrder = updated.find(o => String(o.id) === String(orderId));
  registerPendingOrderWrite(updatedOrder.id, updatedOrder);
  saveOrders(updated, { colName: 'orders', docId: updatedOrder.id, docData: updatedOrder });
  saveFirestoreDoc('orders', updatedOrder.id, updatedOrder).catch(() => {});

  // Customer notification
  addNotification(
    order.userId || order.customerId || user.id || '',
    'Refund Details Submitted',
    `Your refund details for order #${orderId} have been submitted.\n\nThe store will review them and process your refund.`,
    { role: 'customer', type: 'order', orderId: orderId }
  );

  // Admin notification
  const refundAmtStr = Number(order.refundAmount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  addNotification(
    'admin',
    'Refund Details Submitted',
    `Customer ${order.fullName || 'Customer'} submitted refund details for Order #${orderId}.\n\nRefund amount: ₱${refundAmtStr}.\n\nPlease review the details and process the refund.`,
    { role: 'admin', type: 'order', orderId: orderId }
  );

  return updatedOrder;
}

export function updateOrderRefundStatus(orderId, nextRefundStatus, adminInfo = {}) {
  const admin = getCurrentAdmin();
  const changerName = adminInfo.name || (admin ? (admin.name || admin.email || 'Admin') : 'Admin');
  const now = new Date().toISOString();
  const orders = getOrders();
  const order = orders.find(ord => String(ord.id) === String(orderId));
  if (!order) throw new Error("Order not found");

  const updated = orders.map(o => {
    if (String(o.id) === String(orderId)) {
      const patch = {
        refundStatus: nextRefundStatus
      };
      if (nextRefundStatus === 'Refunded') {
        patch.refundProcessedAt = now;
        patch.refundProcessedBy = changerName;
      }
      return {
        ...o,
        ...patch
      };
    }
    return o;
  });

  const updatedOrder = updated.find(o => String(o.id) === String(orderId));
  registerPendingOrderWrite(updatedOrder.id, updatedOrder);
  saveOrders(updated, { colName: 'orders', docId: updatedOrder.id, docData: updatedOrder });
  saveFirestoreDoc('orders', updatedOrder.id, updatedOrder).catch(() => {});

  if (nextRefundStatus === 'Refunded') {
    const refundAmtStr = Number(order.refundAmount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    // Customer notification
    addNotification(
      order.userId || order.customerId || '',
      'Refund Completed',
      `Your refund of ₱${refundAmtStr} for Order #${orderId} has been processed.`,
      { role: 'customer', type: 'order', orderId: orderId }
    );
  }

  return updatedOrder;
}

export function processOrderStockAndSplitIfNeeded(order) {
  if (!order) return order;
  if (order.stockDeducted) {
    return { finalOrder: order, createdReservation: null };
  }

  const products = getProducts();
  let createdReservation = null;
  const affectedProductIds = new Set();

  if (order.items && order.items.length > 0) {
    const updatedItems = [];

    order.items.forEach(item => {
      const p = products.find(prod => String(prod.id) === String(item.product?.id || item.productId));
      if (!p) {
        updatedItems.push(item);
        return;
      }

      const currentPhysical = p.currentStock !== undefined ? p.currentStock : p.stock;
      const reserved = p.reservedStock !== undefined ? p.reservedStock : 0;

      // Exclude this order's own reserved quantity when calculating available stock for order processing
      let selfReservedQty = 0;
      const allOrdersInDb = getOrders();
      const orderInDb = allOrdersInDb.find(o => String(o.id) === String(order.id));
      if (orderInDb && orderInDb.items) {
        orderInDb.items.forEach(it => {
          if (String(it.product?.id || it.productId) === String(p.id)) {
            const isRes = Boolean(orderInDb.isPreOrder || it.isReservation);
            let qty = Number(it.quantity || 0);
            if (isRes) {
              if (orderInDb.allocatedQuantity !== undefined) {
                qty = Number(orderInDb.allocatedQuantity || 0);
              } else if (orderInDb.status === 'ready_for_processing' || orderInDb.status === 'ready' || orderInDb.status === 'processing') {
                qty = Number(it.quantity || 0);
              } else {
                qty = 0;
              }
            }
            selfReservedQty += qty;
          }
        });
      }

      const reservedOther = Math.max(0, reserved - selfReservedQty);
      // Calculate stock that is truly available for a NEW normal order.
//
// currentPhysical = actual physical warehouse stock
// reservedOther = reservation quantity still waiting for allocation
// allocatedOther = reservation quantity already allocated to
//                 existing customers and therefore unavailable
//                 for a new normal order

let allocatedOther = 0;

const allOrdersForAllocation = getOrders();

allOrdersForAllocation.forEach(existingOrder => {
  if (!existingOrder || existingOrder.id === order.id) return;

  const status = String(existingOrder.status || '')
    .toLowerCase()
    .replace(/_/g, '-');

  const isReservation =
    existingOrder.isPreOrder ||
    (existingOrder.items &&
      existingOrder.items.some(item => item.isReservation));

  if (!isReservation) return;

  if (
    status === 'cancelled' ||
    status === 'completed' ||
    status === 'delivered'
  ) {
    return;
  }

  // Only count quantities that have already been allocated
  // to an existing reservation.
  if (
    status === 'to-ship' ||
    status === 'to-receive' ||
    existingOrder.stockAllocated === true ||
    existingOrder.restockAllocatedAt ||
    existingOrder.actualRestockDate ||
    (
      existingOrder.allocatedStock &&
      !String(existingOrder.allocatedStock)
        .toLowerCase()
        .includes('pending')
    )
  ) {
    const allocatedQty = Number(existingOrder.allocatedQuantity || 0);

    if (allocatedQty > 0 && existingOrder.items) {
      existingOrder.items.forEach(existingItem => {
        const existingProductId = String(
          existingItem.product?.id ||
          existingItem.productId ||
          ''
        );

        if (existingProductId === String(p.id)) {
          allocatedOther += Math.min(
            allocatedQty,
            Number(existingItem.quantity || 0)
          );
        }
      });
    }
  }
});

const availStock = Math.max(
  0,
  currentPhysical - reservedOther - allocatedOther
);
      const requestedQty = Number(item.quantity || 0);

      const isOriginallyReservation = Boolean(order.isPreOrder || item.isReservation || (order.id && String(order.id).toLowerCase().startsWith('res')));

      if (requestedQty > availStock) {
        if (availStock > 0) {
          // PARTIAL ORDER: Approve availStock, reserve (requestedQty - availStock)
          const approvedQty = availStock;
          const remainingQty = requestedQty - availStock;

          // Deduct approved stock from physical warehouse inventory so stock accurately reflects 0 (or remaining)
          p.stock = Math.max(0, Number(p.stock || 0) - approvedQty);
          if (p.currentStock !== undefined) {
            p.currentStock = Math.max(0, Number(p.currentStock || 0) - approvedQty);
          }
          order.stockDeducted = true;
          order.consumedFromStock = approvedQty;
          order.consumedAt = order.createdAt || new Date().toISOString();
          order.partialApprovedQty = approvedQty;
          order.partialReservedQty = remainingQty;
          affectedProductIds.add(String(p.id));
          addInventoryHistory({
            productId: String(p.id),
            productName: p.name,
            quantityAdded: -approvedQty,
            remarks: `Order placed (partial split): #${order.id}`
          }, true);

          // Main order receives available quantity
          const approvedItem = { ...item, quantity: approvedQty, isReservation: false };
          updatedItems.push(approvedItem);

          let estDate = null;
          if (p.restockDate) {
            const rd = new Date(p.restockDate);
            if (!isNaN(rd.getTime()) && rd >= new Date()) {
              estDate = p.restockDate;
            }
          }
          if (!estDate && typeof getRestockPrediction === 'function') {
            const pred = getRestockPrediction(p.id);
            if (pred && pred !== 'Unknown') {
              const pd = new Date(pred);
              if (!isNaN(pd.getTime()) && pd >= new Date()) {
                estDate = pred;
              }
            }
          }

          const itemPrice = item.product?.price || item.price || 0;
          const resTotal = remainingQty * itemPrice;

          // Compute dynamic queue position for createdReservation
          const allOrders = getOrders();
          const pId = String(p.id);
          const existingResForProd = allOrders.filter(o => 
            (o.isPreOrder || (o.items && o.items.some(it => it.isReservation))) &&
            o.status !== 'cancelled' && o.status !== 'completed' &&
            o.items && o.items.some(it => String(it.product?.id || it.productId) === pId)
          );
          const dynQueuePos = existingResForProd.length + 1;

          // Create linked reservation order
          createdReservation = {
            id: 'RES-' + Math.floor(100000 + Math.random() * 900000),
            linkedOrderId: order.id,
            originalOrderId: order.id,
            isPreOrder: true,
            status: 'pre-order',
            createdAt: new Date().toISOString(),
            userId: order.userId || order.customerId || '',
            customerId: order.customerId || order.userId || '',
            fullName: order.fullName || '',
            phone: order.phone || '',
            email: order.email || order.customerEmail || '',
            deliveryOption: order.deliveryOption || 'delivery',
            address: order.address || '',
            pickupNotes: order.pickupNotes || '',
            paymentMethod: order.paymentMethod || 'gcash',
            paymentType: order.paymentType || 'deposit',
            paymentProof: '',
            paymentProofDataUrl: '',
            paymentVerified: false,
            items: [{
              ...item,
              quantity: remainingQty,
              isReservation: true
            }],
            total: resTotal,
            amountPaid: 0,
            remainingAmount: resTotal,
            queuePosition: dynQueuePos,
            estimatedRestockDate: estDate,
            estimatedAvailability: estDate,
            estimatedFulfillmentDate: null,
            statusHistory: [{
              id: 'hist-res-' + Date.now(),
              status: 'Waiting for Stock',
              changedBy: 'System Auto-Split',
              changedAt: new Date().toLocaleString(),
              note: `Partial order: Approved ${approvedQty} sacks for processing. Created reservation for remaining ${remainingQty} sacks linked to Order Ticket #${order.id}.`
            }]
          };

          const initialSplitEst = getEstimatedArrivalDate(createdReservation);
          if (initialSplitEst && initialSplitEst !== 'Waiting for Restock' && initialSplitEst !== 'Not yet scheduled') {
            createdReservation.estimatedFulfillmentDate = initialSplitEst;
          }

          order.linkedReservationId = createdReservation.id;
          order.partialApprovedQty = approvedQty;
          order.partialReservedQty = remainingQty;
          order.isPreOrder = false;

          // Send notification to customer explaining split & restock date
          addNotification(
            order.userId || order.customerId || '',
            '⚡ Partial Order Approved & Reservation Created',
            `Your order #${order.id} requested ${requestedQty} sacks, but only ${approvedQty} sacks were in stock. ${approvedQty} sacks have been approved for processing, and a reservation for the remaining ${remainingQty} sacks has been automatically created (Reservation Ticket #${createdReservation.id}, Queue Position #${dynQueuePos}). Estimated restock: ${estDate || 'Waiting for Restock'}.`,
            { role: 'customer', type: 'reservation', orderId: order.id, reservationId: createdReservation.id }
          );
        } else if (isOriginallyReservation || availStock === 0) {
          // Entire order is out of stock -> keep as reservation
          order.isPreOrder = true;
          order.status = 'pre-order';
          order.stockDeducted = false;
          let estDate = null;
          if (p.restockDate) {
            const rd = new Date(p.restockDate);
            if (!isNaN(rd.getTime()) && rd >= new Date()) {
              estDate = p.restockDate;
            }
          }
          if (!estDate && typeof getRestockPrediction === 'function') {
            const pred = getRestockPrediction(p.id);
            if (pred && pred !== 'Unknown') {
              const pd = new Date(pred);
              if (!isNaN(pd.getTime()) && pd >= new Date()) {
                estDate = pred;
              }
            }
          }
          order.estimatedRestockDate = estDate;

          const initialPreOrderEst = getEstimatedArrivalDate(order);
          if (initialPreOrderEst && initialPreOrderEst !== 'Waiting for Restock' && initialPreOrderEst !== 'Not yet scheduled') {
            order.estimatedFulfillmentDate = initialPreOrderEst;
          } else {
            order.estimatedFulfillmentDate = null;
          }

          const allOrders = getOrders();
          const pId = String(p.id);
          const existingResForProd = allOrders.filter(o => 
            (o.isPreOrder || (o.items && o.items.some(it => it.isReservation))) &&
            o.status !== 'cancelled' && o.status !== 'completed' &&
            o.items && o.items.some(it => String(it.product?.id || it.productId) === pId)
          );
          order.queuePosition = existingResForProd.length + 1;

          addNotification(
            order.userId || order.customerId || '',
            '⌛ Order Converted to Reservation',
            `Your order #${order.id} for ${requestedQty} sacks was placed as a reservation because this item is currently out of stock. Estimated restock: ${estDate || 'Waiting for Restock'}.`,
            { role: 'customer', type: 'reservation', orderId: order.id }
          );
          updatedItems.push({ ...item, isReservation: true });
        } else {
          // Normal order: preserve normal order structure and do not convert into a reservation
          order.isPreOrder = false;
          updatedItems.push({ ...item, isReservation: false });
        }
      } else {
        if (!isOriginallyReservation) {
          order.isPreOrder = false;
          // Deduct normal order items from physical warehouse inventory immediately upon placement
          p.stock = Math.max(0, Number(p.stock || 0) - requestedQty);
          if (p.currentStock !== undefined) {
            p.currentStock = Math.max(0, Number(p.currentStock || 0) - requestedQty);
          }
          order.stockDeducted = true;
          order.consumedFromStock = requestedQty;
          order.consumedAt = order.createdAt || new Date().toISOString();
          affectedProductIds.add(String(p.id));
          addInventoryHistory({
            productId: String(p.id),
            productName: p.name,
            quantityAdded: -requestedQty,
            remarks: `Order placed: #${order.id}`
          }, true);
        }
        updatedItems.push({ ...item, isReservation: false });
      }
    });

    order.items = updatedItems;

    if (createdReservation) {
      const newSubtotal = updatedItems.reduce((acc, it) => acc + (it.product?.price || it.price || 0) * it.quantity, 0);
      const deliveryFee = order.deliveryOption === 'delivery' ? 80 : 0;
      order.total = newSubtotal + deliveryFee;

      // Available stock order payment calculation
      if (order.paymentType === 'full' || order.paymentMethod === 'gcash') {
        order.amountPaid = order.total;
        order.remainingAmount = 0;
      } else {
        order.amountPaid = Math.floor(order.total * 0.3);
        order.remainingAmount = Math.max(0, order.total - order.amountPaid);
      }

      // Reservation portion has 0 down payment at checkout
      createdReservation.amountPaid = 0;
      createdReservation.remainingAmount = createdReservation.total || 0;
      createdReservation.paymentMethod = 'none';
      createdReservation.paymentType = 'none';
      createdReservation.paymentProof = '';
      createdReservation.paymentProofDataUrl = '';
      createdReservation.paymentVerified = false;
      createdReservation.stockDeducted = false;
    } else if (order.isPreOrder) {
      const newSubtotal = updatedItems.reduce((acc, it) => acc + (it.product?.price || it.price || 0) * it.quantity, 0);
      order.total = newSubtotal;
      order.amountPaid = 0;
      order.remainingAmount = newSubtotal;
      order.paymentMethod = 'none';
      order.paymentType = 'none';
      order.paymentProof = '';
      order.paymentProofDataUrl = '';
      order.paymentVerified = false;
      order.stockDeducted = false;
    } else if (!order.isPreOrder) {
      const newSubtotal = updatedItems.reduce((acc, it) => acc + (it.product?.price || it.price || 0) * it.quantity, 0);
      const deliveryFee = order.deliveryOption === 'delivery' ? 80 : 0;
      order.total = newSubtotal + deliveryFee;
      if (order.paymentType === 'full' || order.paymentMethod === 'gcash') {
        order.amountPaid = order.total;
        order.remainingAmount = 0;
      } else {
        order.amountPaid = Math.floor(order.total * 0.3);
        order.remainingAmount = Math.max(0, order.total - order.amountPaid);
      }
    }
  }

  saveProducts(products, true);

  if (affectedProductIds.size > 0 && typeof saveFirestoreDoc === 'function') {
    affectedProductIds.forEach(pId => {
      const prod = products.find(p => String(p.id) === String(pId));
      if (prod) {
        const { reservedStock, availableStock, ...rest } = prod;
        const physicalStock = prod.currentStock !== undefined ? Number(prod.currentStock) : Number(prod.stock);
        saveFirestoreDoc('products', String(pId), {
          ...rest,
          stock: physicalStock,
          currentStock: physicalStock
        }).catch(err => {
          console.warn(`[FIREBASE] Failed targeted stock persist for product ${pId}:`, err);
        });
      }
    });
  }

  return { finalOrder: order, createdReservation };
}

export function allocateStockToReservations(targetProductId = null, restockOptions = null) {
  // Authoritative active dataset: never operate on stale or test products or stale reservations
  const products = (JSON.parse(
    localStorage.getItem('aurora-products') || '[]'
  ) || []).filter(p => p && !isStaleProduct(p) && !p.isArchived && !p.archived);
  const orders = getOrders().filter(o => !isStaleOrderOrReservation(o));

  let changed = false;
  const modifiedOrderIds = new Set();

  products.forEach(product => {
    const productId = String(product.id);
    if (targetProductId && String(targetProductId) !== productId) {
      return;
    }

    // Get all active reservations for this specific product variety
   const reservations = orders.filter(o => {
  if (
    !o ||
    (!o.isPreOrder && !(o.items && o.items.some(it => it.isReservation)))
  ) {
    return false;
  }

  if (
    o.status === 'cancelled' ||
    o.status === 'completed' ||
    o.status === 'processing' ||
    o.status === 'to-ship' ||
    o.status === 'to-receive' ||
    o.status === 'delivered'
  ) {
    return false;
  }

  if (!Array.isArray(o.items)) {
    return false;
  }

  return o.items.some(it => {
    if (!it) return false;

    const itemProductId = String(
      it.product?.id ??
      it.productId ??
      (typeof it.product === 'string' || typeof it.product === 'number'
        ? it.product
        : '') ??
      ''
    ).trim();

    // Primary match: exact product ID
    if (itemProductId && itemProductId === productId) {
      return true;
    }

    // Fallback: use the existing product-variety matcher
    // when the saved reservation product reference is incomplete.
    try {
      return matchesProductVariety(
        { id: productId, name: product.name },
        it.product || it,
        products
      );
    } catch (e) {
      return false;
    }
  });
});

    // Sort chronologically (oldest first) to ensure strict FCFS
    reservations.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // 1. Total physical warehouse stock (e.g., 26 sacks after restock)
  // RAW physical warehouse stock.
// This is the stock after the admin's actual restock action.
const totalPhysical = Math.max(
  0,
  Number(product.stock || 0)
);
    // 2. Stock reserved for active regular (non-reservation) orders that haven't been deducted yet
    let regularOrdersReserved = 0;
    orders.forEach(o => {
      if (!o.isPreOrder && o.status !== 'cancelled' && o.status !== 'completed' && !isOrderStockDeducted(o)) {
        if (o.items) {
          o.items.forEach(it => {
            if (String(it.product?.id || it.productId) === productId && !it.isReservation) {
              const orderTime = o.createdAt ? new Date(o.createdAt).getTime() : 0;
              const restockTime = product.lastRestockAt ? new Date(product.lastRestockAt).getTime() : 0;
              if (restockTime > 0 && orderTime > 0 && orderTime < restockTime) {
                return;
              }
              regularOrdersReserved += Number(it.quantity || 0);
            }
          });
        }
      }
    });

    // 3. Previously allocated reservation quantity (allocated prior to the current restock event)
    let previouslyAllocatedToReservations = 0;
    reservations.forEach(o => {
      previouslyAllocatedToReservations += Number(o.allocatedQuantity || 0);
    });

    // 4. Remaining unallocated physical stock in warehouse available for new reservation allocations
    // e.g., totalPhysical (26) - regularOrdersReserved (0) - previouslyAllocatedToReservations (14) = 12 sacks
    let availableUnallocatedStock = Math.max(0, totalPhysical - regularOrdersReserved - previouslyAllocatedToReservations);

    // 5. Detect the actual restocked quantity entered by admin (e.g., exactly 15 sacks)
    let actualRestockedQty = 0;
    if (typeof restockOptions === 'number') {
      actualRestockedQty = restockOptions;
    } else if (restockOptions && typeof restockOptions === 'object') {
      actualRestockedQty = Number(restockOptions.actualRestockedQty || restockOptions.quantityAdded || 0);
    }

    // 6. Maximum newly available stock for additional reservation allocation from this restock:
    // When a restock occurs (actualRestockedQty > 0), newly allocated quantity can NEVER exceed
    // the remaining unallocated physical stock (e.g. 12 sacks), nor the actual restocked quantity.
    let remainingNewAllocationQuota = actualRestockedQty > 0
      ? Math.min(actualRestockedQty, availableUnallocatedStock)
      : availableUnallocatedStock;

    // Track how much is newly allocated during this specific run
    let newlyAllocatedThisRunTotal = 0;

    // Phase A: Perform strict FCFS stock allocation
    reservations.forEach((order, idx) => {
     const item = order.items.find(it => {
  if (!it) return false;

  const itemProductId = String(
    it.product?.id ??
    it.productId ??
    (typeof it.product === 'string' || typeof it.product === 'number'
      ? it.product
      : '') ??
    ''
  ).trim();

  if (itemProductId && itemProductId === productId) {
    return true;
  }

  try {
    return matchesProductVariety(
      { id: productId, name: product.name },
      it.product || it,
      products
    );
  } catch (e) {
    return false;
  }
});
      if (item) {
        const totalQtyNeeded = Number(item.quantity || 0);
        const prevAllocated = Number(order.allocatedQuantity || 0);
        const prevStatus = order.status;

        // Condition 1: Reservation Approval (Admin or Staff)
        const isApproved = order.adminApproved !== false && 
                           order.isApproved !== false && 
                           order.approvedByAdmin !== false;

        // Condition 2: Payment requirement satisfied
        const isPaymentSatisfied = order.paymentVerified === true ||
                                   order.paymentStatus === 'verified' ||
                                   order.paymentStatus === 'paid';

        // Check if customer uploaded payment proof awaiting verification
        const hasPaymentProof = hasValidReservationPaymentProof(order);

        const now = new Date();
        let isExpired = false;
        const resolvedDeadlineMs = getReservationPaymentDeadlineMs(order);
        if (
          resolvedDeadlineMs &&
          !isPaymentSatisfied &&
          !hasPaymentProof &&
          !order.paymentRejected
        ) {
          if (now.getTime() > resolvedDeadlineMs) {
            isExpired = true;
          }
        }

        let allocated = prevAllocated;
        let newStatus = order.status;

        if (isExpired) {
          // 48-hour payment window passed without payment -> Reservation automatically expires!
          const nowIso = now.toISOString();
          const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const formattedDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
          const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const authoritativeDeadlineIso = new Date(resolvedDeadlineMs).toISOString();
          const authoritativeAllocIso = new Date(resolvedDeadlineMs - (48 * 60 * 60 * 1000)).toISOString();

          newStatus = 'cancelled';
          allocated = 0;
          order.paymentDeadline = authoritativeDeadlineIso;
          order.notifiedForPayment = true;
          if (!order.stockAllocatedAt || new Date(order.stockAllocatedAt).getTime() > (resolvedDeadlineMs - 48 * 60 * 60 * 1000)) {
            order.stockAllocatedAt = authoritativeAllocIso;
          }
          order.status = 'cancelled';
          order.allocatedQuantity = 0;
          order.cancelledAt = nowIso;
          order.updatedAt = nowIso;
          order.cancelledBy = 'System Auto-Cancellation';
          order.cancellationDate = `${formattedDate}, ${formattedTime}`;
          order.cancellationReason = 'Automatically cancelled: Down payment was not submitted within the 48-hour payment deadline.';
          order.autoCancelledDueToPaymentDeadline = true;
          order.paymentVerified = false;
          order.refundStatus = 'No Refund Needed';
          order.refundAmount = 0;
          order.refundReason = 'Cancelled: 48-hour down payment deadline expired (no payment received)';

          if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
          const alreadyHasExpiredHist = order.statusHistory.some(
            h => h && String(h.status || '').toLowerCase() === 'cancelled (expired)'
          );
          if (!alreadyHasExpiredHist) {
            order.statusHistory = [
              ...order.statusHistory,
              {
                id: 'hist-exp-' + Date.now() + '-' + idx,
                status: 'Cancelled (Expired)',
                changedBy: 'System Auto-Cancellation',
                changedAt: `${formattedDate}, ${formattedTime}`,
                note: 'Reservation automatically expired because the 48-hour payment window elapsed without payment verification or receipt upload. Allocated stock has been released.'
              }
            ];
          }
          changed = true;
          modifiedOrderIds.add(order.id);
          registerPendingOrderWrite(order.id, order);

          // Release previously allocated stock back to available pool
          if (prevAllocated > 0) {
            availableUnallocatedStock += prevAllocated;
            remainingNewAllocationQuota += prevAllocated;
          }

          try {
            const existingLogs = getActivityLogs();
            const alreadyLogged = existingLogs.some(
              l => l && String(l.target || '') === `Reservation #${order.id}` && String(l.action || '').includes('automatically cancelled')
            );
            if (!alreadyLogged) {
              addActivityLog(
                'Reservations',
                `System automatically cancelled Reservation #${order.id} because the 48-hour down payment deadline expired without payment submission. Allocated stock (${prevAllocated} sacks) released.`,
                `Reservation #${order.id}`
              );
            }
          } catch (e) {}

          const custId = order.userId || order.customerId || '';
          if (custId) {
            addNotification(
              custId,
              '❌ Reservation Cancelled',
              'Your reservation was automatically cancelled because the 48-hour payment window elapsed without a payment upload. Allocated stock has been released to the next customer in line.',
              {
                role: 'customer',
                type: 'reservation',
                targetType: 'reservation',
                reservationId: String(order.id),
                orderId: String(order.id),
                targetId: String(order.id),
                tab: 'cancelled',
                eventKey: `res-cancelled-paydeadline-${order.id}`,
                notificationId: `notif-res-cancelled-paydeadline-${order.id}`
              }
            );
          }

          try {
            addNotification(
              'admin',
              'Auto-Cancellation: 48-Hour Deadline Expired',
              `Reservation #${order.id} (${order.fullName || 'Customer'}) was automatically cancelled because the 48-hour down payment deadline expired without payment submission.\n\nAllocated stock (${prevAllocated} sacks) has been released to the reservation queue.`,
              {
                role: 'admin',
                type: 'reservation',
                targetType: 'reservation',
                orderId: String(order.id),
                reservationId: String(order.id),
                targetId: String(order.id),
                isSystemAuto: true,
                eventKey: `admin-res-auto-cancel-paydeadline-${order.id}`,
                notificationId: `notif-admin-res-auto-cancel-paydeadline-${order.id}`
              }
            );
          } catch (e) {}
        } else {
          // Calculate how much MORE can be allocated to this reservation from available unallocated stock
          const remainingWaitingQty = Math.max(0, totalQtyNeeded - prevAllocated);

          let newlyAllocatedThisReservation = 0;

if (
  remainingWaitingQty > 0 &&
  remainingNewAllocationQuota > 0
) {
  // IMPORTANT:
  // Stock allocation is independent of payment verification.
  // Once a reservation is in the active FIFO queue,
  // newly restocked physical stock is automatically allocated
  // to it in queue order.
  newlyAllocatedThisReservation = Math.min(
    remainingNewAllocationQuota,
    remainingWaitingQty
  );

  remainingNewAllocationQuota -= newlyAllocatedThisReservation;
  availableUnallocatedStock -= newlyAllocatedThisReservation;
  newlyAllocatedThisRunTotal += newlyAllocatedThisReservation;
}

          allocated = prevAllocated + newlyAllocatedThisReservation;

          const isFullyAllocated = allocated >= totalQtyNeeded;

if (isApproved && isPaymentSatisfied && isFullyAllocated) {
  newStatus = 'ready_for_processing';
} else if (hasPaymentProof) {
  newStatus = 'payment_verification';
} else if (isApproved && isFullyAllocated) {

            if (!order.notifiedForPayment && !resolvedDeadlineMs) {
              order.notifiedForPayment = true;
              const deadlineDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
              order.paymentDeadline = deadlineDate.toISOString();
              order.updatedAt = new Date().toISOString();

              addNotification(
                order.userId || order.customerId || '',
                '📦 Reserved Rice Available — Down Payment Required',
                'Good news!\nYour reserved rice is now available.\nYour requested quantity has already been allocated exclusively for you.\nPlease upload your down payment within 48 hours to continue your reservation.\nFailure to pay within 48 hours will automatically cancel your reservation and release your allocated stock to the next customer in the reservation queue.',
                { role: 'customer', type: 'reservation', reservationId: order.id }
              );

              order.statusHistory = [
                ...(order.statusHistory || []),
                {
                  id: 'hist-notif-' + Date.now() + '-' + idx,
                  status: 'Stock Allocated (48h Payment Window)',
                  changedBy: 'System Auto-Allocator',
                  changedAt: now.toLocaleString(),
                  note: 'Warehouse stock allocated exclusively for this reservation. Customer notified to upload down payment within 48 hours. Reservation remains in Waiting.'
                }
              ];
              changed = true;
              modifiedOrderIds.add(order.id);
              registerPendingOrderWrite(order.id, order);
            } else if (resolvedDeadlineMs) {
              const authoritativeDeadlineIso = new Date(resolvedDeadlineMs).toISOString();
              if (!order.notifiedForPayment || order.paymentDeadline !== authoritativeDeadlineIso) {
                order.notifiedForPayment = true;
                order.paymentDeadline = authoritativeDeadlineIso;
                order.updatedAt = new Date().toISOString();
                changed = true;
                modifiedOrderIds.add(order.id);
                registerPendingOrderWrite(order.id, order);
              }
            }
          } else {
            // Still waiting for stock (unallocated or partially allocated)
            if (hasPaymentProof) {
              newStatus = 'payment_verification';
            } else if (order.status !== 'cancelled' && order.status !== 'completed' && order.status !== 'processing' && order.status !== 'to-ship' && order.status !== 'to-receive' && order.status !== 'delivered' && order.status !== 'ready_for_processing') {
              newStatus = 'pre-order';
            }
          }
        }

        if (!isExpired && (allocated !== prevAllocated || newStatus !== prevStatus)) {
          order.allocatedQuantity = allocated;
          order.status = newStatus;
          order.updatedAt = new Date().toISOString();

          if (allocated > prevAllocated) {
            const allocationTimestamp = resolvedDeadlineMs
              ? new Date(resolvedDeadlineMs - (48 * 60 * 60 * 1000)).toISOString()
              : new Date().toISOString();

            order.actualRestockDate = allocationTimestamp;
            order.restockAllocatedAt = allocationTimestamp;
            if (allocated >= totalQtyNeeded) {
              order.stockAllocatedAt = allocationTimestamp;
            }
          }

          changed = true;
          modifiedOrderIds.add(order.id);
          registerPendingOrderWrite(order.id, order);
          
          // Log status change
          const changer = 'System Auto-Allocator';
          const historyNote = newStatus === 'ready_for_processing' 
            ? `Transferred to Ready for Processing! ALL conditions satisfied (Approved, Payment Verified, Stock Available).`
            : (newStatus === 'payment_verification'
                ? `Payment proof uploaded by customer. Moved to Payment Verification.`
                : (allocated >= totalQtyNeeded 
                    ? `Stock fully allocated (${allocated}/${totalQtyNeeded} sacks). Waiting for customer down payment.`
                    : (allocated > 0
                        ? `Stock partially allocated (${allocated}/${totalQtyNeeded} sacks). Waiting for additional stock.`
                        : `Waiting for sufficient warehouse stock (${allocated}/${totalQtyNeeded} sacks currently allocated).`)));
          
          order.statusHistory = [
            ...(order.statusHistory || []),
            {
              id: 'hist-alloc-' + Date.now() + '-' + idx + '-' + Math.floor(Math.random() * 100),
              status: order.status === 'ready_for_processing' ? 'Ready for Processing' : (order.status === 'payment_verification' ? 'Payment Verification' : 'Waiting for Stock'),
              changedBy: changer,
              changedAt: now.toLocaleString(),
              note: historyNote
            }
          ];

          // Trigger notifications on allocation change
          if (order.status === 'ready_for_processing') {
            addNotification(
              order.userId || order.customerId || '',
              '✅ Reservation Ready for Processing',
              'Your reservation is now approved, payment verified, and stock allocated!',
              { role: 'customer', type: 'reservation', reservationId: order.id }
            );
          }

          // Add Activity Log
          const diff = allocated - prevAllocated;
          if (diff > 0) {
            addActivityLog('Reservations', `Auto-allocated ${diff} sacks for variety: '${product.name}' (Ticket #${order.id}, total allocated: ${allocated}/${totalQtyNeeded})`, product.name);
          }
        }
      }
    });

    // Phase B: Evaluate fulfillment batches and schedule updates
    if (actualRestockedQty > 0) {
      // Determine current restock milestone date
      let currentBatchRestockDate = null;
      const pDateStr = product.estimatedRestockDate || product.expectedRestockDate || product.restockDate;
      if (pDateStr) {
        const pd = new Date(pDateStr);
        if (!isNaN(pd.getTime())) currentBatchRestockDate = pd;
      }
      if (!currentBatchRestockDate) {
        currentBatchRestockDate = new Date();
      }

      // Determine next restock date for deferred reservations using historical intervals
      const allHist = typeof getInventoryHistory === 'function' ? getInventoryHistory() : [];
      const posRestocks = allHist.filter(h => 
        matchesProductVariety(product, h, products) && 
        Number(h.quantityAdded || 0) > 0
      );
      posRestocks.sort((a, b) => {
        const tA = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
        const tB = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
        return tA - tB;
      });
      const intervals = [];
      for (let i = 1; i < posRestocks.length; i++) {
        const d1 = new Date(`${posRestocks[i-1].date}T${posRestocks[i-1].time || '00:00'}`);
        const d2 = new Date(`${posRestocks[i].date}T${posRestocks[i].time || '00:00'}`);
        const diff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 0) intervals.push(diff);
      }
      let avgInterval = null;
      if (posRestocks.length >= 2 && intervals.length >= 1) {
        avgInterval = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
      }
      let nextBatchRestockDate = null;
      if (avgInterval && avgInterval > 0) {
        const stepMs = Math.max(1, Math.round(avgInterval)) * 24 * 60 * 60 * 1000;
        nextBatchRestockDate = new Date(currentBatchRestockDate.getTime() + stepMs);
      }

      reservations.forEach(resOrder => {
        const normResStatus = String(resOrder.status || '').toLowerCase().replace(/_/g, '-');
        if (
          normResStatus === 'cancelled' ||
          normResStatus === 'completed' ||
          normResStatus === 'rejected' ||
          normResStatus === 'processing' ||
          normResStatus === 'to-ship' ||
          normResStatus === 'to-receive' ||
          normResStatus === 'delivered' ||
          normResStatus === 'ready-for-processing' ||
          normResStatus === 'ready'
        ) {
          return;
        }

        const resItem = resOrder.items?.find(it => {
          if (!it) return false;
          const itemProductId = String(
            it.product?.id ??
            it.productId ??
            (typeof it.product === 'string' || typeof it.product === 'number' ? it.product : '') ??
            ''
          ).trim();
          if (itemProductId && itemProductId === productId) return true;
          try {
            return matchesProductVariety({ id: productId, name: product.name }, it.product || it, products);
          } catch (e) {
            return false;
          }
        });
        const totalQtyNeeded = Number(resItem?.quantity || resOrder.quantity || 1);
        const allocQty = Number(resOrder.allocatedQuantity || 0);

        // A reservation is included in the current fulfillment batch if its stock has been fully allocated
        // (funded by previously allocated stock or newly allocated from this restock)
        const fitsInCurrentBatch = allocQty >= totalQtyNeeded;

        const isPickup = resOrder.deliveryOption === 'pickup' || resOrder.fulfillmentMethod === 'pickup';
        const deliveryLead1 = isPickup ? 1 : 2;
        const deliveryLead2 = isPickup ? 2 : 3;

        const oldEstDate = resOrder.estimatedFulfillmentDate || getEstimatedArrivalDate(resOrder);

        if (fitsInCurrentBatch) {
          resOrder.restockBatchExcluded = false;
          resOrder.unallocatedRestockNoticePending = false;
          const batchDateStr = formatDateOrRange(
            addBusinessDays(currentBatchRestockDate, deliveryLead1),
            addBusinessDays(currentBatchRestockDate, deliveryLead2)
          );

          if (resOrder.estimatedFulfillmentDate && resOrder.estimatedFulfillmentDate !== batchDateStr && resOrder.estimatedFulfillmentDate !== 'Waiting for Restock') {
            const wasDeferred = oldEstDate && oldEstDate !== batchDateStr && oldEstDate !== 'Waiting for Restock';
            if (wasDeferred) {
              resOrder.estimatedFulfillmentDate = batchDateStr;
              changed = true;
              modifiedOrderIds.add(resOrder.id);

              const fulfillmentLabel = isPickup ? 'pickup' : 'delivery';
              const prodName = product.name || 'Rice';
              addNotification(
                resOrder.userId || resOrder.customerId || '',
                'Reservation Schedule Updated',
                `Your estimated ${fulfillmentLabel} date for ${prodName} has been moved from ${oldEstDate} to ${batchDateStr} because your reservation is included in the latest available stock batch.`,
                {
                  role: 'customer',
                  type: 'reservation',
                  reservationId: resOrder.id,
                  orderId: resOrder.id
                }
              );
            }
          } else if (!resOrder.estimatedFulfillmentDate || resOrder.estimatedFulfillmentDate === 'Waiting for Restock') {
            resOrder.estimatedFulfillmentDate = batchDateStr;
            changed = true;
            modifiedOrderIds.add(resOrder.id);
          }
        } else {
          // Active waiting reservation NOT included in this restock allocation because available stock was insufficient.
          // Preserve original historical estimated-date data (do NOT overwrite resOrder.estimatedFulfillmentDate).
          resOrder.restockBatchExcluded = true;
          resOrder.excludedFromRestockAt = new Date().toISOString();

          let nextEstDateStr = getEstimatedArrivalDate(resOrder);
          if ((!nextEstDateStr || nextEstDateStr === 'Waiting for Restock' || nextEstDateStr === 'Not yet scheduled') && nextBatchRestockDate) {
            nextEstDateStr = formatDateOrRange(
              addBusinessDays(nextBatchRestockDate, deliveryLead1),
              addBusinessDays(nextBatchRestockDate, deliveryLead2)
            );
          }

          const latestHistEntry = posRestocks.length > 0 ? posRestocks[posRestocks.length - 1] : null;
          const restockEventStamp = product.lastRestockAt || (latestHistEntry ? `${latestHistEntry.date}T${latestHistEntry.time || '00:00'}` : currentBatchRestockDate.toISOString());
          const restockEventKey = `${productId}:${restockEventStamp}`;

          if (resOrder.lastNotifiedUnallocatedRestockKey !== restockEventKey) {
            resOrder.lastNotifiedUnallocatedRestockKey = restockEventKey;
            resOrder.unallocatedRestockNoticePending = true;
            resOrder.unallocatedRestockChoiceMade = null;
            resOrder.unallocatedRestockNotifiedAt = new Date().toISOString();
            changed = true;
            modifiedOrderIds.add(resOrder.id);
            registerPendingOrderWrite(resOrder.id, resOrder);

            const fulfillmentLabel = isPickup ? 'pickup' : 'delivery';
            const prodName = product.name || resItem?.product?.name || resItem?.productName || 'Rice';
            const displayMovedDate = (nextEstDateStr && nextEstDateStr !== 'Not yet scheduled') ? nextEstDateStr : (oldEstDate || 'Waiting for Restock');
            const dateExplanation = (displayMovedDate && displayMovedDate !== 'Waiting for Restock')
              ? `Your estimated ${fulfillmentLabel} date has been moved to ${displayMovedDate}.`
              : `Your estimated ${fulfillmentLabel} date is currently ${displayMovedDate}.`;

            const custId = resOrder.userId || resOrder.customerId || '';
            if (custId) {
              addNotification(
                custId,
                'Reservation Not Included in Latest Stock Allocation',
                `Your reservation (#${resOrder.id}) for ${prodName} was not included in the latest stock allocation because the available rice was not enough to cover all waiting reservations. ${dateExplanation} You can continue waiting for the next restock or cancel your reservation.`,
                {
                  role: 'customer',
                  type: 'reservation',
                  targetType: 'reservation',
                  reservationId: String(resOrder.id),
                  orderId: String(resOrder.id),
                  targetId: String(resOrder.id),
                  tab: 'reservations',
                  requiresUnallocatedChoice: true,
                  eventKey: `res-unallocated-${resOrder.id}-${restockEventKey}`
                }
              );
            }
          } else {
            changed = true;
            modifiedOrderIds.add(resOrder.id);
          }
        }
      });
    } else {
      // Sync tentative dates for active reservations not explicitly excluded by a past restock
      reservations.forEach(resOrder => {
        if (!resOrder.restockBatchExcluded) {
          const tentative = getEstimatedArrivalDate(resOrder);
          if (tentative && tentative !== 'Waiting for Restock' && tentative !== 'Not yet scheduled' && resOrder.estimatedFulfillmentDate !== tentative) {
            resOrder.estimatedFulfillmentDate = tentative;
            changed = true;
            modifiedOrderIds.add(resOrder.id);
          }
        }
      });
    }
  });

  // Ensure dynamic strictly-FCFS queuePosition is attached to all active reservations
  orders.forEach(o => {
    const isRes = o.isPreOrder || o.status === 'pre-order' || o.status === 'pre_order' || o.status === 'waiting' || o.status === 'ready_for_processing' || o.status === 'ready' || o.status === 'payment_verification' || (o.items && o.items.some(it => it.isReservation));
    if (isRes) {
      const computedPos = getReservationQueuePosition(o, orders);
      if (computedPos !== null && o.queuePosition !== computedPos) {
        o.queuePosition = computedPos;
        changed = true;
        modifiedOrderIds.add(o.id);
      }
    }
  });

  if (changed) {
    saveOrders(orders);
    if (isOrdersHydrated() || targetProductId !== null) {
      modifiedOrderIds.forEach(mId => {
        const ord = orders.find(o => String(o.id) === String(mId));
        if (ord && !isStaleOrderOrReservation(ord)) {
          saveFirestoreDoc('orders', ord.id, ord).catch(err => {
            console.warn('[RESERVATIONS] Firestore save notice for order', mId, err);
          });
        }
      });
    }
    // Trigger real-time sync event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aurora-sync-event'));
    }
  }
}

export function confirmContinueUnallocatedReservation(orderId) {
  if (!orderId) return false;
  const orders = getOrders();
  const idx = orders.findIndex(o => String(o.id).trim().toLowerCase() === String(orderId).trim().toLowerCase());
  if (idx === -1) return false;

  const ord = orders[idx];
  const normStatus = String(ord.status || '').toLowerCase().replace(/_/g, '-');
  if (normStatus === 'cancelled' || normStatus === 'completed' || normStatus === 'rejected') {
    return false;
  }

  // Keep existing reservation active, preserve queue position, quantity, and waiting-for-stock state.
  // Only acknowledge the unallocated restock choice so the customer continues waiting in the queue.
  ord.unallocatedRestockNoticePending = false;
  ord.unallocatedRestockChoiceMade = 'continue';
  ord.unallocatedRestockContinuedAt = new Date().toISOString();
  ord.updatedAt = new Date().toISOString();

  registerPendingOrderWrite(ord.id, ord);
  saveOrders(orders, { colName: 'orders', docId: ord.id, docData: ord });

  return true;
}

// Check if reservation is inactive, cancelled, completed, delivered, or in processing/transit
function isExcludedReservationForQueue(o) {
  if (!o || o.linkedReservationId) return true;
  const cleanStatus = String(o.status || '').toLowerCase().replace(/_/g, '-').trim();
  return (
    cleanStatus === 'cancelled' ||
    cleanStatus === 'completed' ||
    cleanStatus === 'delivered' ||
    cleanStatus === 'processing' ||
    cleanStatus === 'to-ship' ||
    cleanStatus === 'to-receive' ||
    cleanStatus === 'ready-for-processing' ||
    cleanStatus === 'ready' ||
    cleanStatus === 'rejected' ||
    cleanStatus === 'expired' ||
    (o.paymentRejected === true && (typeof isReservationWaitingForReupload !== 'function' || !isReservationWaitingForReupload(o))) ||
    o.paymentStatus === 'rejected_expired' ||
    o.autoCancelledDueToRejectionDeadline === true ||
    o.autoCancelledDueToPaymentDeadline === true
  );
}

// Stage 2: Payment Verification Queue
export function isReservationInPaymentVerificationStage(o) {
  if (!o || isExcludedReservationForQueue(o)) return false;
  const cleanStatus = String(o.status || '').toLowerCase().replace(/_/g, '-').trim();

  if (
    cleanStatus === 'payment-verification' ||
    cleanStatus === 'payment_verification' ||
    o.paymentStatus === 'pending_verification'
  ) {
    return true;
  }

  const hasProof = Boolean(
    (o.paymentProofDataUrl && o.paymentProofDataUrl.length > 20) ||
    (o.paymentProof && String(o.paymentProof).startsWith('data:')) ||
    (o.paymentProof && o.paymentUploadedAt)
  );
  if (hasProof && !o.paymentVerified) {
    return true;
  }

  if (typeof isReservationWaitingForReupload === 'function' && isReservationWaitingForReupload(o)) {
    return true;
  }

  return false;
}

// Stage 1: Waiting for Stock Queue
export function isReservationInWaitingForStockStage(o) {
  if (!o || isExcludedReservationForQueue(o)) return false;
  if (isReservationInPaymentVerificationStage(o)) return false;

  const cleanStatus = String(o.status || '').toLowerCase().replace(/_/g, '-').trim();
  const oRes = Boolean(
    o.isPreOrder === true ||
    (o.items && Array.isArray(o.items) && o.items.some(it => it && it.isReservation === true)) ||
    ['pre-order', 'pre_order', 'waiting', 'waiting-for-stock'].includes(cleanStatus) ||
    String(o.id || '').toUpperCase().replace(/^#/, '').startsWith('RES')
  );
  return oRes;
}

export function getPaymentVerificationEntryTime(o) {
  if (!o) return 0;
  // 1. Explicit payment proof upload timestamp if customer uploaded proof
  if (o.paymentUploadedAt) {
    const t = new Date(o.paymentUploadedAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (o.paymentProofUploadedAt) {
    const t = new Date(o.paymentProofUploadedAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  // 2. Status history timestamp for Payment Verification or Stock Allocated
  if (Array.isArray(o.statusHistory)) {
    const entry = [...o.statusHistory].reverse().find(h => {
      if (!h) return false;
      const s = String(h.status || '').toLowerCase();
      const n = String(h.note || '').toLowerCase();
      return s.includes('payment verification') || s.includes('payment_verification') ||
             s.includes('stock allocated') || s.includes('allocated') ||
             n.includes('payment verification') || n.includes('stock allocated');
    });
    if (entry) {
      const t = new Date(entry.changedAt || entry.date || entry.timestamp || 0).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
  }
  // 3. Explicit stock allocation timestamps
  const allocTime = o.stockAllocatedAt || o.actualRestockDate || o.restockAllocatedAt;
  if (allocTime) {
    const t = new Date(allocTime).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  // 4. Payment deadline (which was set 48h after allocation)
  if (o.paymentDeadline) {
    const dl = new Date(o.paymentDeadline).getTime();
    if (!isNaN(dl) && dl > 0) {
      return dl - (48 * 60 * 60 * 1000);
    }
  }
  // 5. Updated timestamp
  if (o.updatedAt) {
    const t = new Date(o.updatedAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  // 6. Fallback to order creation time
  return new Date(o.createdAt || o.dateCreated || o.date || 0).getTime();
}

export function getReservationQueuePosition(targetOrder, allOrders = null, targetProductId = null) {
  if (!targetOrder) return null;

  const orders = allOrders || getOrders();

  // Stage 1: Waiting for Stock Queue (positions #1, #2, #3... among active Waiting for Stock reservations)
  if (isReservationInWaitingForStockStage(targetOrder)) {
    let waitingList = orders.filter(o => isReservationInWaitingForStockStage(o));

    if (targetProductId) {
      const targetProdId = String(targetProductId);
      waitingList = waitingList.filter(o => {
        return (
          (o.items && Array.isArray(o.items) && o.items.some(it => {
            if (!it) return false;
            const itProdId = String(it.product?.id || it.productId || (typeof it.product === 'string' || typeof it.product === 'number' ? it.product : '') || it.id || '');
            return itProdId && itProdId === targetProdId;
          })) ||
          String(o.productId || o.product?.id || '') === targetProdId
        );
      });
    }

    waitingList.sort((a, b) => {
      const tA = new Date(a.createdAt || a.dateCreated || a.date || 0).getTime();
      const tB = new Date(b.createdAt || b.dateCreated || b.date || 0).getTime();
      if (tA !== tB) return tA - tB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const targetId = String(targetOrder.id || '').toLowerCase().replace(/^#/, '');
    const idx = waitingList.findIndex(o => String(o.id || '').toLowerCase().replace(/^#/, '') === targetId);
    return idx !== -1 ? (idx + 1) : null;
  }

  // Stage 2: Payment Verification Queue (positions #1, #2, #3... among active Payment Verification reservations)
  if (isReservationInPaymentVerificationStage(targetOrder)) {
    let pvList = orders.filter(o => isReservationInPaymentVerificationStage(o));

    if (targetProductId) {
      const targetProdId = String(targetProductId);
      pvList = pvList.filter(o => {
        return (
          (o.items && Array.isArray(o.items) && o.items.some(it => {
            if (!it) return false;
            const itProdId = String(it.product?.id || it.productId || (typeof it.product === 'string' || typeof it.product === 'number' ? it.product : '') || it.id || '');
            return itProdId && itProdId === targetProdId;
          })) ||
          String(o.productId || o.product?.id || '') === targetProdId
        );
      });
    }

    pvList.sort((a, b) => {
      const tA = getPaymentVerificationEntryTime(a);
      const tB = getPaymentVerificationEntryTime(b);
      if (tA !== tB) return tA - tB;
      const cA = new Date(a.createdAt || a.dateCreated || a.date || 0).getTime();
      const cB = new Date(b.createdAt || b.dateCreated || b.date || 0).getTime();
      if (cA !== cB) return cA - cB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const targetId = String(targetOrder.id || '').toLowerCase().replace(/^#/, '');
    const idx = pvList.findIndex(o => String(o.id || '').toLowerCase().replace(/^#/, '') === targetId);
    return idx !== -1 ? (idx + 1) : null;
  }

  return null;
}

// ---------------------- ACTIVITY LOGGING API ----------------------

export function getActivityLogs() {
  let logs = [];
  try {
    const raw = localStorage.getItem('aurora-activity-logs');
    if (raw) logs = JSON.parse(raw);
    if (!Array.isArray(logs)) logs = [];
  } catch (e) {
    logs = [];
  }
  return sortActivityLogsDesc(logs);
}

export function getLogs() {
  return getActivityLogs();
}

export function addActivityLog(categoryOrObj, action, target = '') {
  const admin = getCurrentAdmin();

  const logs = getActivityLogs();
  let categoryVal = categoryOrObj;
  let actionVal = action;
  let targetVal = target;
  let userName = admin ? (admin.name || admin.fullName || 'Admin User') : 'Admin User';
  let userRole = admin ? (admin.role || 'admin') : 'admin';

  if (categoryOrObj && typeof categoryOrObj === 'object') {
    categoryVal = categoryOrObj.category || 'System';
    actionVal = categoryOrObj.action || '';
    targetVal = categoryOrObj.target || '';
    if (categoryOrObj.userName) userName = categoryOrObj.userName;
    if (categoryOrObj.userRole) userRole = categoryOrObj.userRole;
  }

  // Extremely defensive checks to ensure no objects or undefined slip through
  if (categoryVal && typeof categoryVal === 'object') {
    categoryVal = categoryVal.category || 'System';
  }
  if (actionVal && typeof actionVal === 'object') {
    actionVal = actionVal.action || 'System Action';
  }
  if (targetVal && typeof targetVal === 'object') {
    targetVal = targetVal.target || '';
  }

  categoryVal = categoryVal ? String(categoryVal).trim() : 'System';
  actionVal = actionVal ? String(actionVal).trim() : 'System Action';
  targetVal = targetVal ? String(targetVal).trim() : '';

  if (categoryVal === '[object Object]' || categoryVal === 'undefined') categoryVal = 'System';
  if (actionVal === '[object Object]' || actionVal === 'undefined') actionVal = 'System Action';
  if (targetVal === '[object Object]' || targetVal === 'undefined') targetVal = '';

  const newLog = {
    id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    userName: userName,
    userRole: userRole,
    category: categoryVal,
    action: actionVal,
    target: targetVal,
    timestamp: new Date().toISOString() // Use standard ISO string for clean parsing/filtering
  };

  logs.unshift(newLog);
  const sortedLogs = sortActivityLogsDesc(logs);
  safeLocalStorageSet('aurora-activity-logs', JSON.stringify(sortedLogs));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aurora-logs-updated', { detail: { logs: sortedLogs } }));
    window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: 'aurora-activity-logs', remote: false } }));
  }

  // Authoritative document write directly to Firestore activityLogs collection
  try {
    saveActivityLogDoc(newLog).catch(err => {
      console.warn('[FIREBASE] Error saving activityLog document to Firestore:', err);
    });
  } catch (e) {
    console.warn('[FIREBASE] Exception calling saveActivityLogDoc:', e);
  }

  return newLog;
}

// ---------------------- CASH TURNOVER AUDIT API ----------------------

export function getStaff() {
  const raw = localStorage.getItem('aurora-staff');
  if (raw) return JSON.parse(raw);
  const defaultStaff = [
    {
      id: 'staff-1',
      name: 'Maria Santos',
      email: 'maria.staff@gmail.com',
      contactNumber: '+63 912 345 6789',
      role: 'Staff',
      isArchived: false
    },
    {
      id: 'staff-2',
      name: 'Juan Staff',
      email: 'juan.staff@gmail.com',
      contactNumber: '+63 918 273 6451',
      role: 'Staff',
      isArchived: false
    }
  ];
  localStorage.setItem('aurora-staff', JSON.stringify(defaultStaff));
  return defaultStaff;
}

export function verifyCashTurnover(orderId, remarks = '') {
  const admin = getCurrentAdmin();
  if (!admin || admin.role !== 'admin') {
    throw new Error('Only system administrators can verify cash turnover.');
  }
  const orders = getOrders();
  const target = orders.find(o => String(o.id) === String(orderId));
  if (!target) {
    throw new Error('Order ticket not found.');
  }
  const now = new Date();
  target.financialStatus = 'Verified';
  target.financialVerification = true;
  target.verifiedPayment = true;
  target.cashAuditStatus = 'Audited';
  target.cashToAudit = getCashToAudit(target);
  target.verifiedBy = admin.name || 'Administrator';
  target.verifiedAt = now.toLocaleString();
  target.verifiedDate = now.toLocaleDateString();
  target.verifiedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  if (remarks) {
    target.verificationRemarks = remarks;
  }

  // Evaluate order completion condition (Requires BOTH customer confirmation AND financial verification)
  evaluateOrderCompletion(target);

  saveOrders(orders, { colName: 'orders', docId: String(target.id), docData: target });
  addActivityLog(
    'Cash Turnover',
    `Verified cash turnover of ₱${(target.amountCollected || 0).toLocaleString()} for Order Ticket #${orderId} collected by ${target.collectedBy || 'Staff'}`,
    `Order #${orderId}`
  );
  return target;
}

// ---------------------- TOAST ALERT POPUP ----------------------

export function showToast(message, type = 'success') {
  // Check if loader exists
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(container);
  }

  // Prevent duplicate logout-success notifications from appearing simultaneously
  const msgLower = String(message || '').toLowerCase();
  if (msgLower.includes('logged out successfully')) {
    const existingToasts = Array.from(container.querySelectorAll('span'));
    if (existingToasts.some(sp => String(sp.textContent || '').toLowerCase().includes('logged out successfully'))) {
      return;
    }
  }

  const el = document.createElement('div');
  el.className = `px-5 py-3 rounded-xl border shadow-xl font-bold text-sm transition-all duration-300 transform -translate-y-3 opacity-0 pointer-events-auto flex items-center gap-3 max-w-sm bg-white `;
  
  if (type === 'success') {
    el.className += 'border-emerald-300 text-emerald-900 bg-emerald-50/95';
    el.innerHTML = (typeof ICONS !== 'undefined' ? ICONS.check : '✔ ') + `<span>${message}</span>`;
  } else if (type === 'error') {
    el.className += 'border-red-300 text-red-900 bg-red-50/95';
    el.innerHTML = `<span class="text-red-500 font-bold">${typeof ICONS !== 'undefined' ? ICONS.close : '✖'}</span><span>${message}</span>`;
  } else {
    el.className += 'border-blue-300 text-blue-900 bg-blue-50/95';
    el.innerHTML = (typeof ICONS !== 'undefined' ? ICONS.info : 'ℹ ') + `<span>${message}</span>`;
  }

  container.appendChild(el);

  // Trigger animation next tick
  setTimeout(() => {
    el.classList.remove('-translate-y-3', 'opacity-0');
  }, 10);

  // Delete after 3 seconds
  setTimeout(() => {
    el.classList.add('opacity-0', '-translate-y-3');
    setTimeout(() => {
      el.remove();
    }, 300);
  }, 3000);
}

export function openCustomerLogoutModal() {
  if (typeof document === 'undefined') return;

  let dialog = document.getElementById('customer-logout-confirm-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'customer-logout-confirm-dialog';
    dialog.className = 'fixed inset-0 bg-black/50 backdrop-blur-xs z-[100] flex items-center justify-center p-4 hidden animate-in fade-in duration-200';
    dialog.innerHTML = `
      <div class="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full shadow-2xl p-6 border border-gray-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 text-center">
        <div class="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center border border-rose-100 dark:border-rose-800/50 mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </div>
        <h3 class="text-base font-black text-gray-900 dark:text-gray-100 mb-2">Do you want to log out?</h3>
        <p class="text-xs text-gray-600 dark:text-gray-300 font-semibold leading-relaxed mb-6">You will need to sign in again to access your account and orders.</p>
        <div class="flex gap-2.5 justify-center">
          <button id="cancel-customer-logout-btn" type="button" class="px-5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 hover:border-gray-300 dark:hover:bg-slate-700 dark:hover:border-slate-500 cursor-pointer transition-all duration-200 bg-white dark:bg-slate-800 flex-1">Cancel</button>
          <button id="confirm-customer-logout-btn" type="button" class="px-5 py-2.5 bg-[#EF4444] hover:bg-[#DC2626] border border-transparent hover:border-red-700 dark:hover:border-red-400 text-white rounded-xl text-xs font-bold cursor-pointer transition-all duration-200 flex-1">Confirm Logout</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
  }

  const cancelBtn = document.getElementById('cancel-customer-logout-btn');
  const confirmBtn = document.getElementById('confirm-customer-logout-btn');

  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dialog.classList.add('hidden');
    };
  }

  dialog.onclick = (e) => {
    if (e.target === dialog) {
      dialog.classList.add('hidden');
    }
  };

  if (confirmBtn) {
    confirmBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.__customerLogoutInProgress) return;
      window.__customerLogoutInProgress = true;
      dialog.classList.add('hidden');
      const p = getPathPrefix();
      const signOutPromise = logoutUser();
      showToast('Logged out successfully');
      await Promise.all([
        Promise.resolve(signOutPromise).catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 600))
      ]);
      window.__customerLogoutInProgress = false;
      window.location.href = p + 'index.html';
    };
  }

  dialog.classList.remove('hidden');
}

// Global hook to expose library on window
if (typeof window !== 'undefined') {
  window.RiceFlow = {
    ICONS,
    getProducts,
    saveProducts,
    getProductById,
    getReviews,
    addReview,
    getCart,
    addToCart,
    removeFromCart,
    updateCartQty,
    clearCart,
    clearCartItems,
    getCurrentUser,
    getCurrentAdmin,
    loginUser,
    registerUser,
    logoutUser,
    openCustomerLogoutModal,
    loginAdmin,
    logoutAdmin,
    saveCurrentUser,
    getOrders,
    saveOrders,
    addOrder,
    updateOrderStatus,
    getAssignedStaffName,
    getAssignedDeliveryPersonName,
    getCashToAudit,
    verifyCashTurnover,
    evaluateOrderCompletion,
    getOrderCompletionDate,
    getStaff,
    getActivityLogs,
    getLogs,
    addActivityLog,
    saveActivityLogDoc,
    syncActivityLogsFromFirestore,
    sortActivityLogsDesc,
    showToast,
    getStoreSettings,
    sanitizeInput,
    hashPassword,
    checkLockout,
    recordFailedAttempt,
    resetFailedAttempts,
    checkEmailExists,
    validatePhilippinePhone,
    checkPhoneExists,
    changePassword,
    sendUserPasswordReset,
    verifyResetCode,
    completePasswordReset,
    getInventoryHistory,
    saveInventoryHistory,
    addInventoryHistory,
    getEstimatedAvailabilityDate,
    calculateReservationFulfillmentRestockDate,
    getAuthoritativeDeliveredDate,
    getEstimatedArrivalDate,
    getContactMessages,
    saveContactMessage,
    getIssueReports,
    saveIssueReports,
    getReplacementOrders,
    saveReplacementOrders,
    getNotifications,
    saveNotifications,
    addNotification,
    sortNotificationsDescending,
    getNotificationTimestampValue,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    NOTIF_STYLES,
    setupNotifications,
    setupAdminNotifications,
    syncUsersAndCustomers,
    updateUserFromCustomer,
    getCustomerVerifiedSpentAmount,
    allocateStockToReservations,
    getReservationQueuePosition,
    getProductReviews,
    getOrderingExperienceReviews,
    hasReviewedProduct,
    hasReviewedOrderingExperience,
    isOrderEligibleForReview,
    isOrderFullyReviewed,
    submitProductReview,
    submitOrderingExperienceReview,
    initReviewReminderPopup,
    saveFirestoreDoc,
    saveReviewDoc,
    syncReviewsFromFirestore,
    isReservationWaitingForReupload,
    cancelOrder,
    getActualRecordedPaidAmount,
    submitCustomerRefundDetails,
    updateOrderRefundStatus,
    formatDeadlineTimestamp,
    formatDeadlineCountdown,
    getOrderPaymentReuploadDeadlineMs,
    getActiveReservationPaymentDeadlineInfo,
    getActivePaymentReuploadDeadlineInfo,
    checkAndSendCustomer48HourReminders,
    updateAllLiveDeadlineCountdowns
  };
}

export function addBusinessDays(startDate, daysToAdd) {
  let cur = new Date(startDate);
  if (isNaN(cur.getTime())) cur = new Date();
  let count = 0;
  while (count < daysToAdd) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0) { // Skip Sundays
      count++;
    }
  }
  return cur;
}

export function formatDateOrRange(d1, d2) {
  if (!d1 || isNaN(d1.getTime())) return 'Not yet scheduled';
  
  const m1 = d1.toLocaleDateString('en-US', { month: 'short' });
  const day1 = d1.toLocaleDateString('en-US', { day: 'numeric' });
  const y1 = d1.toLocaleDateString('en-US', { year: 'numeric' });

  if (!d2 || isNaN(d2.getTime()) || d1.getTime() === d2.getTime()) {
    return `${m1} ${day1}, ${y1}`;
  }

  const m2 = d2.toLocaleDateString('en-US', { month: 'short' });
  const day2 = d2.toLocaleDateString('en-US', { day: 'numeric' });
  const y2 = d2.toLocaleDateString('en-US', { year: 'numeric' });

  if (y1 !== y2) {
    return `${m1} ${day1}, ${y1} – ${m2} ${day2}, ${y2}`;
  }
  if (m1 === m2) {
    return `${m1} ${day1} – ${day2}, ${y1}`;
  }
  return `${m1} ${day1} – ${m2} ${day2}, ${y1}`;
}

/**
 * Authoritative dynamic reservation fulfillment restock date calculator.
 * Simulates the First-Come-First-Served (FCFS) reservation queue against
 * physical restocking availability, distinguishing between the product Restock Date
 * and this specific customer's Reservation Fulfillment Date.
 * 
 * Follows:
 * - Priority A: Explicit administrator-configured restock date (product or order)
 * - Priority B: Historical restock pattern from inventory history (evaluating intervals across >=3 restocks)
 * - Priority C: Insufficient historical data returns null ('Waiting for Restock')
 * - Queue simulation: Active reservations consume batch quantities; customers exceeding batch are deferred to next restock
 * - Partial fulfillment rule: Incomplete batch quantities do NOT mark customer fulfilled
 * - Inactive/cancelled reservations: Do not consume stock, allowing later reservations to move forward dynamically
 */
export function calculateReservationFulfillmentRestockDate(order) {
  if (!order) return null;

  // ============================================================
  // 1. IDENTIFY THE EXACT PRODUCT
  // ============================================================
  const allProducts = typeof getProducts === 'function' ? getProducts() : [];

  let refId = '';
  let refName = '';

  if (Array.isArray(order.items) && order.items.length > 0) {
    const reservationItem =
      order.items.find(item => item && item.isReservation) ||
      order.items[0];

    refId = String(
      reservationItem?.product?.id ||
      reservationItem?.productId ||
      reservationItem?.id ||
      ''
    ).trim();

    refName = String(
      reservationItem?.product?.name ||
      reservationItem?.productName ||
      reservationItem?.name ||
      reservationItem?.productTitle ||
      ''
    ).trim();
  } else {
    refId = String(
      order.productId ||
      order.product?.id ||
      ''
    ).trim();

    refName = String(
      order.productName ||
      order.product?.name ||
      order.riceType ||
      order.variety ||
      ''
    ).trim();
  }

  if (!refId && !refName) {
    return null;
  }

  // Find the exact catalog product.
  let targetProduct = null;

  if (refId) {
    targetProduct = allProducts.find(
      product => String(product.id) === refId
    );
  }

  if (!targetProduct && refName) {
    const normalizedName = refName.toLowerCase().trim();

    targetProduct = allProducts.find(
      product =>
        String(product.name || '').toLowerCase().trim() === normalizedName
    );
  }

  // We can still calculate from the reservation itself even if
  // the catalog copy is temporarily unavailable.
  if (!targetProduct) {
    targetProduct = {
      id: refId,
      name: refName,
      stock: 0
    };
  }

  // ============================================================
  // 2. FIRST PRIORITY: REAL EXPLICIT UPCOMING RESTOCK DATE
  // ============================================================
  let explicitRestockDate = null;

  const possibleExplicitDates = [
    order.estimatedRestockDate,
    order.expectedRestockDate,
    targetProduct.estimatedRestockDate,
    targetProduct.expectedRestockDate,
    targetProduct.restockDate
  ];

  const endOfTodayMs = (() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  })();

  for (const value of possibleExplicitDates) {
    if (!value) continue;

    const parsed = new Date(value);

    // Only use a legitimate FUTURE restock date (and if excluded from today's restock, strictly after today).
    const minValidMs = order.restockBatchExcluded === true ? endOfTodayMs : Date.now();
    if (
      !isNaN(parsed.getTime()) &&
      parsed.getTime() > minValidMs
    ) {
      explicitRestockDate = parsed;
      break;
    }
  }

  if (explicitRestockDate) {
    explicitRestockDate.setHours(0, 0, 0, 0);
    return explicitRestockDate;
  }

  // ============================================================
  // 3. SECOND PRIORITY: ACTUAL INVENTORY RESTOCK HISTORY
  // ============================================================
  const allHistory =
    typeof getInventoryHistory === 'function'
      ? getInventoryHistory()
      : [];

  const normalizedTargetName = String(
    targetProduct.name || refName || ''
  )
    .toLowerCase()
    .trim();

  const positiveRestocks = allHistory
    .filter(history => {
      if (!history) return false;

      const quantity = Number(history.quantityAdded || 0);

      // Only actual stock additions count as restocks.
      if (quantity <= 0) return false;

      const historyProductId = String(
        history.productId || ''
      ).trim();

      // --------------------------------------------------------
      // If inventory history has a product ID, it MUST match
      // the exact product. Never match another product by name.
      // --------------------------------------------------------
      if (refId && historyProductId) {
        return historyProductId === refId;
      }

      // --------------------------------------------------------
      // Older history records may not have productId.
      // For those records only, use exact product-name matching.
      // --------------------------------------------------------
      if (!historyProductId && normalizedTargetName) {
        const historyName = String(
          history.productName ||
          history.name ||
          ''
        )
          .toLowerCase()
          .trim();

        return historyName === normalizedTargetName;
      }

      return false;
    })
    .map(history => {
      const date = new Date(
        `${history.date}T${history.time || '00:00'}`
      );

      return {
        ...history,
        parsedDate: date
      };
    })
    .filter(history => !isNaN(history.parsedDate.getTime()))
    .sort(
      (a, b) =>
        a.parsedDate.getTime() -
        b.parsedDate.getTime()
    );

  // ============================================================
  // 4. NEED AT LEAST TWO ACTUAL RESTOCK EVENTS
  //    TO CALCULATE A REAL INTERVAL.
  //
  //    We DO NOT invent 7 days / 14 days.
  // ============================================================
  if (positiveRestocks.length < 2) {
    return null;
  }

  const intervals = [];

  for (let i = 1; i < positiveRestocks.length; i++) {
    const previous =
      positiveRestocks[i - 1].parsedDate;

    const current =
      positiveRestocks[i].parsedDate;

    const diffDays =
      (current.getTime() - previous.getTime()) /
      (1000 * 60 * 60 * 24);

    if (diffDays > 0) {
      intervals.push(diffDays);
    }
  }

  if (intervals.length < 1) {
    return null;
  }

  // Average interval between REAL historical restocks.
  const averageIntervalDays =
    intervals.reduce(
      (sum, value) => sum + value,
      0
    ) / intervals.length;

  if (
    !isFinite(averageIntervalDays) ||
    averageIntervalDays <= 0
  ) {
    return null;
  }

  // ============================================================
  // 5. PROJECT THE NEXT LEGITIMATE RESTOCK DATE
  //    FROM THE MOST RECENT ACTUAL RESTOCK.
  //
  //    IMPORTANT:
  //    We DO NOT use future quantity here.
  //    We DO NOT split queue positions into batches here.
  // ============================================================
  const latestRestock =
    positiveRestocks[positiveRestocks.length - 1]
      .parsedDate;

  const intervalMilliseconds =
    averageIntervalDays *
    24 *
    60 *
    60 *
    1000;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let projectedDate = new Date(
    latestRestock.getTime() +
    intervalMilliseconds
  );

  projectedDate.setHours(0, 0, 0, 0);

  // If the projected date is already past (or is today when already excluded from today's restock),
  // continue using the same REAL historical interval until we reach the next legitimate future restock window.
  while (order.restockBatchExcluded === true ? projectedDate <= today : projectedDate < today) {
    projectedDate = new Date(
      projectedDate.getTime() +
      intervalMilliseconds
    );

    projectedDate.setHours(0, 0, 0, 0);
  }

  // ============================================================
  // 6. RETURN ONLY THE PROJECTED RESTOCK DATE.
  //
  // getEstimatedArrivalDate() will then apply:
  // Pickup  = +1 to +2 business days
  // Delivery = +2 to +3 business days
  //
  // All reservations created before the actual restock
  // initially use this same tentative schedule.
  // ============================================================
  return projectedDate;
}

export function getAuthoritativeDeliveredDate(order) {
  if (!order) return null;

  const oStatus = String(order.status || '').toLowerCase().replace(/_/g, '-');
  const isDeliveredOrCompleted =
    oStatus === 'delivered' ||
    oStatus === 'completed' ||
    oStatus === 'issue-reported' ||
    order.deliveryVerified === true ||
    Boolean(order.deliveredDate || order.deliveryVerificationDate || order.deliveredAt || order.deliveryVerifiedAt);

  if (!isDeliveredOrCompleted) return null;

  const parseAndFormatDeliveredDate = (rawVal) => {
    if (!rawVal) return null;
    if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
      return rawVal.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    if (typeof rawVal === 'number' && !isNaN(rawVal) && rawVal > 0) {
      const d = new Date(rawVal);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
    }
    const str = String(rawVal).trim().replace(/^Delivered:\s*/i, '').trim();
    if (!str) return null;
    let d = new Date(str);
    if (isNaN(d.getTime())) {
      const datePartOnly = str.replace(/,\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?.*$/, '').trim();
      if (datePartOnly && datePartOnly !== str) {
        d = new Date(datePartOnly);
      }
    }
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    return str;
  };

  // 1. Check authoritative direct delivery timestamp/date fields recorded on the order
  const directDeliveryCandidates = [
    order.deliveredAt,
    order.deliveryVerifiedAt,
    order.deliveryVerificationDate,
    order.deliveredDate
  ];
  for (const candidate of directDeliveryCandidates) {
    const formatted = parseAndFormatDeliveredDate(candidate);
    if (formatted) return formatted;
  }

  // 2. Check statusHistory for an authoritative 'Delivered' entry
  if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    const delEntry = [...order.statusHistory].reverse().find(h => {
      if (!h) return false;
      const s = String(h.status || '').toLowerCase().replace(/_/g, '-');
      return s === 'delivered' || s.includes('delivered');
    });
    if (delEntry) {
      const formatted = parseAndFormatDeliveredDate(delEntry.changedAt || delEntry.date || delEntry.timestamp);
      if (formatted) return formatted;
    }
  }

  // 3. When order is completed, reuse existing recorded delivery/completion timestamp if present
  if (oStatus === 'completed') {
    const completedDeliveryCandidates = [
      order.collectedDate,
      order.completedAt,
      order.completionDate,
      order.customerConfirmationDate
    ];
    for (const candidate of completedDeliveryCandidates) {
      const formatted = parseAndFormatDeliveredDate(candidate);
      if (formatted) return formatted;
    }
    if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
      const compEntry = [...order.statusHistory].reverse().find(h => {
        if (!h) return false;
        const s = String(h.status || '').toLowerCase().replace(/_/g, '-');
        return s === 'completed' || s.includes('completed') || s === 'shipped';
      });
      if (compEntry) {
        const formatted = parseAndFormatDeliveredDate(compEntry.changedAt || compEntry.date || compEntry.timestamp);
        if (formatted) return formatted;
      }
    }
  }

  return null;
}

export function getEstimatedArrivalDate(order) {
  if (!order) return 'Not yet scheduled';

  const oStatus = (order.status || '').toLowerCase().replace(/_/g, '-');
  const isPickup = order.deliveryOption === 'pickup' || order.fulfillmentMethod === 'pickup';
  const isReservation = isReservationOrder(order) || !!order.isPreOrder || !!order.isReservation || (order.items && order.items.some(i => i.isReservation));

  // For normal orders: once actually delivered/completed, stop moving the estimate and display the actual delivery date
  if (!isReservation) {
    const authDeliveredDate = getAuthoritativeDeliveredDate(order);
    if (authDeliveredDate) {
      return `Delivered: ${authDeliveredDate}`;
    }
  }

  // 1. If explicit completed/delivered date exists on completed/delivered orders (reservations fallback)
  if (oStatus === 'completed' || oStatus === 'delivered') {
    const delDate = order.deliveredDate || order.deliveryVerificationDate || order.deliveredAt;
    if (delDate) {
      const parsed = new Date(delDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return String(delDate);
    }
  }

  const isUndeliveredActiveNormalOrder =
    !isReservation &&
    !['delivered', 'completed', 'cancelled', 'rejected', 'issue-reported'].includes(oStatus) &&
    order.deliveryVerified !== true &&
    !order.deliveredDate &&
    !order.deliveryVerificationDate &&
    !order.deliveredAt &&
    !order.deliveryVerifiedAt;

  // Helper to dynamically move an expired normal-order estimated delivery window forward in ~2-day increments
  // without mutating or overwriting any stored order fields.
  const rollForwardExpiredNormalWindow = (d1, d2) => {
    if (!d1 || isNaN(d1.getTime())) return { start: d1, end: d2 || d1, rolled: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let start = new Date(d1);
    start.setHours(0, 0, 0, 0);
    let end = new Date(d2 && !isNaN(d2.getTime()) ? d2 : d1);
    end.setHours(0, 0, 0, 0);

    let rolled = false;
    if (isUndeliveredActiveNormalOrder && end < today) {
      rolled = true;
      while (end < today) {
        start = new Date(end);
        start.setDate(start.getDate() + 1);
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setDate(end.getDate() + 1);
        end.setHours(0, 0, 0, 0);
      }
    }
    return { start, end, rolled };
  };

  // Helper to parse a single date or date-range string (e.g. "Sep 28 – 29, 2026" or "September 28–29")
  const parseNormalOrderDateOrWindow = (val, fallbackYear) => {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
      return { start: new Date(val), end: new Date(val) };
    }
    const str = String(val).trim();
    if (!str) return null;

    const yrDefault = fallbackYear || new Date().getFullYear();

    // Pattern A: Same-month range e.g. "Sep 28 – 29, 2026" or "September 28–29"
    const sameMonthMatch = str.match(/^([A-Za-z]+)\s+(\d{1,2})\s*(?:–|—|-|to)\s*(\d{1,2})(?:,\s*(\d{4}))?$/i);
    if (sameMonthMatch) {
      const mName = sameMonthMatch[1];
      const day1 = Number(sameMonthMatch[2]);
      const day2 = Number(sameMonthMatch[3]);
      const yr = sameMonthMatch[4] ? Number(sameMonthMatch[4]) : yrDefault;
      const s = new Date(`${mName} ${day1}, ${yr}`);
      const e = new Date(`${mName} ${day2}, ${yr}`);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        return { start: s, end: e };
      }
    }

    // Pattern B: Cross-month range e.g. "Sep 30 – Oct 1, 2026" or "Sep 30, 2026 – Oct 1, 2026"
    const crossMonthMatch = str.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*(?:–|—|-|to)\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
    if (crossMonthMatch) {
      const m1 = crossMonthMatch[1];
      const day1 = Number(crossMonthMatch[2]);
      const m2 = crossMonthMatch[4];
      const day2 = Number(crossMonthMatch[5]);
      const yr2 = crossMonthMatch[6] ? Number(crossMonthMatch[6]) : (crossMonthMatch[3] ? Number(crossMonthMatch[3]) : yrDefault);
      const yr1 = crossMonthMatch[3] ? Number(crossMonthMatch[3]) : yr2;
      const s = new Date(`${m1} ${day1}, ${yr1}`);
      const e = new Date(`${m2} ${day2}, ${yr2}`);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        return { start: s, end: e };
      }
    }

    const directParsed = new Date(str);
    if (!isNaN(directParsed.getTime())) {
      return { start: directParsed, end: directParsed };
    }
    return null;
  };

  // 2. If Staff/Admin explicit scheduled delivery/pickup date is entered on the order
  const explicitDate = order.deliveryDate || order.estimatedDeliveryDate || order.deliverySchedule || order.dispatchDate || order.pickupDate || order.scheduledDate;
  if (explicitDate) {
    if (!isReservation) {
      const refYear = order.createdAt ? new Date(order.createdAt).getFullYear() : new Date().getFullYear();
      const parsedWin = parseNormalOrderDateOrWindow(explicitDate, isNaN(refYear) ? new Date().getFullYear() : refYear);
      if (parsedWin) {
        const rolledWin = rollForwardExpiredNormalWindow(parsedWin.start, parsedWin.end);
        if (rolledWin.rolled) {
          return formatDateOrRange(rolledWin.start, rolledWin.end);
        }
      }
    }
    const parsed = new Date(explicitDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
      return String(explicitDate);
    }
  }

  // Helper to parse any milestone date string / timestamp
  const parseMilestoneDate = (val) => {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    if (typeof val === 'number' && !isNaN(val) && val > 0) return new Date(val);
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return parsed;
    return null;
  };

  // Determine base reference date from actual fulfillment / progression milestone history
  let refDate = null;
  
  // Milestone 1: Shipment dispatched / in-transit
  if (order.dispatchedAt) {
    refDate = parseMilestoneDate(order.dispatchedAt);
  }
  
  // Milestone 2: Shipment prepared / packed
  if (!refDate && order.preparedAt) {
    refDate = parseMilestoneDate(order.preparedAt);
  }

  // Milestone 3: Order Approved / Payment Verified / Processing
  if (!refDate) {
    const approvalCandidate = order.approvedAt || order.approvedDate || order.approvalDate || 
                              order.paymentVerifiedAt || order.paymentVerifiedDate || order.paymentDate ||
                              order.processedAt || order.processingDate;
    if (approvalCandidate) {
      refDate = parseMilestoneDate(approvalCandidate);
    }
  }

  // Milestone 4: Restock / Stock Allocation (for reservations)
  if (!refDate) {
    const allocCandidate = order.restockAllocatedAt || order.actualRestockDate || order.stockAllocatedAt;
    if (allocCandidate) {
      refDate = parseMilestoneDate(allocCandidate);
    }
  }

  // Milestone 5: Check status history from newest to oldest for progression milestone timestamps
  if (!refDate && order.statusHistory && Array.isArray(order.statusHistory)) {
    const historyMilestone = [...order.statusHistory].reverse().find(h => {
      if (!h) return false;
      const s = String(h.status || '').toLowerCase().replace(/_/g, '-');
      const note = String(h.note || '').toLowerCase();
      return ['to-receive', 'ready-for-delivery', 'out-for-delivery', 'dispatched', 'to-ship', 'prepared', 'processing', 'approved', 'payment-verified', 'verified', 'allocated'].some(k => s.includes(k) || note.includes(k));
    });
    if (historyMilestone) {
      refDate = parseMilestoneDate(historyMilestone.changedAt || historyMilestone.date || historyMilestone.timestamp);
    }
  }

  // Milestone 6: Fall back to order creation date
  if (!refDate && order.createdAt) {
    refDate = parseMilestoneDate(order.createdAt);
  }
  if (!refDate && order.dateCreated) {
    refDate = parseMilestoneDate(order.dateCreated);
  }
  if (!refDate && order.timestamp) {
    refDate = parseMilestoneDate(order.timestamp);
  }
  if (!refDate) refDate = new Date();

  // ==================== REGULAR ORDER ESTIMATION ====================
  if (!isReservation) {
    // If an explicit estimatedFulfillmentDate window was stored on a normal order, parse & roll it forward if expired
    if (order.estimatedFulfillmentDate && order.estimatedFulfillmentDate !== 'Waiting for Restock' && order.estimatedFulfillmentDate !== 'Not yet scheduled') {
      const refYear = refDate ? refDate.getFullYear() : new Date().getFullYear();
      const parsedStoredWin = parseNormalOrderDateOrWindow(order.estimatedFulfillmentDate, refYear);
      if (parsedStoredWin) {
        const rolledStored = rollForwardExpiredNormalWindow(parsedStoredWin.start, parsedStoredWin.end);
        return formatDateOrRange(rolledStored.start, rolledStored.end);
      }
    }

    // Regular order (Stock is already available)
    let d1;
    let d2;
    if (isPickup) {
      // PICKUP
      // If already prepared (or status to-receive/ready)
      if (order.preparedAt || oStatus === 'to-receive' || oStatus === 'ready' || order.reservationStatus === 'Ready for Pickup') {
        d1 = addBusinessDays(refDate, 0);
        d2 = addBusinessDays(refDate, 1);
      } else {
        // Processing lead time: 1 to 2 business days
        d1 = addBusinessDays(refDate, 1);
        d2 = addBusinessDays(refDate, 2);
      }
    } else {
      // HOME DELIVERY
      // If already prepared or dispatched
      if (order.preparedAt || order.dispatchedAt || oStatus === 'to-receive') {
        // Shipment transit: 1 to 2 business days from preparation
        d1 = addBusinessDays(refDate, 1);
        d2 = addBusinessDays(refDate, 2);
      } else {
        // Newly placed / Processing: Processing (1 business day) + Transit (1-2 business days) = 2 to 3 business days
        d1 = addBusinessDays(refDate, 2);
        d2 = addBusinessDays(refDate, 3);
      }
    }

    const rolled = rollForwardExpiredNormalWindow(d1, d2);
    return formatDateOrRange(rolled.start, rolled.end);
  }

  // ==================== RESERVATION ESTIMATION ====================
  // Check if actual restock or stock allocation HAS occurred for this reservation
  const isStockAllocated = Boolean(
    order.stockAllocated === true ||
    order.restockAllocatedAt ||
    order.actualRestockDate ||
    (order.allocatedStock && !String(order.allocatedStock).toLowerCase().includes('pending')) ||
    ['to-ship', 'to-receive', 'delivered', 'completed', 'ready_for_processing', 'ready'].includes(oStatus) ||
    ['Ready for Pickup', 'Stock Allocated', 'Ready for Delivery'].includes(order.reservationStatus)
  );

  if (isStockAllocated) {
    // Reservation AFTER Restock: Use actual restock / allocation date as base
    let restockBase = null;
    if (order.restockAllocatedAt) restockBase = parseMilestoneDate(order.restockAllocatedAt);
    else if (order.actualRestockDate) restockBase = parseMilestoneDate(order.actualRestockDate);
    else if (order.stockAllocatedAt) restockBase = parseMilestoneDate(order.stockAllocatedAt);
    else restockBase = refDate;

    if (isPickup) {
      const d1 = addBusinessDays(restockBase, 1);
      const d2 = addBusinessDays(restockBase, 2);
      return formatDateOrRange(d1, d2);
    } else {
      const d1 = addBusinessDays(restockBase, 2);
      const d2 = addBusinessDays(restockBase, 3);
      return formatDateOrRange(d1, d2);
    }
  }

  // BEFORE Restock (Waiting for Stock):
  // Authoritatively determine the projected tentative restock date for this product's upcoming restock
  // without overwriting original historical estimatedFulfillmentDate on the reservation record:
  const fulfillmentRestockDate = calculateReservationFulfillmentRestockDate(order);

  if (fulfillmentRestockDate && !isNaN(fulfillmentRestockDate.getTime())) {
    // Restock batch confirmed -> apply store processing & transit lead time
    if (isPickup) {
      const d1 = addBusinessDays(fulfillmentRestockDate, 1);
      const d2 = addBusinessDays(fulfillmentRestockDate, 2);
      return formatDateOrRange(d1, d2);
    } else {
      const d1 = addBusinessDays(fulfillmentRestockDate, 2);
      const d2 = addBusinessDays(fulfillmentRestockDate, 3);
      return formatDateOrRange(d1, d2);
    }
  }

  if (order.estimatedFulfillmentDate && order.estimatedFulfillmentDate !== 'Waiting for Restock' && order.estimatedFulfillmentDate !== 'Not yet scheduled') {
    return order.estimatedFulfillmentDate;
  }

  // When no reliable estimated restock date can be calculated from available data or deferred beyond predictable restocks
  return 'Waiting for Restock';
}

// ---------------------- ISSUE REPORTING, REPLACEMENT & NOTIFICATIONS ----------------------

export function getIssueReports() {
  return JSON.parse(localStorage.getItem('aurora-issue-reports') || '[]');
}

export function saveIssueReports(reports) {
  setItemAndSync('aurora-issue-reports', JSON.stringify(reports));
}

export function getReplacementOrders() {
  return JSON.parse(localStorage.getItem('aurora-replacement-orders') || '[]');
}

export function saveReplacementOrders(replacements) {
  setItemAndSync('aurora-replacement-orders', JSON.stringify(replacements));
}

export function getNotificationTimestampValue(n) {
  if (!n) return 0;
  
  // 1. Authoritative ISO or numeric timestamp
  if (n.timestamp) {
    if (typeof n.timestamp === 'number' && !isNaN(n.timestamp) && n.timestamp > 0) {
      return n.timestamp;
    }
    const t = new Date(n.timestamp).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  
  // 2. createdAt property
  if (n.createdAt) {
    if (typeof n.createdAt === 'number' && !isNaN(n.createdAt) && n.createdAt > 0) {
      return n.createdAt;
    }
    const t = new Date(n.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 3. Fallback: combined createdDate + createdTime
  if (n.createdDate) {
    const timeStr = n.createdTime ? ` ${n.createdTime}` : '';
    const t = new Date(`${n.createdDate}${timeStr}`).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 4. Date and time properties
  if (n.date) {
    const timeStr = n.time ? ` ${n.time}` : '';
    const t = new Date(`${n.date}${timeStr}`).getTime();
    if (!isNaN(t) && t > 0) return t;
  }

  // 5. Fallback: timestamp embedded in generated ID (e.g. notif-1771319...)
  const notifId = n.id || n.notificationId;
  if (typeof notifId === 'string' && notifId.startsWith('notif-')) {
    const parts = notifId.split('-');
    if (parts[1]) {
      const parsedNum = Number(parts[1]);
      if (!isNaN(parsedNum) && parsedNum > 0) return parsedNum;
    }
  }

  return 0;
}

export function sortNotificationsDescending(notifs) {
  if (!Array.isArray(notifs)) return [];
  return [...notifs].sort((a, b) => {
    const timeA = getNotificationTimestampValue(a);
    const timeB = getNotificationTimestampValue(b);
    return timeB - timeA;
  });
}

export function getNotifications() {
  const notifs = JSON.parse(localStorage.getItem('aurora-notifications') || '[]');
  if (!Array.isArray(notifs)) return [];
  const normalized = notifs.map(n => {
    if (!n) return n;
    const isRead = Boolean(n.read === true || n.isRead === true);
    return { ...n, read: isRead, isRead: isRead };
  });
  return sortNotificationsDescending(normalized);
}

export function saveNotifications(notifs, targetDocInfo = null) {
  const normalized = Array.isArray(notifs) ? notifs.map(n => {
    if (!n) return n;
    const isRead = Boolean(n.read === true || n.isRead === true);
    return { ...n, read: isRead, isRead: isRead };
  }) : notifs;
  setItemAndSync('aurora-notifications', JSON.stringify(normalized), targetDocInfo);
}

export function addNotification(userId, title, message, extra = {}) {
  // Admins and Staff should NOT receive notifications for actions they themselves perform,
  // except for automatic system deadline cancellations and stock alerts.
  // Note: Incoming customer events (new reservations, new customer orders, customer payments, inquiries)
  // are NOT admin-initiated actions and must ALWAYS notify Admin/Staff.
  const activeAdmin = getCurrentAdmin();
  const role = extra.role || (userId === 'admin' ? 'admin' : 'customer');
  const type = extra.type || 'info';
  const isSystemAuto = Boolean(extra.isSystemAuto || String(title || '').includes('Auto-Cancellation'));
  const isIncomingCustomerEvent = type === 'reservation' || 
                                  type === 'new-order' || 
                                  type === 'payment' || 
                                  type === 'inquiry' || 
                                  String(title || '').toLowerCase().includes('reservation') || 
                                  String(title || '').toLowerCase().includes('new order') || 
                                  Boolean(extra.isCustomerAction);

  if (activeAdmin && !isIncomingCustomerEvent && (userId === 'admin' || role === 'admin' || role === 'staff') && type !== 'stock' && !isSystemAuto) {
    console.log('[NOTIFICATION SUPPRESSED] Suppressed admin/staff notification for admin-initiated action:', title);
    return;
  }

  const notifs = getNotifications();
  const now = new Date();
  
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const formattedDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Deduplication / Idempotency check:
  // If an exact eventKey, notificationId, or duplicate identical order event already exists, prevent re-insertion.
  const eventKey = extra.eventKey || (extra.notificationId ? String(extra.notificationId) : null);
  if (eventKey) {
    const alreadyExists = notifs.some(n => 
      n.id === eventKey || 
      n.notificationId === eventKey || 
      n.eventKey === eventKey ||
      (n.id && String(n.id).startsWith(eventKey)) ||
      (n.notificationId && String(n.notificationId).startsWith(eventKey)) ||
      (extra.notificationId && (n.id === extra.notificationId || n.notificationId === extra.notificationId))
    );
    if (alreadyExists) {
      return;
    }
  }

  // Check for duplicate identical message & target within existing records
  const isDuplicate = notifs.some(n => 
    String(n.userId) === String(userId) &&
    n.title === title &&
    n.message === message &&
    (extra.orderId ? String(n.orderId) === String(extra.orderId) : true) &&
    (extra.reservationId ? String(n.reservationId) === String(extra.reservationId) : true)
  );
  if (isDuplicate) {
    return;
  }

  // 1. Resolve exact targetId / recordId
  let rawRecordId = extra.targetId || extra.recordId || extra.reservationId || extra.orderId || extra.productId || null;
  if (!rawRecordId && message) {
    rawRecordId = extractId(message, 'RES-') || extractId(message, 'res-') || extractId(message, 'ORD-') || extractId(message, 'RF');
    if (!rawRecordId) {
      const match = message.match(/#(RES-\d+|ORD-\d+|RF\d+|\d+)/i);
      if (match) rawRecordId = match[1];
    }
  }
  const targetId = rawRecordId ? String(rawRecordId) : null;
  const recordId = targetId;

  // 2. Resolve exact targetType / recordType
  let targetType = extra.targetType || extra.recordType;
  if (!targetType) {
    if (extra.reservationId || type === 'reservation' || (targetId && String(targetId).toUpperCase().startsWith('RES-')) || (title && String(title).toLowerCase().includes('reservation')) || (message && String(message).toLowerCase().includes('reservation'))) {
      targetType = 'reservation';
    } else if (extra.orderId || type === 'order' || (targetId && (String(targetId).toUpperCase().startsWith('ORD-') || String(targetId).toUpperCase().startsWith('RF')))) {
      targetType = 'order';
    } else if (type === 'stock' || extra.productId) {
      targetType = 'product';
    } else if (type === 'inquiry' || (targetId && String(targetId).startsWith('msg-'))) {
      targetType = 'contact';
    } else {
      targetType = 'order';
    }
  }
  const recordType = targetType;

  // 3. Resolve destinationTab
  let destinationTab = extra.destinationTab || extra.tab || null;

  const newNotif = (targetUserId, targetRole) => {
    const uniqueNotifId = extra.notificationId || extra.id || (eventKey ? `${eventKey}-${targetRole}-${targetUserId}` : ('notif-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '-' + targetRole + '-' + targetUserId));
    return {
      id: uniqueNotifId,
      notificationId: uniqueNotifId,
      eventKey: eventKey || uniqueNotifId,
      targetType: targetType,
      targetId: targetId,
      recordType: recordType,
      recordId: recordId,
      customerId: extra.customerId || targetUserId,
      userId: targetUserId,
      role: targetRole,
      orderId: extra.orderId || (targetType === 'order' ? targetId : null),
      reservationId: extra.reservationId || (targetType === 'reservation' ? targetId : null),
      issueReportId: extra.issueReportId || null,
      productId: extra.productId || null,
      destinationTab: destinationTab,
      type: type,
      title: title,
      message: message,
      read: false,
      isRead: false,
      scrollPayment: Boolean(extra.scrollPayment),
      createdDate: extra.createdDate || formattedDate,
      createdTime: extra.createdTime || formattedTime,
      timestamp: extra.timestamp || now.toISOString()
    };
  };

  let primaryCreatedNotif = null;
  if (userId === 'admin' || role === 'admin') {
    // Add for administrator
    const adminNotif = newNotif('admin', 'admin');
    primaryCreatedNotif = adminNotif;
    notifs.unshift(adminNotif);
    
    // Also add for each staff member!
    const adminUsers = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
    adminUsers.forEach(user => {
      if (user.role === 'staff') {
        notifs.unshift(newNotif(user.id, 'staff'));
      }
    });
  } else {
    // Standard customer or specific staff/admin notification
    const custNotif = newNotif(userId, role);
    primaryCreatedNotif = custNotif;
    notifs.unshift(custNotif);
  }

  if (primaryCreatedNotif) {
    saveNotifications(notifs, { colName: 'notifications', docId: primaryCreatedNotif.id, docData: primaryCreatedNotif });
  } else {
    saveNotifications(notifs);
  }
}

export function markNotificationAsRead(id, targetUserId = null, targetRole = null) {
  if (!id) return;
  const notifs = getNotifications();
  let idx = -1;

  if (targetUserId || targetRole) {
    idx = notifs.findIndex(n => 
      (n.id === id || n.notificationId === id) &&
      (!targetRole || n.role === targetRole) &&
      (!targetUserId || String(n.userId) === String(targetUserId))
    );
  }

  if (idx === -1) {
    idx = notifs.findIndex(n => n.id === id || n.notificationId === id);
  }

  if (idx !== -1) {
    notifs[idx].read = true;
    notifs[idx].isRead = true;
    const targetDoc = notifs[idx];
    saveNotifications(notifs, { colName: 'notifications', docId: targetDoc.id || id, docData: targetDoc });
  }
}

export function markAllNotificationsAsRead(role, userId = null) {
  const notifs = getNotifications();
  let changed = false;
  const updatedDocs = [];
  notifs.forEach(n => {
    const roleMatches = n.role === role;
    const userMatches = !userId || String(n.userId) === String(userId);
    if (roleMatches && userMatches) {
      if (!n.read || !n.isRead) {
        n.read = true;
        n.isRead = true;
        changed = true;
        updatedDocs.push(n);
      }
    }
  });
  if (changed) {
    saveNotifications(notifs);
    updatedDocs.forEach(doc => {
      if (typeof saveFirestoreDoc === 'function') {
        saveFirestoreDoc('notifications', doc.id || doc.notificationId, doc).catch(() => {});
      }
    });
  }
}

// Global Storage Synchronizer for Multitab reactivity
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('aurora-')) {
      window.dispatchEvent(new CustomEvent('aurora-sync-event', { detail: { key: e.key } }));
    }
    if (!e.key || e.key.startsWith('settings-gcash') || e.key === 'aurora-store-settings') {
      applyGcashSettings();
    }
  });
  window.addEventListener('aurora-sync-event', (e) => {
    if (!e.detail || !e.detail.key || e.detail.key.startsWith('settings-gcash') || e.detail.key === 'aurora-store-settings' || e.detail.key === 'settings-store-logo') {
      applyGcashSettings();
      const s = getStoreSettings();
      if (s.logo) {
        const navLogo = document.getElementById('navbar-store-logo');
        if (navLogo) {
          if (navLogo.src !== s.logo) navLogo.src = s.logo;
        } else if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
          try { renderLayout(); } catch (_) {}
        }
        const footLogo = document.getElementById('footer-store-logo');
        if (footLogo && footLogo.src !== s.logo) {
          footLogo.src = s.logo;
        }
      }
    }
    if (e.detail && (e.detail.key === 'aurora-user' || e.detail.key === 'aurora-logged-in')) {
      if (typeof document !== 'undefined' && document.getElementById('navbar-container')) {
        try { renderLayout(); } catch (_) {}
      }
    }
    if (
      e.detail &&
      (e.detail.key === 'aurora-orders' ||
        e.detail.key === 'aurora-notifications' ||
        e.detail.key === 'aurora-activity-logs')
    ) {
      try {
        checkAndCancelExpiredPaymentRejections();
      } catch (_) {}
    }
  });
}

// ---------------------- STOREFRONT CUSTOMIZATION SETTINGS ----------------------

export function getStoreSettings() {
  if (typeof window === 'undefined') {
    return {
      storeName: 'Aurora Local Rice',
      tagline: 'Fresh Quality Rice Delivered to Your Doorstep',
      description: 'Aurora Local Rice provides high-quality rice products for households, retailers, and bulk buyers across Aurora, Zamboanga del Sur.',
      contactNumber: '+63 912 345 6789',
      storeAddress: 'Aurora, Zamboanga del Sur, Philippines',
      facebookLink: 'https://facebook.com/auroralocalrice',
      businessHours: '8:00 AM - 5:00 PM (Monday - Saturday)',
      logo: './rice_logo.jpg',
      banner: 'https://static.vecteezy.com/system/resources/thumbnails/047/128/443/small/a-bag-of-rice-is-sitting-on-a-wooden-table-with-a-bunch-of-rice-on-the-table-photo.jpg',
      gcashName: 'Aurora Rice Store',
      gcashNumber: '09123456789',
      gcashQr: ''
    };
  }
  const p = getPathPrefix();
  let cloudSettings = {};
  try {
    const raw = localStorage.getItem('aurora-store-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cloudSettings = parsed[0];
      } else if (parsed && typeof parsed === 'object') {
        cloudSettings = parsed;
      }
    }
  } catch (e) {}

  return {
    storeName: localStorage.getItem('settings-store-name') || cloudSettings.storeName || 'Aurora Local Rice',
    tagline: localStorage.getItem('settings-store-tagline') || cloudSettings.tagline || 'Fresh Quality Rice Delivered to Your Doorstep',
    description: localStorage.getItem('settings-store-description') || cloudSettings.description || 'Aurora Local Rice provides high-quality rice products for households, retailers, and bulk buyers across Aurora, Zamboanga del Sur.',
    contactNumber: localStorage.getItem('settings-contact-number') || cloudSettings.contactNumber || '+63 912 345 6789',
    storeAddress: localStorage.getItem('settings-store-address') || cloudSettings.storeAddress || 'Aurora, Zamboanga del Sur, Philippines',
    facebookLink: localStorage.getItem('settings-facebook-link') || cloudSettings.facebookLink || '',
    businessHours: localStorage.getItem('settings-business-hours') || cloudSettings.businessHours || '8:00 AM - 5:00 PM (Monday - Saturday)',
    logo: localStorage.getItem('settings-store-logo') || cloudSettings.logo || (p + 'rice_logo.jpg'),
    banner: localStorage.getItem('settings-store-banner') || cloudSettings.banner || 'https://static.vecteezy.com/system/resources/thumbnails/047/128/443/small/a-bag-of-rice-is-sitting-on-a-wooden-table-with-a-bunch-of-rice-on-the-table-photo.jpg',
    gcashName: localStorage.getItem('settings-gcash-name') || cloudSettings.gcashName || 'Aurora Rice Store',
    gcashNumber: localStorage.getItem('settings-gcash-number') || cloudSettings.gcashNumber || '09123456789',
    gcashQr: localStorage.getItem('settings-gcash-qr') || cloudSettings.gcashQr || ''
  };
}

export function applyGcashSettings() {
  if (typeof document === 'undefined') return;
  const s = getStoreSettings();
  
  // Update GCash Account Name references
  const gcashAcc = document.getElementById('gcash-account-name');
  if (gcashAcc && s.gcashName) {
    gcashAcc.textContent = s.gcashName;
  }
  
  // Update GCash Number references
  const gcashNum = document.getElementById('gcash-number-lbl');
  if (gcashNum && s.gcashNumber) {
    gcashNum.textContent = s.gcashNumber;
  }
  
  // Update GCash QR Code image references
  const gcashQr = document.getElementById('gcash-qr-img');
  if (gcashQr) {
    const fallbackQrSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 150 150'><rect width='100%' height='100%' fill='%23f9fafb' rx='12'/><rect x='8' y='8' width='134' height='134' fill='none' stroke='%23e5e7eb' stroke-width='2' stroke-dasharray='6,4' rx='8'/><text x='50%' y='45%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui, -apple-system, sans-serif' font-size='10' font-weight='bold' fill='%239ca3af'>No GCash QR</text><text x='50%' y='60%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui, -apple-system, sans-serif' font-size='10' font-weight='bold' fill='%239ca3af'>Code Available</text></svg>`;
    if (s.gcashQr && s.gcashQr.trim() !== '') {
      gcashQr.src = s.gcashQr;
    } else if (s.gcashNumber && s.gcashNumber.trim() !== '') {
      const cleanNum = s.gcashNumber.replace(/\s+/g, '');
      gcashQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(cleanNum)}`;
    } else {
      gcashQr.src = fallbackQrSvg;
    }
  }

  // Dynamic document title update
  if (typeof document !== 'undefined' && document.title && document.title.includes('Aurora Local Rice') && s.storeName) {
    document.title = document.title.replace('Aurora Local Rice', s.storeName);
  }
}

// ---------------------- NAVIGATION & LAYOUT RENDERER ----------------------

export function getPathPrefix() {
  if (typeof window === 'undefined') return './';
  const isSubFolder = window.location.pathname.includes('/admin/');
  return isSubFolder ? '../' : './';
}

export function initReviewReminderPopup() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Do not show on admin pages
  if (window.location.pathname.includes('/admin/')) return;
  // Do not show on auth pages
  if (window.location.pathname.includes('login.html') || window.location.pathname.includes('register.html') || window.location.pathname.includes('reset-password.html')) return;

  const user = getCurrentUser();
  if (!user || !user.id) return;

  // Don't show if already on review submission flow for this order
  const currentParams = new URLSearchParams(window.location.search);
  const currentOrderIdInUrl = currentParams.get('orderId');

  const orders = getOrders();
  const userOrders = orders.filter(o => isOrderEligibleForReview(o, user));

  if (userOrders.length === 0) return;

  // Find first eligible order not fully reviewed and not dismissed in this session
  const pendingOrder = userOrders.find(o => {
    if (currentOrderIdInUrl && String(o.id) === String(currentOrderIdInUrl)) {
      return false; // already on this order's review page
    }
    const isDismissed = sessionStorage.getItem('riceflow_review_reminder_dismissed_' + o.id);
    if (isDismissed === 'true') return false;
    return !isOrderFullyReviewed(o.id, user.id);
  });

  if (!pendingOrder) return;

  // Check if popup already exists in DOM
  if (document.getElementById('riceflow-review-reminder-popup')) return;

  const p = getPathPrefix();

  const popupEl = document.createElement('div');
  popupEl.id = 'riceflow-review-reminder-popup';
  popupEl.className = 'fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 max-w-sm w-[calc(100%-2.5rem)] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl p-4 sm:p-5 animate-in fade-in slide-in-from-bottom duration-300 select-none';
  popupEl.innerHTML = `
    <div class="flex items-start gap-3.5">
      <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-xl shrink-0">
        ⭐
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="text-sm font-black text-[#111827] dark:text-white leading-tight">How was your order?</h4>
        <p class="text-xs text-[#111827] dark:text-white mt-1 leading-relaxed">
          We'd love to hear about your experience with Order #${pendingOrder.id}.
        </p>
        <div class="flex items-center gap-2 mt-3.5">
          <button id="btn-review-reminder-rate" class="px-3.5 py-1.5 bg-[#1E6C02] hover:bg-[#145001] text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs">
            Rate Now
          </button>
          <button id="btn-review-reminder-dismiss" class="px-3 py-1.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-[#111827] dark:text-white text-xs font-semibold rounded-lg cursor-pointer transition-all">
            Not Now
          </button>
        </div>
      </div>
      <button id="btn-review-reminder-close" class="text-[#111827] dark:text-white hover:text-[#1E6C02] p-1 -mr-1 -mt-1 cursor-pointer bg-transparent border-none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `;

  document.body.appendChild(popupEl);

  const rateBtn = document.getElementById('btn-review-reminder-rate');
  const dismissBtn = document.getElementById('btn-review-reminder-dismiss');
  const closeBtn = document.getElementById('btn-review-reminder-close');

  const handleDismiss = () => {
    sessionStorage.setItem('riceflow_review_reminder_dismissed_' + pendingOrder.id, 'true');
    popupEl.remove();
  };

  dismissBtn?.addEventListener('click', handleDismiss);
  closeBtn?.addEventListener('click', handleDismiss);

  rateBtn?.addEventListener('click', () => {
    window.location.href = `${p}reviews.html?orderId=${encodeURIComponent(pendingOrder.id)}`;
  });
}

function applyThemeState(isDark, animateTransition = false) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (animateTransition && root && root.classList) {
    root.classList.add('theme-transitioning');
    if (typeof window !== 'undefined') {
      if (window.__riceflowThemeTransitionTimer) {
        clearTimeout(window.__riceflowThemeTransitionTimer);
      }
      window.__riceflowThemeTransitionTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning');
      }, 260);
    }
  }
  if (root && root.classList) {
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  }
  if (document.body && document.body.classList) {
    document.body.classList.toggle('dark', isDark);
  }
}

export function renderLayout() {
  const isDark = typeof localStorage !== 'undefined' ? (localStorage.getItem('aurora-dark-mode') === 'true') : false;
  applyThemeState(isDark, false);
  const settings = getStoreSettings();
  const headerContainer = document.getElementById('navbar-container');
  const footerContainer = document.getElementById('footer-container');
  const user = getCurrentUser();
  const cart = getCart();
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const p = getPathPrefix();

  // 1. DYNAMIC HEADER
  if (headerContainer) {
    const isProfilePage = window.location.pathname.includes('profile.html');
    const isProductsPage = window.location.pathname.includes('products.html');
    const isContactPage = window.location.pathname.includes('contact.html');
    const isReviewsPage = window.location.pathname.includes('reviews.html');

    headerContainer.className = "bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 sticky top-0 z-40 shadow-sm transition-colors";
    headerContainer.innerHTML = `
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        <!-- Logo and brand -->
        <a href="${p}index.html" class="flex items-center group decoration-none">
          <div class="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-gray-150 shrink-0">
            <img id="navbar-store-logo" src="${settings.logo}" alt="${settings.storeName} Logo" class="w-full h-full object-cover" />
          </div>
        </a>

        <!-- Desktop Navigation Items -->
        <nav class="hidden md:flex items-center gap-8 font-semibold text-[#111827] dark:text-white">
          <a href="${p}index.html" class="hover:text-[#1E6C02] transition-colors ${window.location.pathname.endsWith('index.html') || window.location.pathname === '/' ? 'text-[#1E6C02] border-b-2 border-[#1E6C02] pb-1' : ''}">Home</a>
          <a href="${p}products.html" class="hover:text-[#1E6C02] transition-colors ${isProductsPage ? 'text-[#1E6C02] border-b-2 border-[#1E6C02] pb-1' : ''}">Rice Products</a>
          <a href="${p}reviews.html" class="hover:text-[#1E6C02] transition-colors ${isReviewsPage ? 'text-[#1E6C02] border-b-2 border-[#1E6C02] pb-1' : ''}">Reviews</a>
          <a href="${p}contact.html" class="hover:text-[#1E6C02] transition-colors ${isContactPage ? 'text-[#1E6C02] border-b-2 border-[#1E6C02] pb-1' : ''}">Contact Us</a>
        </nav>

        <!-- Search Bar and Action Controls -->
        <div class="flex items-center gap-4">
          <!-- Desktop Search -->
          <div class="relative hidden sm:block w-64">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#111827] dark:text-white pointer-events-none">${ICONS.search}</span>
            <input 
              id="top-search-input"
              type="search" 
              name="rice_catalog_search"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-lpignore="true"
              data-form-type="other"
              placeholder="Search rice products..." 
              class="w-full pl-11 pr-10 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[#111827] dark:text-white placeholder:text-[#111827]/80 dark:placeholder:text-white rounded-xl font-medium outline-none text-sm focus:bg-white dark:focus:bg-slate-700 focus:ring-2 focus:ring-[#1E6C02]/20 focus:border-[#1E6C02] transition-all"
            />
            <button 
              id="top-search-clear" 
              class="absolute right-3 top-1/2 -translate-y-1/2 text-[#111827] dark:text-white hover:text-[#1E6C02] transition-colors hidden cursor-pointer flex items-center justify-center p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700"
              aria-label="Clear Search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <!-- Night Mode Toggle Button -->
          <button id="customer-dark-mode-toggle" class="flex items-center justify-center p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200/60 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-xs font-bold text-[#111827] dark:text-white transition-all cursor-pointer" title="Toggle Day/Night Mode">
            <span id="customer-dark-mode-icon" class="w-4 h-4 flex items-center justify-center shrink-0"></span>
          </button>

          <!-- Checkout Cart -->
          <a href="${p}cart.html" class="relative p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600 transition-colors cursor-pointer text-[#111827] dark:text-white">
            ${ICONS.shoppingBag}
            ${cartCount > 0 ? `<span class="absolute -top-1.5 -right-1.5 bg-[#1E6C02] text-white font-bold text-[11px] w-5.5 h-5.5 rounded-full flex items-center justify-center animate-pulse border-2 border-white dark:border-slate-900">${cartCount}</span>` : ''}
          </a>

          ${user ? `
            <!-- Customer Notification Bell Icon -->
            <div class="relative flex items-center">
              <button id="customer-notif-btn" class="relative p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600 transition-colors cursor-pointer text-[#111827] dark:text-white flex items-center justify-center focus:outline-none">
                ${ICONS.bell}
                <span id="customer-notif-badge" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white font-black text-[9px] min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 hidden">0</span>
              </button>
              
              <!-- Dropdown Panel (hidden by default) -->
              <div id="customer-notif-dropdown" class="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-20 sm:top-full mt-2 sm:mt-3.5 w-auto sm:w-96 max-w-[calc(100vw-1.5rem)] sm:max-w-none bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 hidden flex flex-col overflow-hidden max-h-[calc(100vh-100px)] sm:max-h-[520px]">
                <div class="p-3.5 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between bg-gray-50/90 dark:bg-slate-800/80 shrink-0">
                  <div class="flex items-center gap-2">
                    <span class="font-extrabold text-sm text-[#111827] dark:text-white">Notifications</span>
                  </div>
                  <button id="customer-notif-mark-all" class="text-xs font-bold text-[#1E6C02] dark:text-emerald-400 hover:text-[#145001] dark:hover:text-emerald-300 transition-colors cursor-pointer focus:outline-none">Mark all as read</button>
                </div>

                <!-- Notification Filter Controls: All / Unread / Read -->
                <div id="customer-notif-filter-bar" class="px-3 py-2 bg-gray-100/70 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-800 flex items-center gap-1.5 shrink-0">
                  <button type="button" data-filter="all" class="customer-notif-filter-btn notif-filter-active flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                    <span>All</span>
                    <span id="notif-count-all" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                  </button>
                  <button type="button" data-filter="unread" class="customer-notif-filter-btn flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                    <span>Unread</span>
                    <span id="notif-count-unread" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                  </button>
                  <button type="button" data-filter="read" class="customer-notif-filter-btn flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                    <span>Read</span>
                    <span id="notif-count-read" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                  </button>
                </div>

                <div id="customer-notif-list" class="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-slate-800 max-h-[360px]">
                  <!-- Dynamic Notifications -->
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Profile / Logging -->
          ${user ? `
            <a href="${p}profile.html" class="flex items-center justify-center p-1 rounded-full border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors" title="My Profile">
              <div class="w-9 h-9 rounded-full overflow-hidden bg-[#1E6C02] text-white flex items-center justify-center font-bold text-sm select-none">
                ${user.profilePicture ? `<img src="${user.profilePicture}" class="w-full h-full object-cover" alt="Profile" />` : (() => {
                  const rawName = (user.fullName || user.name || 'User').trim();
                  const firstName = rawName.split(/\s+/)[0] || 'U';
                  return (firstName[0] || 'U').toUpperCase();
                })()}
              </div>
            </a>
          ` : `
            <a href="${p}login.html" class="bg-[#1E6C02] hover:bg-[#145001] text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-md shadow-green-900/10 cursor-pointer">
              Login
            </a>
          `}

          <!-- Mobile drawer toggle button -->
          <button id="mobile-menu-toggle" class="p-2 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 text-[#111827] dark:text-white md:hidden transition-colors cursor-pointer">
            ${ICONS.menu}
          </button>
        </div>
      </div>

      <!-- Mobile navigation panel drawer -->
      <div id="mobile-drawer" class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 transition-opacity hidden">
        <div class="fixed top-0 bottom-0 right-0 w-80 bg-white dark:bg-slate-900 shadow-2xl flex flex-col justify-between p-6">
          <div>
            <div class="flex items-center justify-between mb-8 pb-4 border-b border-gray-100 dark:border-slate-800">
              <span class="text-xl font-bold text-[#111827] dark:text-white">Menu</span>
              <button id="mobile-drawer-close" class="p-2 border border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg text-[#111827] dark:text-white cursor-pointer">
                ${ICONS.close}
              </button>
            </div>

            <!-- Mobile Search -->
            <div class="relative w-full mb-6 max-h-[44px]">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#111827] dark:text-white font-bold">${ICONS.search}</span>
              <input 
                id="mobile-search-input"
                type="search" 
                name="mobile_rice_catalog_search"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                data-lpignore="true"
                data-form-type="other"
                placeholder="Search products..." 
                class="w-full pl-11 pr-10 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl text-sm outline-none text-[#111827] dark:text-white placeholder:text-[#111827]/80 dark:placeholder:text-white focus:bg-white dark:focus:bg-slate-700 focus:ring-2 focus:ring-[#1E6C02]/20 focus:border-[#1E6C02] transition-all"
              />
              <button 
                id="mobile-search-clear" 
                class="absolute right-3 top-1/2 -translate-y-1/2 text-[#111827] dark:text-white hover:text-[#1E6C02] transition-colors hidden cursor-pointer flex items-center justify-center p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700"
                aria-label="Clear Search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <nav class="flex flex-col gap-4 font-bold text-lg text-[#111827] dark:text-white">
              <a href="${p}index.html" class="hover:text-[#1E6C02]">Home</a>
              <a href="${p}products.html" class="hover:text-[#1E6C02]">Rice Products</a>
              <a href="${p}reviews.html" class="hover:text-[#1E6C02]">Reviews</a>
              <a href="${p}contact.html" class="hover:text-[#1E6C02]">Contact Us</a>
              ${user ? `<a href="${p}profile.html" class="hover:text-[#1E6C02] flex items-center justify-between">My Account <span class="bg-[#1E6C02] text-white text-[10px] uppercase font-bold py-1 px-2.5 rounded-full">Dashboard</span></a>` : ''}
            </nav>
          </div>

          <div class="pt-4 border-t border-gray-100 dark:border-slate-800 space-y-4">
            ${user ? `
              <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-full bg-[#1E6C02] text-white flex items-center justify-center font-bold text-base overflow-hidden shrink-0 select-none">
                  ${user.profilePicture ? `<img src="${user.profilePicture}" class="w-full h-full object-cover" alt="Profile" />` : (() => {
                    const rawName = (user.fullName || user.name || 'User').trim();
                    const firstName = rawName.split(/\s+/)[0] || 'U';
                    return (firstName[0] || 'U').toUpperCase();
                  })()}
                </div>
                <div>
                  <h4 class="font-bold text-[#111827] dark:text-white leading-tight">${user.fullName}</h4>
                  <p class="text-xs text-[#111827] dark:text-white font-normal">${user.email}</p>
                </div>
              </div>
              <button id="mobile-btn-logout" class="w-full py-3 border border-red-500 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 font-bold flex justify-center items-center gap-2 transition-colors cursor-pointer">
                ${ICONS.logout}
                Logout
              </button>
            ` : `
              <a href="${p}login.html" class="block w-full text-center py-3.5 bg-[#1E6C02] hover:bg-[#145001] text-white font-bold rounded-xl shadow-lg shadow-green-900/10">
                Log In
              </a>
              <a href="${p}register.html" class="block w-full text-center py-3.5 border border-gray-200 dark:border-slate-700 text-[#111827] dark:text-white hover:bg-gray-50 dark:hover:bg-slate-800 font-bold rounded-xl">
                Create Account
              </a>
            `}
          </div>
        </div>
      </div>
    `;

    // 1b. Mobile header toggle listeners
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const closeBtn = document.getElementById('mobile-drawer-close');
    const drawer = document.getElementById('mobile-drawer');

    if (toggleBtn && closeBtn && drawer) {
      toggleBtn.addEventListener('click', () => drawer.classList.remove('hidden'));
      closeBtn.addEventListener('click', () => drawer.classList.add('hidden'));
      // Close outside click
      drawer.addEventListener('click', (e) => {
        if (e.target === drawer) drawer.classList.add('hidden');
      });
    }

    // 1c. Search listeners
    const topSearch = document.getElementById('top-search-input');
    const mobileSearch = document.getElementById('mobile-search-input');
    const topClear = document.getElementById('top-search-clear');
    const mobileClear = document.getElementById('mobile-search-clear');

    // Ensure search fields start blank on non-products pages and clear accidental search/focus URL parameters
    if (!isProductsPage) {
      if (topSearch) topSearch.value = '';
      if (mobileSearch) mobileSearch.value = '';
      if (typeof window !== 'undefined' && window.location.search) {
        try {
          const curUrl = new URL(window.location.href);
          if (curUrl.searchParams.has('search') || curUrl.searchParams.has('focus')) {
            curUrl.searchParams.delete('search');
            curUrl.searchParams.delete('focus');
            window.history.replaceState(null, '', curUrl.pathname + (curUrl.search ? curUrl.search : ''));
          }
        } catch (_) {}
      }
    }

    const handleSearchInput = (e) => {
      const val = e.target.value;
      if (isProductsPage) {
        // Synchronize inputs
        if (e.target === topSearch && mobileSearch) mobileSearch.value = val;
        if (e.target === mobileSearch && topSearch) topSearch.value = val;

        // Toggle clear buttons
        if (val) {
          if (topClear) topClear.classList.remove('hidden');
          if (mobileClear) mobileClear.classList.remove('hidden');
        } else {
          if (topClear) topClear.classList.add('hidden');
          if (mobileClear) mobileClear.classList.add('hidden');
        }
      } else {
        // Not on products page -> NEVER automatically redirect on raw input events!
        // Sync desktop/mobile search fields and toggle clear buttons without navigating away.
        if (e.target === topSearch && mobileSearch) mobileSearch.value = val;
        if (e.target === mobileSearch && topSearch) topSearch.value = val;
        if (val) {
          if (topClear) topClear.classList.remove('hidden');
          if (mobileClear) mobileClear.classList.remove('hidden');
        } else {
          if (topClear) topClear.classList.add('hidden');
          if (mobileClear) mobileClear.classList.add('hidden');
        }
      }
    };

    const handleClearClick = () => {
      if (topSearch) topSearch.value = '';
      if (mobileSearch) mobileSearch.value = '';
      if (topClear) topClear.classList.add('hidden');
      if (mobileClear) mobileClear.classList.add('hidden');

      if (isProductsPage) {
        // Dispatch input event to refresh list
        if (topSearch) {
          topSearch.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Restore standard URL
        const url = new URL(window.location.href);
        url.searchParams.delete('search');
        url.searchParams.delete('focus');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    };

    if (topSearch) {
      topSearch.addEventListener('input', handleSearchInput);
      topSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (topSearch.value.trim()) {
            window.location.href = `${p}products.html?search=${encodeURIComponent(topSearch.value.trim())}`;
          }
        }
      });
    }

    if (mobileSearch) {
      mobileSearch.addEventListener('input', handleSearchInput);
      mobileSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (mobileSearch.value.trim()) {
            window.location.href = `${p}products.html?search=${encodeURIComponent(mobileSearch.value.trim())}`;
          }
        }
      });
    }

    if (topClear) {
      topClear.addEventListener('click', (e) => {
        e.preventDefault();
        handleClearClick();
      });
    }

    if (mobileClear) {
      mobileClear.addEventListener('click', (e) => {
        e.preventDefault();
        handleClearClick();
      });
    }

    const mLogout = document.getElementById('mobile-btn-logout');
    if (mLogout) {
      mLogout.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (drawer) drawer.classList.add('hidden');
        openCustomerLogoutModal();
      };
    }

    // --- DARK MODE TOGGLE LOGIC ---
    function updateCustomerDarkModeUI(isDarkVal) {
      const toggleBtn = document.getElementById('customer-dark-mode-toggle');
      const iconSpan = document.getElementById('customer-dark-mode-icon');
      const textSpan = document.getElementById('customer-dark-mode-text');
      
      const mobToggleBtn = document.getElementById('mobile-customer-dark-mode-toggle');
      const mobIconSpan = document.getElementById('mobile-customer-dark-mode-icon');
      const mobTextSpan = document.getElementById('mobile-customer-dark-mode-text');

      const sunSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-amber-500"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      const moonSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-slate-700"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

      if (isDarkVal) {
        if (iconSpan) iconSpan.innerHTML = sunSvg;
        if (textSpan) textSpan.textContent = 'Day Mode';
        if (toggleBtn) {
          toggleBtn.classList.remove('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
          toggleBtn.classList.add('bg-gray-800', 'text-gray-200', 'border-gray-700');
        }

        if (mobIconSpan) mobIconSpan.innerHTML = sunSvg;
        if (mobTextSpan) mobTextSpan.textContent = 'Day Mode';
        if (mobToggleBtn) {
          mobToggleBtn.classList.remove('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
          mobToggleBtn.classList.add('bg-gray-800', 'text-gray-200', 'border-gray-700');
        }
      } else {
        if (iconSpan) iconSpan.innerHTML = moonSvg;
        if (textSpan) textSpan.textContent = 'Night Mode';
        if (toggleBtn) {
          toggleBtn.classList.add('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
          toggleBtn.classList.remove('bg-gray-800', 'text-gray-200', 'border-gray-700');
        }

        if (mobIconSpan) mobIconSpan.innerHTML = moonSvg;
        if (mobTextSpan) mobTextSpan.textContent = 'Night Mode';
        if (mobToggleBtn) {
          mobToggleBtn.classList.add('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
          mobToggleBtn.classList.remove('bg-gray-800', 'text-gray-200', 'border-gray-700');
        }
      }
    }

    // Set initial toggle state
    updateCustomerDarkModeUI(isDark);

    const toggleDarkModeAction = () => {
      const currentDark = localStorage.getItem('aurora-dark-mode') === 'true';
      const newDark = !currentDark;
      localStorage.setItem('aurora-dark-mode', newDark ? 'true' : 'false');
      applyThemeState(newDark, true);
      updateCustomerDarkModeUI(newDark);
    };

    const dToggle = document.getElementById('customer-dark-mode-toggle');
    if (dToggle) {
      dToggle.addEventListener('click', toggleDarkModeAction);
    }

    const mToggle = document.getElementById('mobile-customer-dark-mode-toggle');
    if (mToggle) {
      mToggle.addEventListener('click', toggleDarkModeAction);
    }
  }

  // 2. DYNAMIC FOOTER
  if (footerContainer) {
    footerContainer.className = "bg-[#193317] text-[#E8F5E9] py-12 text-sm border-t border-[#142C12]";
    footerContainer.innerHTML = `
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <div class="flex items-center gap-2 mb-4">
            <div class="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center shadow-sm shrink-0">
              <img id="footer-store-logo" src="${settings.logo}" alt="${settings.storeName} Logo" class="w-full h-full object-cover" />
            </div>
            <span class="text-xl font-bold text-white">${settings.storeName}</span>
          </div>
          <p class="text-green-100/70 leading-relaxed mb-4 font-medium">${settings.description}</p>
          <p class="text-xs text-green-100/40">© 2026 ${settings.storeName}. All rights reserved.</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-4 uppercase tracking-wider text-xs">Categories</h4>
          <ul class="space-y-2 text-green-100/80 font-medium">
            <li><a href="${p}products.html?type=White" class="hover:text-white transition-colors">White Rice</a></li>
            <li><a href="${p}products.html?type=Brown" class="hover:text-white transition-colors">Brown Rice</a></li>
            <li><a href="${p}products.html?type=Basmati" class="hover:text-white transition-colors">Premium Basmati</a></li>
            <li><a href="${p}products.html?type=Black" class="hover:text-white transition-colors">Specialty Black & Red</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-bold text-white mb-4 uppercase tracking-wider text-xs">Quick Links</h4>
          <ul class="space-y-2 text-green-100/80 font-medium">
            <li><a href="${p}products.html" class="hover:text-white transition-colors">Rice Shop</a></li>
            <li><a href="${p}reviews.html" class="hover:text-white transition-colors">Customer Reviews</a></li>
            <li><a href="${p}contact.html" class="hover:text-white transition-colors">Contact Us</a></li>
            <li><a href="${p}terms.html" class="hover:text-white transition-colors">Terms of Use</a></li>
            <li><a href="${p}privacy.html" class="hover:text-white transition-colors">Privacy Policy</a></li>
            <li><a href="${p}login.html" class="hover:text-white transition-colors">Admin Console</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-bold text-white mb-4 uppercase tracking-wider text-xs">Local Supplier Location</h4>
          <p class="text-green-200 leading-relaxed font-semibold">Store Location:</p>
          <p class="text-green-100/60 mb-4 font-medium">${settings.storeAddress}</p>
          <p class="text-green-200 font-semibold mb-1">Contact Phone:</p>
          <p class="text-green-100/60 font-medium ${settings.businessHours || settings.facebookLink ? 'mb-4' : ''}">${settings.contactNumber}</p>
          ${settings.businessHours ? `
            <p class="text-green-200 font-semibold mb-1">Business Hours:</p>
            <p class="text-green-100/60 mb-4 font-medium">${settings.businessHours}</p>
          ` : ''}
          ${settings.facebookLink ? `
            <p class="text-green-200 font-semibold mb-1">Facebook Page:</p>
            <p class="text-green-100/60 font-medium"><a href="${settings.facebookLink}" target="_blank" class="hover:text-white underline transition-colors break-all">${settings.facebookLink}</a></p>
          ` : ''}
        </div>
      </div>
    `;
  }

  // 3. AUTOMATIC PAGE OVERRIDES (for checkout, reservation, profile, etc.)
  applyGcashSettings();
  setTimeout(() => {
    applyGcashSettings();
  }, 20);

  setupNotifications();
  initReviewReminderPopup();
  initCustomerDeadlineReminderBanner();
}

export function initCustomerDeadlineReminderBanner() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.location.pathname.includes('/admin/')) return;
  if (
    window.location.pathname.includes('login.html') ||
    window.location.pathname.includes('register.html') ||
    window.location.pathname.includes('reset-password.html')
  ) {
    return;
  }

  // On profile.html, the dedicated rich reminder section inside My Purchases & Order Details handles visibility
  if (window.location.pathname.includes('profile.html')) {
    const existingGlobalBar = document.getElementById('riceflow-global-deadline-bar');
    if (existingGlobalBar) existingGlobalBar.remove();
    return;
  }

  const user = getCurrentUser();
  const headerContainer = document.getElementById('navbar-container');
  if (!user || !headerContainer) {
    const existingGlobalBar = document.getElementById('riceflow-global-deadline-bar');
    if (existingGlobalBar) existingGlobalBar.remove();
    return;
  }

  const allOrders = getOrders();
  const uId = String(user.id || user.uid || user.firebaseUid || '').trim().toLowerCase();
  const uEmail = String(user.email || '').trim().toLowerCase();

  const myOrders = allOrders.filter(o => {
    if (!o) return false;
    const oUId = String(o.userId || o.uid || o.customerId || '').trim().toLowerCase();
    const oEmail = String(o.email || o.customerEmail || '').trim().toLowerCase();
    return (uId && oUId === uId) || (uEmail && oEmail === uEmail);
  });

  const activeItems = [];
  myOrders.forEach(ord => {
    const resPay = getActiveReservationPaymentDeadlineInfo(ord);
    if (resPay && !resPay.expired) activeItems.push(resPay);
    const reup = getActivePaymentReuploadDeadlineInfo(ord);
    if (reup && !reup.expired) activeItems.push(reup);
  });

  activeItems.sort((a, b) => a.deadlineMs - b.deadlineMs);

  let barEl = document.getElementById('riceflow-global-deadline-bar');
  if (activeItems.length === 0) {
    if (barEl) barEl.remove();
    return;
  }

  if (!barEl) {
    barEl = document.createElement('div');
    barEl.id = 'riceflow-global-deadline-bar';
    headerContainer.insertAdjacentElement('afterend', barEl);
  }

  const p = getPathPrefix();
  barEl.className = 'bg-amber-50 dark:bg-slate-900 border-b border-amber-200 dark:border-amber-800/70 transition-colors';
  barEl.innerHTML = `
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col gap-2">
      ${activeItems.map(item => {
        const isResPay = item.workflow === 'reservation_payment';
        const isCritical = item.urgencyLevel === 'critical' || item.urgencyLevel === 'urgent';
        const badgeCls = isCritical
          ? 'bg-rose-600 text-white'
          : 'bg-amber-200 dark:bg-amber-900/80 text-amber-950 dark:text-amber-100';
        const targetHref = isResPay
          ? `${p}profile.html?fromNotif=1&targetType=reservation&targetId=${encodeURIComponent(item.orderId)}&reservationId=${encodeURIComponent(item.orderId)}&tab=reservations&scrollPayment=1`
          : `${p}profile.html?fromNotif=1&targetType=${item.isReservation ? 'reservation' : 'order'}&targetId=${encodeURIComponent(item.orderId)}&orderId=${encodeURIComponent(item.orderId)}&tab=${item.isReservation ? 'reservations' : 'to-pay'}&scrollPayment=1`;

        return `
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded-md font-black uppercase tracking-wider text-[10px] ${isResPay ? 'bg-orange-600 text-white' : 'bg-rose-600 text-white'}">
                ${isResPay ? '📦 Reservation Payment Due (48h)' : '⚠️ Proof Rejected — Re-upload Required (48h)'}
              </span>
              <span class="font-bold text-gray-900 dark:text-gray-100">
                ${isResPay
                  ? `Reservation #${item.orderId} (${item.varietyName}) — Submit ₱${Number(item.requiredAmount || 0).toLocaleString()}.00 before ${item.deadlineFormatted}`
                  : `${item.isReservation ? 'Reservation' : 'Order'} #${item.orderId} (${item.varietyName}) — Re-upload corrected proof before ${item.deadlineFormatted}`}
              </span>
              <span
                data-live-deadline-ms="${item.deadlineMs}"
                data-live-deadline-mode="short"
                class="px-2 py-0.5 rounded-md font-black text-[11px] ${badgeCls}"
              >⏱️ ${item.shortCountdown}</span>
            </div>
            <div class="shrink-0">
              <a
                href="${targetHref}"
                class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-extrabold text-xs text-white ${isResPay ? 'bg-[#1E6C02] hover:bg-[#145001]' : 'bg-rose-600 hover:bg-rose-700'} transition-all shadow-2xs"
              >
                ${isResPay ? '📤 Upload Down Payment' : '🔄 Re-upload Proof'}
              </a>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (!window.__aurora_deadline_banner_listeners_bound) {
    window.__aurora_deadline_banner_listeners_bound = true;
    window.addEventListener('aurora-orders-updated', () => {
      try { initCustomerDeadlineReminderBanner(); } catch (_) {}
    });
    window.addEventListener('aurora-sync-event', (e) => {
      if (!e.detail || e.detail.key === 'aurora-orders') {
        try { initCustomerDeadlineReminderBanner(); } catch (_) {}
      }
    });
  }
}

// ---------------------- ADMINISTRATIVE SIDEBAR RENDERER ----------------------

export function renderAdminLayout(activeTabId) {
  const adminLayoutContainer = document.getElementById('admin-layout-container');
  if (!adminLayoutContainer) return;

  const p = getPathPrefix();
  const currentAdmin = getCurrentAdmin();
  if (!currentAdmin || currentAdmin.isArchived) {
    window.location.replace(p + 'login.html');
    return;
  }

  // Preserve existing distinction between Admin and Staff permissions
  if ((activeTabId === 'staff' || activeTabId === 'settings' || activeTabId === 'cash-turnover') && currentAdmin.role !== 'admin') {
    try {
      sessionStorage.setItem('admin-toast-message', 'Access denied: System administrator clearance is required.');
    } catch (_) {}
    window.location.replace(p + 'admin/dashboard.html');
    return;
  }

  const settings = getStoreSettings();
  const roleNameCaps = currentAdmin.role === 'admin' ? 'Administrator' : 'Staff Member';

  // Map activeTabId to a clean human-readable title
  let pageTitle = 'Dashboard';
  if (activeTabId === 'dashboard') pageTitle = 'Dashboard';
  else if (activeTabId === 'total-orders') pageTitle = 'Total Orders';
  else if (activeTabId === 'total-sales') pageTitle = 'Total Sales';
  else if (activeTabId === 'sales-overview') pageTitle = 'Sales Overview';
  else if (activeTabId === 'stock-replenishment') pageTitle = 'Stock Needs';
  else if (activeTabId === 'available-stock') pageTitle = 'Available Stock';
  else if (activeTabId === 'top-product') pageTitle = 'Top Rice Product';
  else if (activeTabId === 'inventory-analytics') pageTitle = 'Inventory Analytics';
  else if (activeTabId === 'reservation-analytics') pageTitle = 'Reservation Analytics';
  else if (activeTabId === 'customers') pageTitle = 'Customer';
  else if (activeTabId === 'products') pageTitle = 'Products';
  else if (activeTabId === 'orders') pageTitle = 'Orders';
  else if (activeTabId === 'reservations') pageTitle = 'Reservation Queue';
  else if (activeTabId === 'inquiries') pageTitle = 'Customer Inquiries';
  else if (activeTabId === 'reports') pageTitle = 'Reports';
  else if (activeTabId === 'activities') pageTitle = 'Activity Logs';
  else if (activeTabId === 'staff') pageTitle = 'Manage Staff';
  else if (activeTabId === 'settings') pageTitle = 'Settings';

  // Dynamic Date string formatting
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const dateString = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Modern SVG Outline Icons for Sidebar
  const NAV_ICONS = {
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    packageIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
    ordersList: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
    reservations: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="12" y1="2" x2="12" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><circle cx="12" cy="16" r="3.5"></circle><path d="M10.5 16l1 1 2-2"></path></svg>`,
    inquiries: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
    activities: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    manageStaff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`
  };

  adminLayoutContainer.className = "h-screen bg-[#F5F5F5] flex flex-col md:flex-row relative overflow-hidden sidebar-collapsed";
  adminLayoutContainer.innerHTML = `
    <style id="admin-collapsible-sidebar-styles">
      #admin-sidebar {
        transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 250ms ease-in-out, border-color 250ms ease-in-out !important;
        will-change: transform;
      }
      #admin-layout-container:not(.sidebar-collapsed) #admin-sidebar {
        transform: translateX(0) !important;
      }
      #admin-layout-container.sidebar-collapsed #admin-sidebar {
        transform: translateX(-100%) !important;
        pointer-events: none;
      }
      #admin-right-workspace {
        padding-left: 0px !important;
        width: 100% !important;
      }
      #admin-layout-container #admin-sidebar-backdrop {
        z-index: 45;
        background-color: rgba(15, 23, 42, 0.22) !important;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      html.dark #admin-layout-container #admin-sidebar-backdrop {
        background-color: rgba(2, 6, 23, 0.42) !important;
      }
      #admin-main-content > div {
        max-width: 100% !important;
        width: 100% !important;
      }
    </style>
    <!-- Mobile header bar -->
    <div class="md:hidden flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 w-full sticky top-0 z-40">
      <div class="flex flex-col">
        <span class="text-[#1E6C02] font-black text-xl leading-tight">Aurora Rice Admin</span>
        <span class="text-xs text-black font-semibold tracking-tight">Management Portal</span>
      </div>
      <button id="mobile-sidebar-toggle" class="p-2 text-black hover:text-black focus:outline-none cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-6 h-6"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
      </button>
    </div>
    <!-- Sidebar Navigation -->
    <aside id="admin-sidebar" class="fixed inset-y-0 left-0 transform -translate-x-full md:flex w-[275px] bg-white border-r border-gray-200 flex-shrink-0 flex flex-col justify-between h-screen overflow-y-auto transition-transform duration-300 ease-in-out z-50 shadow-2xl">
      <div class="flex flex-col h-full justify-between">
        <div>
          <!-- Sidebar Branding Header -->
          <div class="pt-8 pb-6 px-6 flex items-center justify-between">
            <div class="flex flex-col">
              <span class="text-[#1E6C02] font-black text-2xl leading-tight">Aurora Rice Admin</span>
              <span class="text-sm text-black font-semibold mt-1 tracking-tight">Management Portal</span>
            </div>
            <!-- Sidebar Close Trigger -->
            <button id="mobile-sidebar-close" class="p-1.5 text-black hover:text-black cursor-pointer" title="Close Sidebar Navigation" aria-label="Close sidebar navigation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
 
          <!-- Navigation Links List -->
          <nav class="px-4 py-2 space-y-1.5">
            <a href="${p}admin/dashboard.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${(activeTabId === 'dashboard' || activeTabId === 'total-orders' || activeTabId === 'total-sales' || activeTabId === 'top-product' || activeTabId === 'available-stock' || activeTabId === 'sales-overview' || activeTabId === 'stock-replenishment') ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.dashboard} Dashboard
            </a>
            <a href="${p}admin/orders.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'orders' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.ordersList} Orders
            </a>
            <a href="${p}admin/reservations.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'reservations' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.reservations} Reservation Queue
            </a>
            <a href="${p}admin/products.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'products' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.packageIcon} Products
            </a>
            <a href="${p}admin/customers.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'customers' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.user} Customers
            </a>
            <a href="${p}admin/inquiries.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'inquiries' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.inquiries} Customer Inquiries
            </a>
            <a href="${p}admin/reports.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'reports' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.reports} Reports
            </a>
            <a href="${p}admin/activities.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'activities' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
              ${NAV_ICONS.activities} Activity Logs
            </a>
            ${currentAdmin.role === 'admin' ? `
              <a href="${p}admin/staff.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'staff' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
                ${NAV_ICONS.manageStaff} Manage Staff
              </a>
            ` : ''}
            ${currentAdmin.role === 'admin' ? `
              <a href="${p}admin/settings.html" class="flex items-center gap-3.5 px-5 py-3 rounded-xl text-base whitespace-nowrap transition-all ${activeTabId === 'settings' ? 'bg-[#1E6C02] text-white font-medium shadow-md' : 'text-black font-normal hover:bg-gray-50 hover:text-black'}">
                ${NAV_ICONS.settings} Settings
              </a>
            ` : ''}
          </nav>
        </div>
 
        <!-- Logout Action Button -->
        <div class="p-5 border-t border-gray-100">
          <button id="admin-sidebar-logout" class="w-full flex items-center justify-center gap-2.5 px-5 py-3 bg-white hover:bg-red-50 text-red-500 hover:text-red-600 font-bold rounded-xl text-base transition-all duration-200 cursor-pointer border border-red-200 hover:border-red-300">
            ${NAV_ICONS.logout}
            Logout
          </button>
        </div>
      </div>
    </aside>
 
    <!-- Sidebar Overlay Backdrop -->
    <div id="admin-sidebar-backdrop" class="fixed inset-0 z-45 hidden transition-opacity duration-300"></div>
 
    <!-- Right Content Workspace -->
    <div id="admin-right-workspace" class="flex-1 flex flex-col min-w-0 w-full h-full overflow-hidden">
      <!-- Admin Workspace Topbar Header -->
      <header class="h-20 bg-white border-b border-gray-200 px-6 sm:px-8 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-4">
          <button id="admin-sidebar-toggle" type="button" aria-label="Toggle sidebar navigation" aria-expanded="false" title="Toggle Sidebar Navigation" class="w-10 h-10 rounded-xl bg-white hover:bg-gray-100 text-black border border-gray-200/80 shadow-2xs flex items-center justify-center cursor-pointer transition-all duration-200 shrink-0 focus:outline-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <h2 class="text-3xl font-black text-gray-950 tracking-tight">${pageTitle}</h2>
        </div>
        
        <div class="flex items-center gap-6">
          <!-- Calendar Date String widget -->
          <div class="hidden lg:flex items-center gap-2 text-sm font-bold text-black bg-gray-50 border border-gray-200/60 px-3.5 py-2 rounded-xl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4.5 h-4.5 text-[#1E6C02]"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <span>${dateString}</span>
          </div>

          <!-- Notification indicator Bell -->
          <div class="relative">
            <button id="admin-notif-btn" class="relative p-2 hover:bg-gray-100 dark:hover:bg-slate-700 dark:focus:bg-slate-700 dark:active:bg-slate-700 rounded-xl cursor-pointer flex items-center justify-center focus:outline-none transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-black dark:text-gray-200"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <span id="admin-notif-badge" class="absolute -top-1 -right-1 bg-red-500 text-white font-black text-[9px] min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-800 hidden">0</span>
            </button>
            
            <!-- Dropdown Panel (hidden by default) -->
            <div id="admin-notif-dropdown" class="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-20 sm:top-full mt-2 sm:mt-3.5 w-auto sm:w-96 max-w-[calc(100vw-1.5rem)] sm:max-w-none bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 hidden flex flex-col overflow-hidden max-h-[calc(100vh-100px)] sm:max-h-[520px]">
              <div class="p-3.5 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between bg-gray-50/90 dark:bg-slate-800/80 shrink-0">
                <div class="flex items-center gap-2">
                  <span class="font-extrabold text-sm text-[#111827] dark:text-white">Notifications</span>
                </div>
                <button id="admin-notif-mark-all" class="text-xs font-bold text-[#1E6C02] dark:text-emerald-400 hover:text-[#145001] dark:hover:text-emerald-300 transition-colors cursor-pointer focus:outline-none">Mark all as read</button>
              </div>

              <!-- Notification Filter Controls: All / Unread / Read -->
              <div id="admin-notif-filter-bar" class="px-3 py-2 bg-gray-100/70 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-800 flex items-center gap-1.5 shrink-0">
                <button type="button" data-filter="all" class="admin-notif-filter-btn notif-filter-active flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                  <span>All</span>
                  <span id="admin-notif-count-all" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                </button>
                <button type="button" data-filter="unread" class="admin-notif-filter-btn flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                  <span>Unread</span>
                  <span id="admin-notif-count-unread" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                </button>
                <button type="button" data-filter="read" class="admin-notif-filter-btn flex-1 py-1.5 px-2 text-xs rounded-xl font-bold transition-all text-center flex items-center justify-center gap-1 cursor-pointer">
                  <span>Read</span>
                  <span id="admin-notif-count-read" class="text-[10px] px-1.5 py-0.2 rounded-full font-black">0</span>
                </button>
              </div>

              <div id="admin-notif-list" class="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-slate-800 max-h-[360px]">
                <!-- Dynamic Notifications -->
              </div>
            </div>
          </div>

          <!-- Night Mode Toggle Button -->
          <button id="admin-dark-mode-toggle" class="flex items-center justify-center p-2.5 bg-gray-50 border border-gray-200/60 hover:bg-gray-100 rounded-xl text-xs font-bold text-gray-700 transition-all cursor-pointer" title="Toggle Day/Night Mode">
            <span id="admin-dark-mode-icon" class="w-4 h-4 flex items-center justify-center shrink-0"></span>
          </button>

          <span class="h-6 w-[1px] bg-gray-200"></span>

          <!-- Profile Info Badge -->
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-[#1E6C02] text-white flex items-center justify-center font-extrabold text-sm shadow-xs shrink-0 border border-emerald-700">
              ${(currentAdmin?.name && currentAdmin.name[0] ? currentAdmin.name[0].toUpperCase() : 'A')}
            </div>
            <div class="hidden sm:flex flex-col text-left">
              <span class="text-sm font-extrabold text-black leading-none">${currentAdmin.name}</span>
              <span class="text-[10px] text-black font-bold mt-1 uppercase tracking-wider">${roleNameCaps}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Main Workspace Section Content Injection Point -->
      <main id="admin-main-content" class="flex-1 w-full min-w-0 p-6 sm:p-8 overflow-y-auto">
        <!-- Injected dynamically or directly in page html -->
      </main>
    </div>
  `;

  // Attach exit actions
  const exitBtn = document.getElementById('admin-sidebar-logout');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      logoutAdmin();
      showToast('Admin logged out successfully');
      setTimeout(() => {
        window.location.href = p + 'login.html';
      }, 1000);
    });
  }

  // Desktop & Mobile overlay sidebar triggers
  const desktopToggleBtn = document.getElementById('admin-sidebar-toggle');
  const toggleBtn = document.getElementById('mobile-sidebar-toggle');
  const closeBtn = document.getElementById('mobile-sidebar-close');
  const sidebar = document.getElementById('admin-sidebar');
  const backdrop = document.getElementById('admin-sidebar-backdrop');

  function openAdminSidebar() {
    adminLayoutContainer.classList.remove('sidebar-collapsed');
    if (sidebar) sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
    if (desktopToggleBtn) desktopToggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeAdminSidebar() {
    adminLayoutContainer.classList.add('sidebar-collapsed');
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
    if (desktopToggleBtn) desktopToggleBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleAdminSidebar() {
    const isCollapsed = adminLayoutContainer.classList.contains('sidebar-collapsed') || (sidebar && sidebar.classList.contains('-translate-x-full'));
    if (isCollapsed) {
      openAdminSidebar();
    } else {
      closeAdminSidebar();
    }
  }

  if (desktopToggleBtn && sidebar) {
    desktopToggleBtn.addEventListener('click', toggleAdminSidebar);
  }

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', toggleAdminSidebar);
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', closeAdminSidebar);
  }
  if (backdrop && sidebar) {
    backdrop.addEventListener('click', closeAdminSidebar);
  }

  // Night Mode (Dark Mode) UI Updater
  function updateDarkModeUI(isDark) {
    const toggleBtn = document.getElementById('admin-dark-mode-toggle');
    const iconSpan = document.getElementById('admin-dark-mode-icon');
    const textSpan = document.getElementById('admin-dark-mode-text');
    if (!toggleBtn) return;
    if (isDark) {
      if (iconSpan) {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-amber-500"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      }
      if (textSpan) textSpan.textContent = 'Day Mode';
      toggleBtn.classList.remove('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
      toggleBtn.classList.add('bg-gray-800', 'text-gray-200', 'border-gray-700');
    } else {
      if (iconSpan) {
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-slate-700"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
      }
      if (textSpan) textSpan.textContent = 'Night Mode';
      toggleBtn.classList.add('bg-gray-50', 'text-gray-700', 'border-gray-200/60');
      toggleBtn.classList.remove('bg-gray-800', 'text-gray-200', 'border-gray-700');
    }
  }

  // Set initial state
  const isDark = localStorage.getItem('aurora-dark-mode') === 'true';
  applyThemeState(isDark, false);
  updateDarkModeUI(isDark);

  const darkModeToggle = document.getElementById('admin-dark-mode-toggle');
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const currentDark = localStorage.getItem('aurora-dark-mode') === 'true';
      const newDark = !currentDark;
      localStorage.setItem('aurora-dark-mode', newDark ? 'true' : 'false');
      applyThemeState(newDark, true);
      updateDarkModeUI(newDark);
    });
  }

  setupAdminNotifications();
  try {
    initFirestoreSync().catch(e => console.warn('[FIREBASE] Sync error in admin layout:', e));
  } catch (e) {}
}

function extractId(message, prefix) {
  if (!message) return null;
  const regex = new RegExp(prefix + '\\d+', 'i');
  const match = message.match(regex);
  return match ? match[0] : null;
}

function handleNotificationClick(notifId, currentUserId = null, currentRole = null) {
  const notifs = getNotifications();
  let n = null;
  if (currentUserId || currentRole) {
    n = notifs.find(item => 
      (item.id === notifId || item.notificationId === notifId) &&
      (!currentRole || item.role === currentRole) &&
      (!currentUserId || String(item.userId) === String(currentUserId))
    );
  }
  if (!n) {
    n = notifs.find(item => item.id === notifId || item.notificationId === notifId);
  }
  if (!n) return;

  // 1. Mark as read
  markNotificationAsRead(notifId, n.userId, n.role);

  // 2. Adjust target path based on whether we are in administrative folder
  const inAdmin = window.location.pathname.includes('/admin/');
  
  const getPagePath = (targetPage) => {
    if (targetPage.startsWith('admin/')) {
      return inAdmin ? targetPage.replace('admin/', '') : targetPage;
    } else {
      return inAdmin ? '../' + targetPage : targetPage;
    }
  };

  const isAdmin = n.role === 'admin' || n.role === 'staff';

  // Extract targetId and targetType strictly using stored properties
  const targetId = n.targetId || n.recordId || n.reservationId || n.orderId || extractId(n.message, 'RES-') || extractId(n.message, 'res-') || extractId(n.message, 'ORD-') || extractId(n.message, 'RF') || '';
  const targetType = n.targetType || n.recordType || (n.type === 'reservation' || n.reservationId || (targetId && String(targetId).toUpperCase().startsWith('RES-')) ? 'reservation' : ((n.type === 'inquiry' || String(targetId).startsWith('msg-')) ? 'contact' : 'order'));

  if (isAdmin) {
    if (targetType === 'contact' || n.type === 'inquiry') {
      const inqParam = targetId ? `&targetId=${encodeURIComponent(targetId)}` : '';
      window.location.href = `${getPagePath('admin/inquiries.html')}?fromNotif=1&targetType=contact${inqParam}`;
    } else if (targetType === 'product' || n.type === 'stock') {
      const prodParam = targetId ? `&productId=${encodeURIComponent(targetId)}` : '';
      window.location.href = `${getPagePath('admin/products.html')}?fromNotif=1${prodParam}`;
    } else if (targetType === 'reservation') {
      window.location.href = `${getPagePath('admin/reservations.html')}?fromNotif=1&targetType=reservation&targetId=${encodeURIComponent(targetId)}&reservationId=${encodeURIComponent(targetId)}`;
    } else {
      let tab = n.destinationTab || n.tab || 'all';
      if (!n.destinationTab && !n.tab) {
        const titleClean = String(n.title || '').toLowerCase();
        if (n.type === 'new-order' || titleClean.includes('new customer order')) {
          tab = 'to-pay';
        } else if (n.type === 'payment' || titleClean.includes('payment')) {
          tab = 'to-pay';
        } else if (n.type === 'issue' || titleClean.includes('issue') || titleClean.includes('claim')) {
          tab = 'issue-reported';
        } else if (titleClean.includes('cancelled')) {
          tab = 'cancelled';
        }
      }
      window.location.href = `${getPagePath('admin/orders.html')}?fromNotif=1&targetType=order&targetId=${encodeURIComponent(targetId)}&orderId=${encodeURIComponent(targetId)}&tab=${encodeURIComponent(tab)}`;
    }
  } else {
    // Customer
    const scrollPayParam = (n.scrollPayment || (n.title && (n.title.includes('Failed') || n.title.includes('Rejected') || n.title.includes('Correction') || n.title.includes('Needs Correction')))) ? '&scrollPayment=1' : '';
    const destTab = n.destinationTab || n.tab || (scrollPayParam ? (targetType === 'reservation' ? 'reservations' : 'to-pay') : '');
    const tabQuery = destTab ? `&tab=${encodeURIComponent(destTab)}` : '';

    // If customer is already on profile.html, use immediate in-page opener
    if (typeof window !== 'undefined' && window.location.pathname.includes('profile.html') && typeof window.openCustomerOrderFromNotif === 'function') {
      const url = new URL(window.location.href);
      url.searchParams.set('orderId', targetId);
      if (destTab) url.searchParams.set('tab', destTab);
      if (scrollPayParam) url.searchParams.set('scrollPayment', '1');
      window.history.pushState({ orderId: targetId }, '', url);
      window.openCustomerOrderFromNotif(targetId, destTab, Boolean(scrollPayParam));
      return;
    }

    if (targetType === 'reservation') {
      window.location.href = `${getPagePath('profile.html')}?fromNotif=1&targetType=reservation&targetId=${encodeURIComponent(targetId)}&reservationId=${encodeURIComponent(targetId)}&recordType=reservation${tabQuery}${scrollPayParam}`;
    } else {
      window.location.href = `${getPagePath('profile.html')}?fromNotif=1&targetType=order&targetId=${encodeURIComponent(targetId)}&orderId=${encodeURIComponent(targetId)}&recordType=order${tabQuery}${scrollPayParam}`;
    }
  }
}

export function setupNotifications() {
  const user = getCurrentUser();
  if (!user) return;

  const notifBtn = document.getElementById('customer-notif-btn');
  const dropdown = document.getElementById('customer-notif-dropdown');
  const badge = document.getElementById('customer-notif-badge');
  const listContainer = document.getElementById('customer-notif-list');
  const markAllBtn = document.getElementById('customer-notif-mark-all');

  if (!notifBtn || !dropdown || !badge || !listContainer) return;

  let activeFilter = 'all'; // 'all' | 'unread' | 'read'

  // Toggle Dropdown Panel
  const handleDropdownToggle = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
      renderNotifList();
    }
  };
  
  notifBtn.onclick = handleDropdownToggle;

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !notifBtn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Filter button click handling
  const filterBtns = dropdown.querySelectorAll('.customer-notif-filter-btn');
  filterBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const targetFilter = btn.getAttribute('data-filter');
      if (targetFilter && targetFilter !== activeFilter) {
        activeFilter = targetFilter;
        renderNotifList();
      }
    };
  });

  const renderNotifList = () => {
    const allNotifs = getNotifications();
    
    // Filter specifically for this logged in customer's userId and role 'customer', sorted newest to oldest
    const customerNotifs = sortNotificationsDescending(allNotifs.filter(n => n.role === 'customer' && String(n.userId) === String(user.id)));
    const totalCount = customerNotifs.length;
    const unreadCount = customerNotifs.filter(n => !n.read).length;
    const readCount = customerNotifs.filter(n => n.read).length;

    // Update red badge
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // Update filter count numbers
    const countAllEl = document.getElementById('notif-count-all');
    const countUnreadEl = document.getElementById('notif-count-unread');
    const countReadEl = document.getElementById('notif-count-read');
    if (countAllEl) countAllEl.textContent = totalCount;
    if (countUnreadEl) countUnreadEl.textContent = unreadCount;
    if (countReadEl) countReadEl.textContent = readCount;

    // Update filter button styling and active class
    filterBtns.forEach(btn => {
      const f = btn.getAttribute('data-filter');
      const countPill = btn.querySelector('span:last-child');
      const isActive = f === activeFilter;
      if (isActive) {
        btn.classList.add('notif-filter-active');
        if (countPill) {
          countPill.className = 'text-[10px] px-1.5 py-0.2 rounded-full font-black bg-white/25 text-white';
        }
      } else {
        btn.classList.remove('notif-filter-active');
        if (countPill) {
          countPill.className = 'text-[10px] px-1.5 py-0.2 rounded-full font-black bg-gray-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200';
        }
      }
    });

    // Filter displayed notifications according to active tab
    let displayedNotifs = customerNotifs;
    if (activeFilter === 'unread') {
      displayedNotifs = customerNotifs.filter(n => !n.read);
    } else if (activeFilter === 'read') {
      displayedNotifs = customerNotifs.filter(n => n.read);
    }

    if (displayedNotifs.length === 0) {
      if (customerNotifs.length === 0) {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">🔔</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">No notifications yet</p>
            <p class="text-slate-600 dark:text-slate-300">You will receive updates here about your orders and reservations.</p>
          </div>
        `;
      } else if (activeFilter === 'unread') {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">✨</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">All caught up!</p>
            <p class="text-slate-600 dark:text-slate-300">You have no unread notifications.</p>
          </div>
        `;
      } else if (activeFilter === 'read') {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">📬</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">No read notifications</p>
            <p class="text-slate-600 dark:text-slate-300">Read notifications will appear here once you view them.</p>
          </div>
        `;
      }
      return;
    }

    const currentOrdersList = getOrders();

    listContainer.innerHTML = displayedNotifs.map(n => {
      const style = NOTIF_STYLES[n.type] || NOTIF_STYLES.info;
      const isUnread = !n.read;
      const targetResId = n.reservationId || n.orderId || n.targetId || '';
      const isUnallocChoiceNotif = Boolean(
        n.requiresUnallocatedChoice ||
        (n.title && String(n.title).includes('Not Included in Latest Stock Allocation'))
      );
      const matchedResOrder = (isUnallocChoiceNotif && targetResId)
        ? currentOrdersList.find(o => String(o.id).trim().toLowerCase() === String(targetResId).trim().toLowerCase())
        : null;
      const matchedResStatus = matchedResOrder ? String(matchedResOrder.status || '').toLowerCase().replace(/_/g, '-') : '';
      const showUnallocChoices = Boolean(
        isUnallocChoiceNotif &&
        targetResId &&
        (!matchedResOrder || (
          matchedResStatus !== 'cancelled' &&
          matchedResStatus !== 'completed' &&
          matchedResStatus !== 'rejected' &&
          matchedResStatus !== 'processing' &&
          matchedResStatus !== 'to-ship' &&
          matchedResStatus !== 'to-receive' &&
          matchedResStatus !== 'delivered' &&
          matchedResStatus !== 'ready-for-processing' &&
          matchedResOrder.unallocatedRestockNoticePending !== false &&
          !matchedResOrder.notifiedForPayment
        ))
      );

      return `
        <div class="customer-notif-item ${isUnread ? 'notif-item-unread' : 'notif-item-read'} p-3.5 transition-all flex gap-3 items-start relative group cursor-pointer" data-id="${n.id}">
          <div class="w-8 h-8 rounded-full ${style.bg} border-2 ${style.text} flex items-center justify-center shrink-0 text-sm mt-0.5 shadow-xs">
            ${style.icon}
          </div>
          <div class="flex-1 min-w-0 pr-1">
            <div class="flex items-start justify-between gap-2 mb-1">
              <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                <h5 class="${isUnread ? 'font-black text-slate-900 dark:text-white text-xs' : 'font-bold text-slate-800 dark:text-slate-200 text-xs'} break-words leading-snug">${n.title}</h5>
                ${isUnread ? `
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-[#1E6C02] text-white shrink-0 shadow-xs">
                    <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>NEW
                  </span>
                ` : `
                  <span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                    <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>Read
                  </span>
                `}
              </div>
              <span class="text-[10px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0 mt-0.5">${n.createdTime || ''}</span>
            </div>
            <p class="${isUnread ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-800 dark:text-slate-200 font-medium'} text-xs leading-relaxed break-words">${n.message}</p>
            ${showUnallocChoices ? `
              <div class="flex items-center gap-2 mt-2.5 flex-wrap">
                <button
                  type="button"
                  class="btn-notif-continue-res px-2.5 py-1 text-[10px] font-black text-white bg-[#1E6C02] hover:bg-[#145001] rounded-lg transition-all cursor-pointer shadow-2xs"
                  data-notif-id="${n.id}"
                  data-res-id="${targetResId}"
                >Continue Reservation</button>
                <button
                  type="button"
                  class="btn-notif-cancel-res px-2.5 py-1 text-[10px] font-black text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 hover:bg-rose-600 hover:text-white dark:hover:bg-rose-600 dark:hover:text-white rounded-lg transition-all cursor-pointer shadow-2xs"
                  data-notif-id="${n.id}"
                  data-res-id="${targetResId}"
                >Cancel Reservation</button>
              </div>
            ` : (isUnallocChoiceNotif && matchedResOrder && matchedResOrder.unallocatedRestockChoiceMade === 'continue' && matchedResStatus !== 'cancelled' ? `
              <div class="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                ✔ Continuing in waiting queue
              </div>
            ` : '')}
            <div class="flex items-center justify-between mt-2 pt-1 border-t border-black/5 dark:border-white/5">
              <div class="text-[10px] font-medium text-slate-700 dark:text-slate-300">${n.createdDate || ''}</div>
              ${isUnread ? `
                <button type="button" class="btn-mark-read px-2 py-0.5 text-[10px] font-black text-[#1E6C02] dark:text-emerald-400 bg-white dark:bg-slate-800 border-2 border-emerald-300 dark:border-emerald-700 rounded-lg hover:bg-[#1E6C02] hover:text-white hover:border-[#1E6C02] dark:hover:bg-emerald-600 dark:hover:text-white dark:hover:border-emerald-500 transition-all cursor-pointer shadow-xs" title="Mark as read" data-id="${n.id}">Mark as read</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners for Continue Reservation / Cancel Reservation inside notification items
    listContainer.querySelectorAll('.btn-notif-continue-res').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const notifId = el.getAttribute('data-notif-id');
        const resId = el.getAttribute('data-res-id');
        if (notifId) {
          markNotificationAsRead(notifId, user.id, 'customer');
        }
        if (resId) {
          confirmContinueUnallocatedReservation(resId);
          showToast('✔ Your reservation remains active in the waiting queue for the next restock.', 'success');
        }
        renderNotifList();
      });
    });

    listContainer.querySelectorAll('.btn-notif-cancel-res').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const notifId = el.getAttribute('data-notif-id');
        const resId = el.getAttribute('data-res-id');
        if (notifId) {
          markNotificationAsRead(notifId, user.id, 'customer');
        }
        renderNotifList();
        if (!resId) return;
        dropdown.classList.add('hidden');
        if (typeof window !== 'undefined' && window.location.pathname.includes('profile.html') && typeof window.promptCustomerCancelOrder === 'function') {
          if (typeof window.openCustomerOrderFromNotif === 'function') {
            window.openCustomerOrderFromNotif(resId, 'reservations', false);
          }
          window.promptCustomerCancelOrder(resId);
        } else {
          const inAdmin = window.location.pathname.includes('/admin/');
          const profilePath = inAdmin ? '../profile.html' : 'profile.html';
          window.location.href = `${profilePath}?fromNotif=1&targetType=reservation&targetId=${encodeURIComponent(resId)}&reservationId=${encodeURIComponent(resId)}&tab=reservations&promptCancel=1`;
        }
      });
    });

    // Attach click listener for marking single as read
    listContainer.querySelectorAll('.btn-mark-read').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) {
          markNotificationAsRead(id, user.id, 'customer');
          renderNotifList();
        }
      });
    });

    listContainer.querySelectorAll('[data-id]:not(.btn-mark-read)').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) {
          markNotificationAsRead(id, user.id, 'customer');
          renderNotifList();
          handleNotificationClick(id, user.id, 'customer');
        }
      });
    });
  };

  // Mark all as read click
  if (markAllBtn) {
    markAllBtn.onclick = (e) => {
      e.stopPropagation();
      markAllNotificationsAsRead('customer', user.id);
      renderNotifList();
    };
  }

  // Initial draw
  renderNotifList();

  // Listen to the system sync event to update automatically in real-time
  const handleSync = (e) => {
    renderNotifList();
  };
  
  window.removeEventListener('aurora-sync-event', handleSync);
  window.addEventListener('aurora-sync-event', handleSync);
}

export function setupAdminNotifications() {
  const currentAdmin = getCurrentAdmin();
  if (!currentAdmin) return;

  const notifBtn = document.getElementById('admin-notif-btn');
  const dropdown = document.getElementById('admin-notif-dropdown');
  const badge = document.getElementById('admin-notif-badge');
  const listContainer = document.getElementById('admin-notif-list');
  const markAllBtn = document.getElementById('admin-notif-mark-all');

  if (!notifBtn || !dropdown || !badge || !listContainer) return;

  let activeFilter = 'all'; // 'all' | 'unread' | 'read'

  // Toggle Dropdown Panel
  const handleDropdownToggle = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
      renderNotifList();
    }
  };
  
  notifBtn.onclick = handleDropdownToggle;

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !notifBtn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Filter button click handling
  const filterBtns = dropdown.querySelectorAll('.admin-notif-filter-btn');
  filterBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const targetFilter = btn.getAttribute('data-filter');
      if (targetFilter && targetFilter !== activeFilter) {
        activeFilter = targetFilter;
        renderNotifList();
      }
    };
  });

  const renderNotifList = () => {
    const allNotifs = getNotifications();
    
    // Filter specifically for this logged in admin/staff's role/userId, sorted newest to oldest
    // Admin receives notifications under role 'admin', and Staff receives under their specific userId or role 'staff'
    const adminNotifs = sortNotificationsDescending(allNotifs.filter(n => {
      if (!n) return false;
      if (currentAdmin.role === 'admin') {
        return (n.role === 'admin' || n.role === 'staff') && (n.userId === 'admin' || n.userId === 'staff' || String(n.userId) === String(currentAdmin.id) || !n.userId);
      } else {
        // Staff role: Staff sees operational notifications (sent to admin/staff or to this staff user)
        return (n.role === 'admin' || n.role === 'staff') && (n.userId === 'admin' || n.userId === 'staff' || String(n.userId) === String(currentAdmin.id) || !n.userId);
      }
    }));

    const totalCount = adminNotifs.length;
    const unreadCount = adminNotifs.filter(n => !n.read).length;
    const readCount = adminNotifs.filter(n => n.read).length;

    // Update red badge
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // Update filter count numbers
    const countAllEl = document.getElementById('admin-notif-count-all');
    const countUnreadEl = document.getElementById('admin-notif-count-unread');
    const countReadEl = document.getElementById('admin-notif-count-read');
    if (countAllEl) countAllEl.textContent = totalCount;
    if (countUnreadEl) countUnreadEl.textContent = unreadCount;
    if (countReadEl) countReadEl.textContent = readCount;

    // Update filter button styling and active class
    filterBtns.forEach(btn => {
      const f = btn.getAttribute('data-filter');
      const countPill = btn.querySelector('span:last-child');
      const isActive = f === activeFilter;
      if (isActive) {
        btn.classList.add('notif-filter-active');
        if (countPill) {
          countPill.className = 'text-[10px] px-1.5 py-0.2 rounded-full font-black bg-white/25 text-white';
        }
      } else {
        btn.classList.remove('notif-filter-active');
        if (countPill) {
          countPill.className = 'text-[10px] px-1.5 py-0.2 rounded-full font-black bg-gray-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200';
        }
      }
    });

    // Filter displayed notifications according to active tab
    let displayedNotifs = adminNotifs;
    if (activeFilter === 'unread') {
      displayedNotifs = adminNotifs.filter(n => !n.read);
    } else if (activeFilter === 'read') {
      displayedNotifs = adminNotifs.filter(n => n.read);
    }

    if (displayedNotifs.length === 0) {
      if (adminNotifs.length === 0) {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">🔔</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">No notifications yet</p>
            <p class="text-slate-600 dark:text-slate-300">You will receive updates here about new orders, reservations, stock alerts, and inquiries.</p>
          </div>
        `;
      } else if (activeFilter === 'unread') {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">✨</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">All caught up!</p>
            <p class="text-slate-600 dark:text-slate-300">You have no unread notifications.</p>
          </div>
        `;
      } else if (activeFilter === 'read') {
        listContainer.innerHTML = `
          <div class="p-8 text-center text-slate-700 dark:text-slate-300 text-xs">
            <div class="text-3xl mb-2">📬</div>
            <p class="font-bold text-sm text-slate-900 dark:text-white mb-1">No read notifications</p>
            <p class="text-slate-600 dark:text-slate-300">Read notifications will appear here once viewed.</p>
          </div>
        `;
      }
      return;
    }

    listContainer.innerHTML = displayedNotifs.map(n => {
      const style = NOTIF_STYLES[n.type] || NOTIF_STYLES.info;
      const isUnread = !n.read;
      return `
        <div class="admin-notif-item ${isUnread ? 'notif-item-unread' : 'notif-item-read'} p-3.5 transition-all flex gap-3 items-start relative group cursor-pointer" data-id="${n.id}">
          <div class="w-8 h-8 rounded-full ${style.bg} border-2 ${style.text} flex items-center justify-center shrink-0 text-sm mt-0.5 shadow-xs">
            ${style.icon}
          </div>
          <div class="flex-1 min-w-0 pr-1">
            <div class="flex items-start justify-between gap-2 mb-1">
              <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                <h5 class="${isUnread ? 'font-black text-slate-900 dark:text-white text-xs' : 'font-bold text-slate-800 dark:text-slate-200 text-xs'} break-words leading-snug">${n.title}</h5>
                ${isUnread ? `
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-[#1E6C02] text-white shrink-0 shadow-xs">
                    <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>NEW
                  </span>
                ` : `
                  <span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                    <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>Read
                  </span>
                `}
              </div>
              <span class="text-[10px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0 mt-0.5">${n.createdTime || ''}</span>
            </div>
            <p class="${isUnread ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-800 dark:text-slate-200 font-medium'} text-xs leading-relaxed break-words">${n.message}</p>
            <div class="flex items-center justify-between mt-2 pt-1 border-t border-black/5 dark:border-white/5">
              <div class="text-[10px] font-medium text-slate-700 dark:text-slate-300">${n.createdDate || ''}</div>
              ${isUnread ? `
                <button type="button" class="btn-mark-read px-2 py-0.5 text-[10px] font-black text-[#1E6C02] dark:text-emerald-400 bg-white dark:bg-slate-800 border-2 border-emerald-300 dark:border-emerald-700 rounded-lg hover:bg-[#1E6C02] hover:text-white hover:border-[#1E6C02] dark:hover:bg-emerald-600 dark:hover:text-white dark:hover:border-emerald-500 transition-all cursor-pointer shadow-xs" title="Mark as read" data-id="${n.id}">Mark as read</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listener for marking single as read
    listContainer.querySelectorAll('.btn-mark-read').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) {
          const targetRole = currentAdmin.role === 'admin' ? 'admin' : 'staff';
          const targetId = currentAdmin.role === 'admin' ? 'admin' : currentAdmin.id;
          markNotificationAsRead(id, targetId, targetRole);
          renderNotifList();
        }
      });
    });

    listContainer.querySelectorAll('[data-id]:not(.btn-mark-read)').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) {
          const targetRole = currentAdmin.role === 'admin' ? 'admin' : 'staff';
          const targetId = currentAdmin.role === 'admin' ? 'admin' : currentAdmin.id;
          markNotificationAsRead(id, targetId, targetRole);
          renderNotifList();
          handleNotificationClick(id, targetId, targetRole);
        }
      });
    });
  };

  // Mark all as read click
  if (markAllBtn) {
    markAllBtn.onclick = (e) => {
      e.stopPropagation();
      const targetRole = currentAdmin.role === 'admin' ? 'admin' : 'staff';
      const targetId = currentAdmin.role === 'admin' ? 'admin' : currentAdmin.id;
      markAllNotificationsAsRead(targetRole, targetId);
      renderNotifList();
    };
  }

  // Initial draw
  renderNotifList();

  // Listen to the system sync event to update automatically in real-time
  const handleSync = (e) => {
    renderNotifList();
  };
  
  window.removeEventListener('aurora-sync-event', handleSync);
  window.addEventListener('aurora-sync-event', handleSync);
}

// ---------------------- AUTHORITATIVE DASHBOARD TOTAL ORDERS LOGIC ----------------------

export function parseDashboardOrderDate(order) {
  if (!order) return new Date(0);

  function parseRawDateValue(val) {
    if (!val) return null;
    if (val instanceof Date) {
      return !isNaN(val.getTime()) ? val : null;
    }
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
    }
    const d = new Date(val);
    return !isNaN(d.getTime()) ? d : null;
  }

  const candidates = [
    order.createdAt,
    order.dateCreated,
    order.createdDate,
    order.date,
    order.timestamp
  ];

  for (let i = 0; i < candidates.length; i++) {
    const parsed = parseRawDateValue(candidates[i]);
    if (parsed) return parsed;
  }

  if (order.statusHistory && Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    for (let i = 0; i < order.statusHistory.length; i++) {
      const parsed = parseRawDateValue(order.statusHistory[i]?.changedAt);
      if (parsed) return parsed;
    }
  }
  return new Date(0);
}

export function getOrderCompletionDate(order) {
  if (!order) return new Date(0);
  const s = (order.status || '').toLowerCase().replace(/_/g, '-');
  if (s !== 'completed') {
    return new Date(0);
  }

  function parseRawDateValue(val) {
    if (!val) return null;
    if (val instanceof Date) {
      return !isNaN(val.getTime()) ? val : null;
    }
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
    }
    const d = new Date(val);
    return !isNaN(d.getTime()) ? d : null;
  }

  if (order.completedAt) {
    const d = parseRawDateValue(order.completedAt);
    if (d) return d;
  }
  if (order.completionDate) {
    const d = parseRawDateValue(order.completionDate);
    if (d) return d;
  }
  if (order.completedDate) {
    const d = parseRawDateValue(order.completedDate);
    if (d) return d;
  }
  if (order.statusHistory && Array.isArray(order.statusHistory)) {
    const compHist = order.statusHistory.slice().reverse().find(h => {
      const hs = (h.status || '').toLowerCase().replace(/_/g, '-');
      return hs === 'completed';
    });
    if (compHist && compHist.changedAt) {
      const d = parseRawDateValue(compHist.changedAt);
      if (d) return d;
    }
  }
  if (order.customerConfirmationDate) {
    const d = parseRawDateValue(order.customerConfirmationDate);
    if (d) return d;
  }
  if (order.deliveredDate) {
    const timeStr = order.deliveredTime || '00:00';
    const d = parseRawDateValue(`${order.deliveredDate} ${timeStr}`);
    if (d) return d;
    const d2 = parseRawDateValue(order.deliveredDate);
    if (d2) return d2;
  }
  if (order.deliveryVerificationDate) {
    const d = parseRawDateValue(order.deliveryVerificationDate);
    if (d) return d;
  }
  if (order.updatedAt) {
    const d = parseRawDateValue(order.updatedAt);
    if (d) return d;
  }
  if (order.createdAt) {
    const d = parseRawDateValue(order.createdAt);
    if (d) return d;
  }
  if (order.dateCreated) {
    const d = parseRawDateValue(order.dateCreated);
    if (d) return d;
  }
  if (order.date) {
    const d = parseRawDateValue(order.date);
    if (d) return d;
  }
  return new Date(0);
}

export function getDashboardTotalOrdersData(options = {}) {
  const liveOrders = Array.isArray(options.liveOrders)
    ? options.liveOrders
    : (typeof getAllOrders === 'function' ? getAllOrders() : []);
  const productsList = Array.isArray(options.productsList)
    ? options.productsList
    : (typeof getProducts === 'function' ? getProducts() : []);

  const currentRange = options.currentRange || 'all';
  const currentProd = options.currentProd || 'all';
  const salesCustomStart = options.salesCustomStart || '';
  const salesCustomEnd = options.salesCustomEnd || '';
  const hasUserAppliedFilter = Boolean(options.hasUserAppliedFilter);

  let selectedSalesDate = null;
  if (options.selectedSalesDate instanceof Date && !isNaN(options.selectedSalesDate.getTime())) {
    selectedSalesDate = options.selectedSalesDate;
  } else if (typeof options.selectedSalesDate === 'string' && options.selectedSalesDate.trim()) {
    const parts = options.selectedSalesDate.trim().split('-').map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const parsed = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      if (!isNaN(parsed.getTime())) selectedSalesDate = parsed;
    }
  }

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let rangeStart;
  let rangeEnd = endOfToday;
  let rangeLabel = 'All Time';

  if (selectedSalesDate) {
    const selY = selectedSalesDate.getFullYear();
    const selM = selectedSalesDate.getMonth();
    const selD = selectedSalesDate.getDate();
    rangeStart = new Date(selY, selM, selD, 0, 0, 0, 0);
    rangeEnd = new Date(selY, selM, selD, 23, 59, 59, 999);
    rangeLabel = selectedSalesDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else if (currentRange === 'custom' && salesCustomStart && salesCustomEnd) {
    const [sY, sM, sD] = salesCustomStart.split('-').map(Number);
    const [eY, eM, eD] = salesCustomEnd.split('-').map(Number);
    rangeStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    rangeEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
    const sFormatted = rangeStart.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    const eFormatted = rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    rangeLabel = salesCustomStart === salesCustomEnd ? eFormatted : `${sFormatted} – ${eFormatted}`;
  } else if (currentRange === '1week') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    rangeLabel = '1 Week';
  } else if (currentRange === '1month') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeLabel = '1 Month';
  } else if (currentRange === '3months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89, 0, 0, 0, 0);
    rangeLabel = '3 Months';
  } else if (currentRange === '6months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 179, 0, 0, 0, 0);
    rangeLabel = '6 Months';
  } else if (currentRange === '1year') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 0, 0, 0, 0);
    rangeLabel = '1 Year';
  } else {
    rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
    rangeLabel = 'All Time';
  }

  let activeVarietyLabel = 'All Grains';
  let matchedProdName = '';
  if (currentProd !== 'all') {
    const matchedProdObj = productsList.find(p => String(p.id) === String(currentProd));
    if (matchedProdObj) {
      activeVarietyLabel = matchedProdObj.name;
      matchedProdName = matchedProdObj.name;
    } else {
      activeVarietyLabel = currentProd;
      matchedProdName = currentProd;
    }
  }

  function itemMatchesVariety(item) {
    if (!item || item.isReservation) return false;
    if (currentProd === 'all') return true;
    const pId = String(item.product?.id || item.productId || item.id || '');
    const pName = String(item.product?.name || item.name || item.productName || '').trim().toLowerCase();
    if (pId && pId === String(currentProd)) return true;
    if (matchedProdName && pName && pName === matchedProdName.trim().toLowerCase()) return true;
    return false;
  }

  const isDateOrRangeFiltered = Boolean(selectedSalesDate || currentRange !== 'all');
  const isFilterActive = Boolean(selectedSalesDate || (hasUserAppliedFilter && (currentRange !== 'all' || currentProd !== 'all')));

  let orders = [];
  if (!isFilterActive) {
    orders = liveOrders.filter(o =>
      !isReservationOrder(o) && !isCancelledOrRejectedOrder(o) && !o.isReplacement
    );
  } else {
    orders = liveOrders.filter(o => {
      if (isReservationOrder(o) || isCancelledOrRejectedOrder(o) || o.isReplacement) return false;
      if (isDateOrRangeFiltered) {
        const d = parseDashboardOrderDate(o);
        if (d < rangeStart || d > rangeEnd) return false;
      }
      if (currentProd !== 'all') {
        return (o.items || []).some(item => itemMatchesVariety(item));
      }
      return true;
    });
  }

  return {
    orders,
    count: orders.length,
    isFilterActive,
    isDateOrRangeFiltered,
    rangeStart,
    rangeEnd,
    rangeLabel,
    activeVarietyLabel,
    currentRange,
    currentProd
  };
}

export function getDashboardTotalSalesData(options = {}) {
  const liveOrders = Array.isArray(options.liveOrders)
    ? options.liveOrders
    : (typeof getAllOrders === 'function' ? getAllOrders() : []);
  const productsList = Array.isArray(options.productsList)
    ? options.productsList
    : (typeof getProducts === 'function' ? getProducts() : []);

  const currentRange = options.currentRange || 'all';
  const currentProd = options.currentProd || 'all';
  const salesCustomStart = options.salesCustomStart || '';
  const salesCustomEnd = options.salesCustomEnd || '';
  const hasUserAppliedFilter = Boolean(options.hasUserAppliedFilter);

  let selectedSalesDate = null;
  if (options.selectedSalesDate instanceof Date && !isNaN(options.selectedSalesDate.getTime())) {
    selectedSalesDate = options.selectedSalesDate;
  } else if (typeof options.selectedSalesDate === 'string' && options.selectedSalesDate.trim()) {
    const parts = options.selectedSalesDate.trim().split('-').map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const parsed = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      if (!isNaN(parsed.getTime())) selectedSalesDate = parsed;
    }
  }

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let rangeStart;
  let rangeEnd = endOfToday;
  let rangeLabel = 'All Time';

  if (selectedSalesDate) {
    const selY = selectedSalesDate.getFullYear();
    const selM = selectedSalesDate.getMonth();
    const selD = selectedSalesDate.getDate();
    rangeStart = new Date(selY, selM, selD, 0, 0, 0, 0);
    rangeEnd = new Date(selY, selM, selD, 23, 59, 59, 999);
    rangeLabel = selectedSalesDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else if (currentRange === 'custom' && salesCustomStart && salesCustomEnd) {
    const [sY, sM, sD] = salesCustomStart.split('-').map(Number);
    const [eY, eM, eD] = salesCustomEnd.split('-').map(Number);
    rangeStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    rangeEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
    const sFormatted = rangeStart.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    const eFormatted = rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    rangeLabel = salesCustomStart === salesCustomEnd ? eFormatted : `${sFormatted} – ${eFormatted}`;
  } else if (currentRange === '1week') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    rangeLabel = '1 Week';
  } else if (currentRange === '1month') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeLabel = '1 Month';
  } else if (currentRange === '3months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89, 0, 0, 0, 0);
    rangeLabel = '3 Months';
  } else if (currentRange === '6months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 179, 0, 0, 0, 0);
    rangeLabel = '6 Months';
  } else if (currentRange === '1year') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 0, 0, 0, 0);
    rangeLabel = '1 Year';
  } else {
    rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
    rangeLabel = 'All Time';
  }

  let activeVarietyLabel = 'All Grains';
  let matchedProdName = '';
  if (currentProd !== 'all') {
    const matchedProdObj = productsList.find(p => String(p.id) === String(currentProd));
    if (matchedProdObj) {
      activeVarietyLabel = matchedProdObj.name;
      matchedProdName = matchedProdObj.name;
    } else {
      activeVarietyLabel = currentProd;
      matchedProdName = currentProd;
    }
  }

  function itemMatchesVariety(item) {
    if (!item || item.isReservation) return false;
    if (currentProd === 'all') return true;
    const pId = String(item.product?.id || item.productId || item.id || '');
    const pName = String(item.product?.name || item.name || item.productName || '').trim().toLowerCase();
    if (pId && pId === String(currentProd)) return true;
    if (matchedProdName && pName && pName === matchedProdName.trim().toLowerCase()) return true;
    return false;
  }

  const isDateOrRangeFiltered = Boolean(selectedSalesDate || currentRange !== 'all');
  const isFilterActive = Boolean(selectedSalesDate || (hasUserAppliedFilter && (currentRange !== 'all' || currentProd !== 'all')));

  const records = [];
  let totalSales = 0;

  if (!isFilterActive) {
    liveOrders.forEach(o => {
      const info = getVerifiedCustomerPaymentInfo(o);
      if (!info || !info.isVerified) return;
      const verifiedAmount = Number(info.amount || 0);
      totalSales += verifiedAmount;
      if (verifiedAmount > 0) {
        records.push({
          order: o,
          verifiedAmount,
          paymentInfo: info
        });
      }
    });
  } else {
    liveOrders.forEach(o => {
      const info = getVerifiedCustomerPaymentInfo(o);
      if (!info || !info.isVerified) return;
      if (isDateOrRangeFiltered) {
        const d = parseDashboardOrderDate(o);
        if (d < rangeStart || d > rangeEnd) return;
      }
      let verifiedAmount = 0;
      if (currentProd === 'all') {
        verifiedAmount = Number(info.amount || 0);
      } else {
        let orderVarietySum = 0;
        (o.items || []).forEach(item => {
          if (itemMatchesVariety(item)) {
            const qty = Number(item.quantity || 0);
            const price = Number(item.product?.price || item.price || 0);
            orderVarietySum += (price * qty);
          }
        });
        const tot = Number(o.total || o.totalPrice || o.totalBill || 0);
        const ratio = tot > 0 ? Math.min(1, info.amount / tot) : 1;
        verifiedAmount = orderVarietySum * ratio;
      }
      totalSales += verifiedAmount;
      if (verifiedAmount > 0) {
        records.push({
          order: o,
          verifiedAmount,
          paymentInfo: info
        });
      }
    });
  }

  return {
    records,
    totalSales,
    count: records.length,
    isFilterActive,
    isDateOrRangeFiltered,
    rangeStart,
    rangeEnd,
    rangeLabel,
    activeVarietyLabel,
    currentRange,
    currentProd
  };
}

export function getDashboardTopRiceProductData(options = {}) {
  const liveOrders = Array.isArray(options.liveOrders)
    ? options.liveOrders
    : (typeof getAllOrders === 'function' ? getAllOrders() : []);
  const productsList = Array.isArray(options.productsList)
    ? options.productsList
    : (typeof getProducts === 'function' ? getProducts() : []);

  const currentRange = options.currentRange || 'all';
  const currentProd = options.currentProd || 'all';
  const salesCustomStart = options.salesCustomStart || '';
  const salesCustomEnd = options.salesCustomEnd || '';
  const hasUserAppliedFilter = Boolean(options.hasUserAppliedFilter);

  let selectedSalesDate = null;
  if (options.selectedSalesDate instanceof Date && !isNaN(options.selectedSalesDate.getTime())) {
    selectedSalesDate = options.selectedSalesDate;
  } else if (typeof options.selectedSalesDate === 'string' && options.selectedSalesDate.trim()) {
    const parts = options.selectedSalesDate.trim().split('-').map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const parsed = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      if (!isNaN(parsed.getTime())) selectedSalesDate = parsed;
    }
  }

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let rangeStart;
  let rangeEnd = endOfToday;
  let rangeLabel = 'All Time';

  if (selectedSalesDate) {
    const selY = selectedSalesDate.getFullYear();
    const selM = selectedSalesDate.getMonth();
    const selD = selectedSalesDate.getDate();
    rangeStart = new Date(selY, selM, selD, 0, 0, 0, 0);
    rangeEnd = new Date(selY, selM, selD, 23, 59, 59, 999);
    rangeLabel = selectedSalesDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else if (currentRange === 'custom' && salesCustomStart && salesCustomEnd) {
    const [sY, sM, sD] = salesCustomStart.split('-').map(Number);
    const [eY, eM, eD] = salesCustomEnd.split('-').map(Number);
    rangeStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    rangeEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
    const sFormatted = rangeStart.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    const eFormatted = rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    rangeLabel = salesCustomStart === salesCustomEnd ? eFormatted : `${sFormatted} – ${eFormatted}`;
  } else if (currentRange === '1week') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    rangeLabel = '1 Week';
  } else if (currentRange === '1month') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeLabel = '1 Month';
  } else if (currentRange === '3months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89, 0, 0, 0, 0);
    rangeLabel = '3 Months';
  } else if (currentRange === '6months') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 179, 0, 0, 0, 0);
    rangeLabel = '6 Months';
  } else if (currentRange === '1year') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 0, 0, 0, 0);
    rangeLabel = '1 Year';
  } else {
    rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
    rangeLabel = 'All Time';
  }

  let activeVarietyLabel = 'All Grains';
  let matchedProdName = '';
  if (currentProd !== 'all') {
    const matchedProdObj = productsList.find(p => String(p.id) === String(currentProd));
    if (matchedProdObj) {
      activeVarietyLabel = matchedProdObj.name;
      matchedProdName = matchedProdObj.name;
    } else {
      activeVarietyLabel = currentProd;
      matchedProdName = currentProd;
    }
  }

  const isDateOrRangeFiltered = Boolean(selectedSalesDate || currentRange !== 'all');
  const isFilterActive = Boolean(selectedSalesDate || (hasUserAppliedFilter && (currentRange !== 'all' || currentProd !== 'all')));

  const productCounts = {};

  if (!isFilterActive) {
    liveOrders.forEach(o => {
      const info = getVerifiedCustomerPaymentInfo(o);
      if (info.isVerified && !info.isReservation) {
        (o.items || []).forEach(item => {
          const pName = item.product?.name || item.name || item.productName;
          if (pName && !item.isReservation) {
            productCounts[pName] = (productCounts[pName] || 0) + Number(item.quantity || 0);
          }
        });
      }
    });
  } else {
    if (currentProd === 'all' && isDateOrRangeFiltered) {
      liveOrders.forEach(o => {
        const info = getVerifiedCustomerPaymentInfo(o);
        if (info.isVerified && !info.isReservation) {
          const d = parseDashboardOrderDate(o);
          if (d >= rangeStart && d <= rangeEnd) {
            (o.items || []).forEach(item => {
              if (!item || item.isReservation) return;
              const pName = item.product?.name || item.name || item.productName;
              if (pName) {
                productCounts[pName] = (productCounts[pName] || 0) + Number(item.quantity || 0);
              }
            });
          }
        }
      });
    } else {
      liveOrders.forEach(o => {
        const info = getVerifiedCustomerPaymentInfo(o);
        if (info.isVerified && !info.isReservation) {
          (o.items || []).forEach(item => {
            const pName = item.product?.name || item.name || item.productName;
            if (pName && !item.isReservation) {
              productCounts[pName] = (productCounts[pName] || 0) + Number(item.quantity || 0);
            }
          });
        }
      });
    }
  }

  // Include active varieties from catalog so complete comparison is visible
  productsList.forEach(p => {
    if (p && p.name && productCounts[p.name] === undefined) {
      productCounts[p.name] = 0;
    }
  });

  const sortedPairs = Object.entries(productCounts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const topProductName = (sortedPairs[0] && sortedPairs[0][1] > 0) ? sortedPairs[0][0] : 'N/A';
  const topProductVol = (sortedPairs[0] && sortedPairs[0][1] > 0) ? sortedPairs[0][1] : 0;

  let totalSacks = 0;
  sortedPairs.forEach(([, qty]) => {
    totalSacks += qty;
  });

  const maxSacks = (sortedPairs[0] && sortedPairs[0][1] > 0) ? sortedPairs[0][1] : 1;

  const varieties = sortedPairs.map(([name, sacksSold], index) => {
    const isTop = index === 0 && sacksSold > 0;
    const sharePercent = totalSacks > 0 ? ((sacksSold / totalSacks) * 100) : 0;
    const barWidthPercent = maxSacks > 0 ? Math.max(sacksSold > 0 ? 6 : 0, (sacksSold / maxSacks) * 100) : 0;
    return {
      rank: index + 1,
      name,
      sacksSold,
      sharePercent: Number(sharePercent.toFixed(1)),
      barWidthPercent: Math.min(100, Number(barWidthPercent.toFixed(1))),
      isTop
    };
  });

  return {
    topProductName,
    topProductVol,
    varieties,
    totalSacks,
    isFilterActive,
    isDateOrRangeFiltered,
    rangeStart,
    rangeEnd,
    rangeLabel,
    activeVarietyLabel,
    currentRange,
    currentProd
  };
}

export function getProductSackWeightKg(product) {
  if (!product) return 25;
  if (typeof product.sackWeight === 'number' && product.sackWeight > 0) return product.sackWeight;
  if (typeof product.weight === 'number' && product.weight > 0) return product.weight;
  if (typeof product.unitWeight === 'number' && product.unitWeight > 0) return product.unitWeight;
  if (typeof product.kgPerSack === 'number' && product.kgPerSack > 0) return product.kgPerSack;
  if (typeof product.description === 'string') {
    const match = product.description.match(/(\d+)\s*kg/i);
    if (match && Number(match[1]) > 0) return Number(match[1]);
  }
  return 25;
}

export function getDashboardAvailableStockData(options = {}) {
  const productsList = Array.isArray(options.productsList)
    ? options.productsList
    : (typeof getProducts === 'function' ? getProducts() : []);

  // Filter active rice varieties
  const activeProducts = productsList.filter(p =>
    p && p.name && !p.isArchived && !p.archived && p.status !== 'archived'
  );

  let totalAvailableSacks = 0;
  let totalAvailableKg = 0;

  const varieties = activeProducts.map(p => {
    const sacks = p.availableStock !== undefined
      ? Math.max(0, Number(p.availableStock))
      : (p.stock !== undefined ? Math.max(0, Number(p.stock)) : 0);
    const sackWeightKg = getProductSackWeightKg(p);
    const kg = sacks * sackWeightKg;

    totalAvailableSacks += sacks;
    totalAvailableKg += kg;

    return {
      id: String(p.id || ''),
      name: p.name || 'Unnamed Variety',
      type: p.type || 'Rice',
      sacks,
      sackWeightKg,
      kg,
      image: p.image || '',
      price: Number(p.price || 0)
    };
  });

  // Sort descending by available sacks, then name
  varieties.sort((a, b) => {
    if (b.sacks !== a.sacks) return b.sacks - a.sacks;
    return a.name.localeCompare(b.name);
  });

  const maxSacks = Math.max(1, ...varieties.map(v => v.sacks));

  const enrichedVarieties = varieties.map((v, idx) => {
    const sharePercent = totalAvailableSacks > 0
      ? Number(((v.sacks / totalAvailableSacks) * 100).toFixed(1))
      : 0;
    const barWidthPercent = maxSacks > 0
      ? Math.min(100, Number(Math.max(v.sacks > 0 ? 5 : 0, (v.sacks / maxSacks) * 100).toFixed(1)))
      : 0;

    return {
      ...v,
      rank: idx + 1,
      sharePercent,
      barWidthPercent
    };
  });

  return {
    totalAvailableSacks,
    totalAvailableKg,
    varieties: enrichedVarieties,
    activeCount: enrichedVarieties.length
  };
}

// Automatically apply dark mode at load time on all pages to prevent theme flashing
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isDarkInit = localStorage.getItem('aurora-dark-mode') === 'true';
  applyThemeState(isDarkInit, false);

  window.addEventListener('pageshow', () => {
    const isDarkNow = localStorage.getItem('aurora-dark-mode') === 'true';
    applyThemeState(isDarkNow, false);
  });
}

// Automatically invoke layout render as early as possible
if (typeof document !== 'undefined') {
  if (document.getElementById('navbar-container') && document.getElementById('footer-container')) {
    renderLayout();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderLayout();
    }, { once: true });
  } else {
    renderLayout();
  }
}
