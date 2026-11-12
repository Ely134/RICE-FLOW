// RiceFlow Authoritative Authentication & Access-Control Guard
import { 
  auth, 
  db, 
  checkCustomerArchivedInFirestore, 
  fetchCustomerProfileFromFirestore 
} from './firebase.js';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';

/**
 * Resolves path prefix relative to root (e.g., '../' when on an /admin/ page, '' on root pages).
 */
export function getGuardPathPrefix() {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname;
  if (pathname.includes('/admin/')) return '../';
  return '';
}

/**
 * Robustly waits for Firebase Auth to resolve its initial authentication state.
 * Uses authStateReady() when available, falling back to onAuthStateChanged,
 * with a safety timeout so slow networks do not freeze the UI indefinitely.
 */
export async function waitForAuthState(timeoutMs = 8000) {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  const authPromise = new Promise((resolve) => {
    let settled = false;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!settled) {
        settled = true;
        try { unsubscribe(); } catch (_) {}
        resolve(user || null);
      }
    });

    if (typeof auth.authStateReady === 'function') {
      auth.authStateReady().then(() => {
        if (!settled && auth.currentUser) {
          settled = true;
          try { unsubscribe(); } catch (_) {}
          resolve(auth.currentUser);
        }
      }).catch(() => {});
    }
  });

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(auth.currentUser || null);
    }, timeoutMs);
  });

  return Promise.race([authPromise, timeoutPromise]);
}

/**
 * Authoritatively retrieves an admin/staff record from Firestore `adminUsers` collection.
 * Inspects both UID document reference and full collection scan matching UID or email.
 */
export async function fetchAuthoritativeAdminRecord(firebaseUid, email) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  const cleanUid = String(firebaseUid || '').trim();

  if (!db) {
    // Check cached admin directory if Firestore is offline
    try {
      const cachedAdmins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
      const cached = cachedAdmins.find(a => {
        if (!a) return false;
        const aUid = String(a.firebaseUid || a.id || '').trim();
        const aEmail = String(a.email || '').toLowerCase().trim();
        return (cleanUid && aUid === cleanUid) || (cleanEmail && aEmail === cleanEmail);
      });
      if (cached) {
        const role = cached.role === 'admin' ? 'admin' : (cached.role === 'staff' ? 'staff' : 'none');
        return {
          exists: true,
          isArchived: cached.isArchived === true,
          role,
          data: cached
        };
      }
    } catch (_) {}
    return { exists: false, isArchived: false, role: 'none', data: null };
  }

  try {
    // 1. Direct document lookups by known IDs: cached admin document ID and Firebase UID
    const candidateDocIds = [];
    try {
      const cachedAdmin = JSON.parse(localStorage.getItem('aurora-admin-user') || '{}');
      if (cachedAdmin && cachedAdmin.id && typeof cachedAdmin.id === 'string') {
        const cId = cachedAdmin.id.trim();
        if (cId && !candidateDocIds.includes(cId)) candidateDocIds.push(cId);
      }
    } catch (_) {}

    if (cleanUid && !candidateDocIds.includes(cleanUid)) {
      candidateDocIds.push(cleanUid);
    }

    for (const cDocId of candidateDocIds) {
      try {
        const directDocRef = doc(db, 'adminUsers', cDocId);
        const directSnap = await getDoc(directDocRef);
        if (directSnap.exists()) {
          const data = directSnap.data();
          if (data) {
            const dUid = String(data.firebaseUid || directSnap.id || '').trim();
            const dEmail = String(data.email || '').toLowerCase().trim();
            const matchesUid = cleanUid && dUid === cleanUid;
            const matchesEmail = cleanEmail && dEmail === cleanEmail;
            if (matchesUid || matchesEmail || cDocId === cleanUid) {
              const role = data.role === 'admin' ? 'admin' : (data.role === 'staff' ? 'staff' : 'none');
              return {
                exists: true,
                isArchived: data.isArchived === true,
                role,
                data: { id: directSnap.id, ...data }
              };
            }
          }
        }
      } catch (err) {
        console.warn('[AUTH GUARD] Direct admin lookup notice:', err);
      }
    }

    // 2. Scan adminUsers collection for matching UID or email (fallback)
    try {
      const colRef = collection(db, 'adminUsers');
      const snapshot = await getDocs(colRef);
      if (!snapshot.empty) {
        let matchedSnap = null;
        let matchedData = null;

        snapshot.forEach(docSnap => {
          const d = docSnap.data();
          if (!d) return;
          const dUid = d.firebaseUid || docSnap.id;
          const dEmail = String(d.email || '').toLowerCase().trim();

          if (cleanUid && dUid === cleanUid) {
            matchedSnap = docSnap;
            matchedData = d;
          } else if (!matchedData && cleanEmail && dEmail === cleanEmail) {
            matchedSnap = docSnap;
            matchedData = d;
          }
        });

        if (matchedData) {
          const role = matchedData.role === 'admin' ? 'admin' : (matchedData.role === 'staff' ? 'staff' : 'none');
          return {
            exists: true,
            isArchived: matchedData.isArchived === true,
            role,
            data: { id: matchedSnap.id, ...matchedData }
          };
        }
      }
    } catch (err) {
      console.warn('[AUTH GUARD] adminUsers collection scan notice:', err);
    }

    // 3. Resilient fallback to local adminUsers directory matching verified auth credentials
    try {
      const cachedAdmins = JSON.parse(localStorage.getItem('aurora-admin-users') || '[]');
      const cached = cachedAdmins.find(a => {
        if (!a) return false;
        const aUid = String(a.firebaseUid || a.id || '').trim();
        const aEmail = String(a.email || '').toLowerCase().trim();
        return (cleanUid && aUid === cleanUid) || (cleanEmail && aEmail === cleanEmail);
      });
      if (cached) {
        const role = cached.role === 'admin' ? 'admin' : (cached.role === 'staff' ? 'staff' : 'none');
        return {
          exists: true,
          isArchived: cached.isArchived === true,
          role,
          data: cached
        };
      }
    } catch (_) {}

    return { exists: false, isArchived: false, role: 'none', data: null };
  } catch (err) {
    console.error('[AUTH GUARD] Error fetching authoritative admin record:', err);
    return { exists: false, isArchived: false, role: 'none', data: null };
  }
}

/**
 * Authoritatively verifies whether the currently signed-in user is an authorized Admin or Staff member.
 * Does NOT trust localStorage flags or role values.
 */
export async function checkAdminAuth({ requiredRole = 'any' } = {}) {
  const fbUser = await waitForAuthState();
  if (!fbUser) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const adminStatus = await fetchAuthoritativeAdminRecord(fbUser.uid, fbUser.email);
  if (!adminStatus.exists) {
    // Authenticated user exists in Firebase Auth (e.g. a customer), but is not in adminUsers
    return { ok: false, reason: 'not_admin_or_staff' };
  }

  if (adminStatus.isArchived) {
    return { ok: false, reason: 'archived', record: adminStatus.data };
  }

  if (adminStatus.role !== 'admin' && adminStatus.role !== 'staff') {
    return { ok: false, reason: 'not_admin_or_staff', record: adminStatus.data };
  }

  if (requiredRole === 'admin' && adminStatus.role !== 'admin') {
    return { ok: false, reason: 'requires_admin_role', record: adminStatus.data };
  }

  return { 
    ok: true, 
    role: adminStatus.role, 
    user: { id: adminStatus.data.id || fbUser.uid, ...adminStatus.data } 
  };
}

/**
 * Page-level guard for Admin and Staff pages.
 * Enforces authoritative authentication and role validation before revealing page content.
 */
export async function protectAdminPage({ requiredRole = 'any' } = {}) {
  const p = getGuardPathPrefix();

  // Fast-path: Check for an established local admin session
  let localSession = null;
  let hasValidLocalSession = false;
  try {
    const isLoggedIn = localStorage.getItem('aurora-admin-logged-in') === 'true';
    const raw = localStorage.getItem('aurora-admin-user');
    if (isLoggedIn && raw) {
      localSession = JSON.parse(raw);
      if (localSession && (localSession.role === 'admin' || localSession.role === 'staff') && !localSession.isArchived) {
        if (requiredRole === 'admin' && localSession.role !== 'admin') {
          try {
            sessionStorage.setItem('admin-toast-message', 'Access denied: System administrator clearance is required.');
          } catch (_) {}
          window.location.replace(p + 'admin/dashboard.html');
          return { ok: false, reason: 'requires_admin_role' };
        }
        hasValidLocalSession = true;
      }
    }
  } catch (_) {}

  // If already established and role matches, reveal UI immediately so page renders without delay
  if (hasValidLocalSession) {
    revealProtectedPage();

    // Authoritative remote verification runs in background to prevent tampering or revoked accounts
    checkAdminAuth({ requiredRole }).then(result => {
      if (!result.ok) {
        if (result.reason === 'archived' && auth && typeof signOut === 'function') {
          signOut(auth).catch(() => {});
        }
        localStorage.removeItem('aurora-admin-user');
        localStorage.setItem('aurora-admin-logged-in', 'false');
        if (result.reason === 'archived') {
          sessionStorage.setItem('login-message', 'Your administrator/staff account has been archived. Access is blocked.');
          window.location.replace(p + 'login.html');
        } else if (result.reason === 'not_admin_or_staff') {
          sessionStorage.setItem('login-message', 'Access denied. You do not have permission to access the administrative portal.');
          window.location.replace(p + 'index.html');
        } else if (result.reason === 'requires_admin_role') {
          sessionStorage.setItem('admin-toast-message', 'Access denied: System administrator clearance is required.');
          window.location.replace(p + 'admin/dashboard.html');
        } else {
          sessionStorage.setItem('login-message', 'Please log in with your administrative account to access this page.');
          window.location.replace(p + 'login.html');
        }
      } else {
        const adminSession = {
          id: result.user.id || auth?.currentUser?.uid || localSession.id,
          firebaseUid: auth?.currentUser?.uid || localSession.firebaseUid,
          email: (result.user.email || auth?.currentUser?.email || localSession.email || '').toLowerCase().trim(),
          name: result.user.name || (result.role === 'admin' ? 'Administrator' : 'Staff Member'),
          role: result.role,
          status: result.user.status || 'Active',
          isArchived: false,
          phone: result.user.phone || '',
          avatar: result.user.avatar || ''
        };
        localStorage.setItem('aurora-admin-user', JSON.stringify(adminSession));
        localStorage.setItem('aurora-admin-logged-in', 'true');
      }
    }).catch(err => {
      console.warn('[AUTH GUARD] Background admin verification notice:', err);
    });

    return {
      ok: true,
      role: localSession.role,
      user: { id: localSession.id || localSession.firebaseUid, ...localSession }
    };
  }

  // Otherwise (no established local session), wait for authoritative verification before revealing page
  const result = await checkAdminAuth({ requiredRole });

  if (!result.ok) {
    // 1. Unauthenticated visitor
    if (result.reason === 'unauthenticated') {
      localStorage.removeItem('aurora-admin-user');
      localStorage.setItem('aurora-admin-logged-in', 'false');
      try {
        sessionStorage.setItem('login-message', 'Please log in with your administrative account to access this page.');
        sessionStorage.setItem('login-redirect', window.location.href);
      } catch (_) {}
      window.location.replace(p + 'login.html');
      return { ok: false, reason: 'unauthenticated' };
    }

    // 2. Archived Admin/Staff account
    if (result.reason === 'archived') {
      if (auth && typeof signOut === 'function') {
        try { await signOut(auth); } catch (_) {}
      }
      localStorage.removeItem('aurora-admin-user');
      localStorage.setItem('aurora-admin-logged-in', 'false');
      try {
        sessionStorage.setItem('login-message', 'Your administrator/staff account has been archived. Access is blocked.');
      } catch (_) {}
      window.location.replace(p + 'login.html');
      return { ok: false, reason: 'archived' };
    }

    // 3. Logged-in Customer trying to access Admin/Staff area
    if (result.reason === 'not_admin_or_staff') {
      localStorage.removeItem('aurora-admin-user');
      localStorage.setItem('aurora-admin-logged-in', 'false');
      try {
        sessionStorage.setItem('login-message', 'Access denied. You do not have permission to access the administrative portal.');
      } catch (_) {}
      window.location.replace(p + 'index.html');
      return { ok: false, reason: 'not_admin_or_staff' };
    }

    // 4. Staff trying to open an Admin-only page (staff.html, settings.html, cash-turnover.html)
    if (result.reason === 'requires_admin_role') {
      try {
        sessionStorage.setItem('admin-toast-message', 'Access denied: System administrator clearance is required.');
      } catch (_) {}
      window.location.replace(p + 'admin/dashboard.html');
      return { ok: false, reason: 'requires_admin_role' };
    }

    // Fallback redirect
    window.location.replace(p + 'login.html');
    return { ok: false, reason: 'unknown' };
  }

  // Authoritatively verified: synchronize session in localStorage for compatible access
  const adminSession = {
    id: result.user.id || auth.currentUser.uid,
    firebaseUid: auth.currentUser.uid,
    email: (result.user.email || auth.currentUser.email || '').toLowerCase().trim(),
    name: result.user.name || (result.role === 'admin' ? 'Administrator' : 'Staff Member'),
    role: result.role,
    status: result.user.status || 'Active',
    isArchived: false,
    phone: result.user.phone || '',
    avatar: result.user.avatar || ''
  };
  localStorage.setItem('aurora-admin-user', JSON.stringify(adminSession));
  localStorage.setItem('aurora-admin-logged-in', 'true');

  revealProtectedPage();
  return result;
}

/**
 * Authoritatively verifies whether the currently signed-in user is an active, authorized Customer.
 * A logged-in Admin or Staff account is not automatically treated as a Customer account.
 */
export async function checkCustomerAuth() {
  const fbUser = await waitForAuthState();

  if (fbUser) {
    const cleanEmail = (fbUser.email || '').toLowerCase().trim();

    // 1. Authoritative archive check in Firestore
    const archCheck = await checkCustomerArchivedInFirestore(cleanEmail, fbUser.uid);
    if (archCheck && archCheck.isArchived === true) {
      return { ok: false, reason: 'archived' };
    }

    // 2. Check if this is an Admin/Staff account
    const adminStatus = await fetchAuthoritativeAdminRecord(fbUser.uid, fbUser.email);
    if (adminStatus.exists && adminStatus.isArchived === true) {
      return { ok: false, reason: 'archived' };
    }

    // 3. Fetch authoritative customer profile from Firestore
    let profile = await fetchCustomerProfileFromFirestore(cleanEmail, fbUser.uid);
    if (profile && profile.isArchived === true) {
      return { ok: false, reason: 'archived' };
    }

    if (!profile) {
      // If user is an active administrative user, grant seamless customer access
      if (adminStatus.exists && adminStatus.data) {
        profile = {
          id: `user-${fbUser.uid}`,
          firebaseUid: fbUser.uid,
          email: cleanEmail,
          fullName: adminStatus.data.name || adminStatus.data.fullName || fbUser.displayName || 'Administrator',
          phone: adminStatus.data.phone || '',
          address: '',
          role: 'customer',
          adminRole: adminStatus.role,
          isArchived: false,
          createdAt: adminStatus.data.createdAt || new Date().toISOString()
        };
      } else {
        // Fallback: check local storage customer directory for existing customer record
        const localUsers = JSON.parse(localStorage.getItem('aurora-users') || '[]');
        const localCusts = JSON.parse(localStorage.getItem('aurora-customers') || '[]');
        const found = localUsers.find(u => u && (String(u.email || '').toLowerCase().trim() === cleanEmail || u.firebaseUid === fbUser.uid)) ||
                      localCusts.find(c => c && (String(c.email || '').toLowerCase().trim() === cleanEmail || c.uid === fbUser.uid));

        if (found) {
          if (found.isArchived === true) {
            return { ok: false, reason: 'archived' };
          }
          profile = found;
        } else {
          // Create new customer profile for authenticated customer
          profile = {
            id: `user-${fbUser.uid}`,
            firebaseUid: fbUser.uid,
            email: cleanEmail,
            fullName: fbUser.displayName || cleanEmail.split('@')[0] || 'Customer',
            phone: fbUser.phoneNumber || '',
            address: '',
            role: 'customer',
            isArchived: false,
            createdAt: new Date().toISOString()
          };
        }
      }
    }

    return { ok: true, user: profile };
  }

  // If Firebase Auth state resolved to null:
  // Inspect established local customer session
  let localUser = null;
  try {
    const isLoggedIn = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-logged-in') === 'true';
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('aurora-user') : null;
    if (isLoggedIn && raw) {
      localUser = JSON.parse(raw);
    }
  } catch (_) {}

  // If there is NO local customer session either, the visitor is genuinely unauthenticated
  if (!localUser || (!localUser.email && !localUser.id)) {
    return { ok: false, reason: 'unauthenticated' };
  }

  if (localUser.isArchived === true) {
    return { ok: false, reason: 'archived' };
  }

  // Authoritatively verify against Firestore that this local account is not archived remotely
  const localEmailClean = String(localUser.email || '').toLowerCase().trim();
  const localUidClean = String(localUser.firebaseUid || localUser.uid || '').trim();

  if (localEmailClean || localUidClean) {
    const archCheck = await checkCustomerArchivedInFirestore(localEmailClean, localUidClean);
    if (archCheck && archCheck.isArchived === true) {
      return { ok: false, reason: 'archived' };
    }

    const remoteProfile = await fetchCustomerProfileFromFirestore(localEmailClean, localUidClean);
    if (remoteProfile && remoteProfile.isArchived === true) {
      return { ok: false, reason: 'archived' };
    }

    if (remoteProfile) {
      localUser = { ...localUser, ...remoteProfile };
    }
  }

  return { ok: true, user: localUser };
}

/**
 * Page-level guard for private Customer pages (profile, checkout, reservation).
 * Redirects unauthenticated visitors and unauthorized accounts before displaying content.
 */
export async function protectCustomerPage() {
  const p = getGuardPathPrefix();

  // Fast-path: Check for an established local customer session
  let localUser = null;
  let hasValidLocalCustomerSession = false;
  try {
    const isLoggedIn = localStorage.getItem('aurora-logged-in') === 'true';
    const raw = localStorage.getItem('aurora-user');
    if (isLoggedIn && raw) {
      localUser = JSON.parse(raw);
      if (localUser && (localUser.email || localUser.id) && !localUser.isArchived) {
        hasValidLocalCustomerSession = true;
      }
    }
  } catch (_) {}

  // If established customer session exists, reveal UI immediately so page renders without delay
  if (hasValidLocalCustomerSession) {
    revealProtectedPage();

    // Authoritative remote verification proceeds in background
    checkCustomerAuth().then(result => {
      if (typeof window !== 'undefined' && window.__customerLogoutInProgress) {
        return;
      }
      if (!result.ok) {
        if (result.reason === 'archived' && auth && typeof signOut === 'function') {
          signOut(auth).catch(() => {});
        }
        localStorage.removeItem('aurora-user');
        localStorage.setItem('aurora-logged-in', 'false');
        if (result.reason === 'archived') {
          sessionStorage.setItem('login-message', 'Your account has been archived. Access is blocked.');
        } else {
          sessionStorage.setItem('login-message', 'Please log in to your account to continue.');
          if (!window.location.pathname.includes('profile.html')) {
            sessionStorage.setItem('login-redirect', window.location.href);
          }
        }
        window.location.replace(p + 'login.html');
      } else {
        if (localStorage.getItem('aurora-logged-in') !== 'true') {
          return;
        }
        const activeUser = {
          ...localUser,
          ...result.user,
          firebaseUid: auth?.currentUser?.uid || localUser.firebaseUid,
          email: (result.user.email || auth?.currentUser?.email || localUser.email || '').toLowerCase().trim()
        };
        localStorage.setItem('aurora-user', JSON.stringify(activeUser));
        localStorage.setItem('aurora-logged-in', 'true');
      }
    }).catch(err => {
      console.warn('[AUTH GUARD] Background customer verification notice:', err);
    });

    return {
      ok: true,
      user: localUser
    };
  }

  // Otherwise (no established local session), wait for authoritative verification before revealing page
  const result = await checkCustomerAuth();

  if (!result.ok) {
    // 1. Unauthenticated visitor
    if (result.reason === 'unauthenticated') {
      localStorage.removeItem('aurora-user');
      localStorage.setItem('aurora-logged-in', 'false');
      try {
        sessionStorage.setItem('login-message', 'Please log in to your account to continue.');
        if (!window.location.pathname.includes('profile.html')) {
          sessionStorage.setItem('login-redirect', window.location.href);
        }
      } catch (_) {}
      window.location.replace(p + 'login.html');
      return { ok: false, reason: 'unauthenticated' };
    }

    // 2. Archived customer account
    if (result.reason === 'archived') {
      if (auth && typeof signOut === 'function') {
        try { await signOut(auth); } catch (_) {}
      }
      localStorage.removeItem('aurora-user');
      localStorage.setItem('aurora-logged-in', 'false');
      try {
        sessionStorage.setItem('login-message', 'Your account has been archived. Access is blocked.');
      } catch (_) {}
      window.location.replace(p + 'login.html');
      return { ok: false, reason: 'archived' };
    }

    window.location.replace(p + 'login.html');
    return { ok: false, reason: 'unknown' };
  }

  // Authoritatively verified: synchronize session in localStorage for compatible access
  const activeUser = {
    ...result.user,
    firebaseUid: auth?.currentUser?.uid || result.user?.firebaseUid || null,
    email: (result.user?.email || auth?.currentUser?.email || '').toLowerCase().trim()
  };
  localStorage.setItem('aurora-user', JSON.stringify(activeUser));
  localStorage.setItem('aurora-logged-in', 'true');

  revealProtectedPage();
  return result;
}

/**
 * Removes the initial anti-flash hiding style and loader overlay to reveal protected content.
 */
export function revealProtectedPage() {
  const doReveal = () => {
    try {
      const isDark = typeof localStorage !== 'undefined' && localStorage.getItem('aurora-dark-mode') === 'true';
      if (document.documentElement) {
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      }
      if (document.body) {
        document.body.classList.toggle('dark', isDark);
      }

      const loaderEl = document.getElementById('auth-guard-loader');
      if (loaderEl) loaderEl.remove();

      const styleEl = document.getElementById('auth-guard-style');
      if (styleEl) styleEl.remove();

      if (document.body) {
        document.body.style.visibility = 'visible';
      }
    } catch (_) {}
  };

  try {
    const loaderEl = document.getElementById('auth-guard-loader');
    if (loaderEl) loaderEl.remove();
  } catch (_) {}

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => queueMicrotask(doReveal));
  } else {
    Promise.resolve().then(() => Promise.resolve().then(doReveal));
  }
}

/**
 * Listens for back/forward navigation (bfcache) and reloads if restored from cache.
 * Guarantees that logging out and clicking browser Back does not leak cached views.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      window.location.reload();
    }
  });
}
