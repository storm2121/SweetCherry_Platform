// Shared setup for the rules tests. The emulators run under the demo project
// "demo-sweetcherry", which cannot reach any real Firebase resource.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const root = new URL('../../', import.meta.url);

export const PROJECT_ID = 'demo-sweetcherry';

export const USERS = {
  farmer: { uid: 'farmerA', role: 'farmer', status: 'approved', phone: '+212600000001', name: 'مزارع أ', city: 'إفران' },
  otherFarmer: { uid: 'farmerB', role: 'farmer', status: 'approved', phone: '+212600000002', name: 'مزارع ب', city: 'صفرو' },
  expert: { uid: 'expertA', role: 'expert', status: 'approved', phone: '+212600000003', name: 'خبير أ', city: null },
  otherExpert: { uid: 'expertB', role: 'expert', status: 'approved', phone: '+212600000004', name: 'خبير ب', city: null },
  pendingExpert: { uid: 'expertP', role: 'expert', status: 'pending', phone: '+212600000005', name: 'خبير قيد المراجعة', city: null },
  admin: { uid: 'adminA', role: 'admin', status: 'approved', phone: '+212600000006', name: 'Admin', city: null },
};

export const emailFor = (user) => `${user.phone.replace('+', '')}@sweetcherry.ma`;

export const createEnv = () =>
  initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('firestore.rules', root), 'utf8') },
    storage: { rules: readFileSync(new URL('storage.rules', root), 'utf8') },
  });

export const as = (env, user) => env.authenticatedContext(user.uid, { email: emailFor(user) });

export const seedUsers = (env) =>
  env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const user of Object.values(USERS)) {
      await setDoc(doc(db, 'users', user.uid), { ...user, documentUrl: null, createdAt: Date.now() });
    }
  });

export const seed = (env, path, data) =>
  env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
