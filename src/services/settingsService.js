import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase.js';

// settings/registration says whether new accounts can be created. Without the
// document registration is closed; the security rules enforce the same.
const registrationRef = () => doc(db, 'settings', 'registration');

export const fetchRegistrationOpen = async () => {
  const snapshot = await getDoc(registrationRef());
  return snapshot.exists() && snapshot.data().open === true;
};

export const setRegistrationOpen = (open, adminUid) =>
  setDoc(registrationRef(), { open: Boolean(open), updatedAt: serverTimestamp(), updatedBy: adminUid });
