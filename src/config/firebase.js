import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

// The clean project defaults to isolated local emulators. A real project is opt-in.
const useEmulators = import.meta.env.VITE_USE_EMULATORS !== 'false';
// Each variable is read by its full name so that Vite inlines only these
// values: import.meta.env[name] would copy every VITE_ variable, secrets
// included, into the public bundle.
const setting = (name, value, demoValue) => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  if (useEmulators) return demoValue;
  throw new Error(`Missing ${name}. Configure your Firebase project in .env.`);
};
const firebaseConfig = {
  apiKey: setting('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY, 'demo-api-key'),
  authDomain: setting('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, 'localhost'),
  projectId: setting('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID, 'demo-sweetcherry'),
  storageBucket: setting('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, 'demo-sweetcherry.appspot.com'),
  messagingSenderId: setting('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, '0'),
  appId: setting('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID, 'demo-app'),
};
if (useEmulators && !firebaseConfig.projectId.startsWith('demo-')) {
  throw new Error('Emulator mode requires a demo- project ID.');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || 'europe-west1');
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9219', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8280);
  connectStorageEmulator(storage, '127.0.0.1', 9399);
  connectFunctionsEmulator(functions, '127.0.0.1', 5101);
}
export { app, auth, db, storage, functions, useEmulators };
