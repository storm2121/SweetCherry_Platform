import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../config/firebase.js';
import { normalizePhone, phoneToEmail } from '../utils/phone.js';

const USERS_COLLECTION = 'users';
const PROOF_MAX_BYTES = 10 * 1024 * 1024;

// Errors raised here, not by Firebase. The message is ready to show; the code
// lets the login screen tell them apart from Firebase's auth/* codes.
const appError = (code, message) => Object.assign(new Error(message), { code });

// Each phone number maps to one Firebase Auth login (<digits>@sweetcherry.ma),
// so Auth itself rejects a second registration with auth/email-already-in-use.
// Firestore rules let nobody query users before signing in.
export const registerUser = async ({
  role,
  phone,
  password,
  fullName,
  city,
  documentFile,
}) => {
  if (role !== 'farmer' && role !== 'expert') {
    throw appError('app/invalid-role', 'نوع الحساب غير صالح.');
  }
  if (role === 'expert' && documentFile && documentFile.size >= PROOF_MAX_BYTES) {
    throw appError('app/document-too-large', 'اختر وثيقة أصغر من 10 ميغابايت.');
  }

  const formattedPhone = normalizePhone(phone);
  const credentials = await createUserWithEmailAndPassword(auth, phoneToEmail(formattedPhone), password);
  const uid = credentials.user.uid;

  try {
    let documentUrl = null;
    if (role === 'expert' && documentFile) {
      const proofRef = ref(storage, `expertProofs/${uid}/${documentFile.name}`);
      const snapshot = await uploadBytes(proofRef, documentFile, { contentType: documentFile.type || undefined });
      documentUrl = await getDownloadURL(snapshot.ref);
    }

    const profile = {
      uid,
      role,
      phone: formattedPhone,
      name: String(fullName || '').trim(),
      city: role === 'farmer' ? city : null,
      status: role === 'farmer' ? 'approved' : 'pending',
      documentUrl,
      createdAt: Date.now(),
    };

    await setDoc(doc(db, USERS_COLLECTION, uid), profile);
    return profile;
  } catch (error) {
    // An account without a profile cannot sign in, and its phone number could
    // not be registered again. Remove it so the person can simply retry.
    await deleteUser(credentials.user).catch(() => {});
    throw error;
  }
};

export const loginUser = async ({ phone, password }) => {
  const formattedPhone = normalizePhone(phone);
  const credentials = await signInWithEmailAndPassword(auth, phoneToEmail(formattedPhone), password);
  return fetchUserProfile(credentials.user.uid);
};

export const fetchUserProfile = async (uid) => {
  const snapshot = await getDoc(doc(db, USERS_COLLECTION, uid));
  if (!snapshot.exists()) {
    throw appError('app/profile-missing', 'لم يكتمل إنشاء هذا الحساب. تواصل مع مسؤول المنصة.');
  }
  return { uid, ...snapshot.data() };
};
