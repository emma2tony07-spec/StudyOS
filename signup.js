// ─────────────────────────────────────────────
//  signup.js  —  Firebase Auth (email/password)
//  Exports: auth, database, onAuthStateChanged
// ─────────────────────────────────────────────

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Firebase config ────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAiJVVn4hNz9W5hHbQfn_PcKzxk3qU7TEo",
  authDomain:        "studyos-acb13.firebaseapp.com",
  projectId:         "studyos-acb13",
  storageBucket:     "studyos-acb13.firebasestorage.app",
  messagingSenderId: "266931038247",
  appId:             "1:266931038247:web:98327120f879c9577fc602"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth     = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export { onAuthStateChanged };

// ── UI helpers ─────────────────────────────────────────────────
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function setAuthLoading(loading) {
  const signInBtn  = document.getElementById('signin-btn');
  const signUpBtn  = document.getElementById('signup-btn');
  const tabBtns    = document.querySelectorAll('.auth-tab');
  [signInBtn, signUpBtn, ...tabBtns].forEach(b => { if (b) b.disabled = loading; });

  const btnActive = document.querySelector('.auth-tab.active')?.dataset.tab === 'signup'
    ? signUpBtn : signInBtn;
  if (!btnActive) return;
  btnActive.querySelector('.btn-text').style.display    = loading ? 'none'        : 'inline-flex';
  btnActive.querySelector('.btn-loading').style.display = loading ? 'inline-flex' : 'none';
}

// ── Tab switching (Sign In ↔ Sign Up) ──────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const isSignup = tab.dataset.tab === 'signup';
    document.getElementById('signin-fields').style.display = isSignup ? 'none'  : 'flex';
    document.getElementById('signup-fields').style.display = isSignup ? 'flex'  : 'none';
    document.getElementById('signin-btn').style.display    = isSignup ? 'none'  : 'flex';
    document.getElementById('signup-btn').style.display    = isSignup ? 'flex'  : 'none';

    const el = document.getElementById('auth-error');
    if (el) el.style.display = 'none';
  });
});

// ── Sign Up ────────────────────────────────────────────────────
document.getElementById('signup-btn')?.addEventListener('click', async () => {
  const name     = document.getElementById('signup-name')?.value.trim();
  const email    = document.getElementById('signup-email')?.value.trim();
  const password = document.getElementById('signup-password')?.value;
  const confirm  = document.getElementById('signup-confirm')?.value;

  if (!name)                          return showAuthError('Please enter your name.');
  if (!email)                         return showAuthError('Please enter your email.');
  if (!password)                      return showAuthError('Please enter a password.');
  if (password.length < 6)            return showAuthError('Password must be at least 6 characters.');
  if (password !== confirm)           return showAuthError('Passwords do not match.');

  setAuthLoading(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // Save profile to Realtime DB
    await set(ref(database, `users/${cred.user.uid}/profile`), {
      name,
      email,
      createdAt: new Date().toISOString(),
      lastSeen:  new Date().toISOString()
    });
  } catch (e) {
    setAuthLoading(false);
    switch (e.code) {
      case 'auth/email-already-in-use': return showAuthError('That email is already registered. Sign in instead.');
      case 'auth/invalid-email':        return showAuthError('Invalid email address.');
      case 'auth/weak-password':        return showAuthError('Password is too weak. Use at least 6 characters.');
      default:                          return showAuthError(e.message);
    }
  }
});

// ── Sign In ────────────────────────────────────────────────────
document.getElementById('signin-btn')?.addEventListener('click', async () => {
  const email    = document.getElementById('signin-email')?.value.trim();
  const password = document.getElementById('signin-password')?.value;

  if (!email)    return showAuthError('Please enter your email.');
  if (!password) return showAuthError('Please enter your password.');

  setAuthLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    setAuthLoading(false);
    switch (e.code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return showAuthError('Incorrect email or password.');
      case 'auth/invalid-email':      return showAuthError('Invalid email address.');
      case 'auth/too-many-requests':  return showAuthError('Too many attempts. Try again later.');
      default:                        return showAuthError(e.message);
    }
  }
});

// ── Sign Out ───────────────────────────────────────────────────
document.getElementById('signout-btn')?.addEventListener('click', async () => {
  if (confirm('Sign out of StudyOS?')) await signOut(auth);
});

// ── Auth state → show/hide login vs app ───────────────────────
onAuthStateChanged(auth, (user) => {
  const loginPage = document.getElementById('login-page');
  const appDiv    = document.getElementById('app');

  if (user) {
    if (loginPage) loginPage.style.display = 'none';
    if (appDiv)    appDiv.classList.add('visible');
  } else {
    if (loginPage) loginPage.style.display = 'flex';
    if (appDiv)    appDiv.classList.remove('visible');
    setAuthLoading(false);
  }
});


