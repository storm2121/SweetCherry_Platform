import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../config/firebase.js';
import { STORAGE_LIMITS } from './constants.js';
import { DIAGNOSIS_STATUS, VISION_DIAGNOSES } from './diagnosisConstants.js';
import { regionDocId } from './regionUtils.js';

const PRICE_POSTS = 'pricePosts';
const FARMER_CHAT = 'farmerChat';
const FARMER_MESSAGES = 'farmerMessages';
const FARMER_NOTES = 'farmerNotes';
const FARMER_NOTE_SCOPE_CURRENT = 'expert_region_current';
const AI_NOTES = 'aiNotes';
const DIAGNOSIS_IMAGE_MAX_EDGE = 1024;
const DIAGNOSIS_JPEG_QUALITY = 0.8;

export const subscribeFarmerNotes = (region, callback) => {
  if (!region) return () => {};
  const q = query(
    collection(db, FARMER_NOTES),
    where('region', '==', region),
  );
  return onSnapshot(q, (snapshot) => {
    const notes = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((note) => note.scope === FARMER_NOTE_SCOPE_CURRENT && note.active !== false)
      .sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
    callback(notes);
  });
};

export const subscribeAiNotes = (region, callback) => {
  if (!region) return () => {};
  const docRef = doc(db, AI_NOTES, regionDocId(region));
  return onSnapshot(docRef, (snapshot) => {
    callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  });
};

// A farmer's market price report. `market` (M01–M03) and `date` (the day the
// price was seen, YYYY-MM-DD) let the forecast chart compare reports with the
// range for the same market and day.
export const addPricePost = async ({ farmer, price, quality = 'A', market, date, imageFile }) => {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new Error('أدخل سعراً بين 1 و1000 درهم للكيلوغرام.');
  }

  let imageUrl = null;
  if (imageFile) {
    if (imageFile.size >= STORAGE_LIMITS.imageBytes) {
      throw new Error('حجم الصورة يتجاوز 20 ميغابايت.');
    }
    const fileRef = ref(storage, `pricePosts/${farmer.uid}/${Date.now()}-${imageFile.name}`);
    const snapshot = await uploadBytes(fileRef, imageFile, { contentType: imageFile.type || undefined });
    imageUrl = await getDownloadURL(snapshot.ref);
  }

  await addDoc(collection(db, PRICE_POSTS), {
    farmerId: farmer.uid,
    farmerName: farmer.name,
    region: farmer.city,
    price: Math.round(value * 100) / 100,
    quality,
    ...(market ? { market } : {}),
    ...(date ? { date } : {}),
    imageUrl,
    createdAt: serverTimestamp(),
  });
};

export const subscribePricePosts = (callback, onError) => {
  const q = query(collection(db, PRICE_POSTS), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const posts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(posts);
    },
    onError,
  );
};

export const deletePricePost = async (id) => {
  await deleteDoc(doc(db, PRICE_POSTS, id));
};

export const subscribeFarmerChat = (callback, onError) => {
  const q = query(collection(db, FARMER_CHAT), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(messages);
    },
    onError,
  );
};

export const sendChatMessage = async ({ sender, type = 'text', content, file }) => {
  let payload = content;

  if ((type === 'image' || type === 'audio') && file) {
    const limit = type === 'audio' ? STORAGE_LIMITS.audioBytes : STORAGE_LIMITS.imageBytes;
    if (file.size > limit) {
      throw new Error(type === 'audio' ? 'Audio exceeds 5MB limit.' : 'Image exceeds 20MB limit.');
    }
    const fileRef = ref(storage, `farmerChat/${sender.uid}/${Date.now()}-${file.name}`);
    const snapshot = await uploadBytes(fileRef, file);
    payload = await getDownloadURL(snapshot.ref);
  }

  await addDoc(collection(db, FARMER_CHAT), {
    senderId: sender.uid,
    senderName: sender.name,
    type,
    content: payload,
    createdAt: serverTimestamp(),
  });
};

export const sendFarmerMediaToExperts = async ({ farmer, type, file }) => {
  if (!file) {
    throw new Error('No file selected.');
  }

  const limit = type === 'audio' ? STORAGE_LIMITS.audioBytes : STORAGE_LIMITS.imageBytes;
  if (file.size > limit) {
    throw new Error(type === 'audio' ? 'Audio exceeds 5MB limit.' : 'Image exceeds 20MB limit.');
  }

  const fileRef = ref(storage, `farmerMessages/${farmer.uid}/${Date.now()}-${file.name}`);
  const snapshot = await uploadBytes(fileRef, file);
  const fileUrl = await getDownloadURL(snapshot.ref);

  await addDoc(collection(db, FARMER_MESSAGES), {
    farmerId: farmer.uid,
    farmerName: farmer.name,
    farmerPhone: farmer.phone,
    farmerRegion: farmer.city ?? null,
    type,
    fileUrl,
    filePath: fileRef.fullPath,
    readBy: {},
    replyCount: 0,
    lastReplyPreview: '',
    lastActivityAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
};

export const createDiagnosisSubmission = async ({ farmer, imageFile }) => {
  if (!farmer?.uid) {
    throw new Error('Farmer profile is required.');
  }
  if (!imageFile) {
    throw new Error('No image selected.');
  }
  if (imageFile.size > STORAGE_LIMITS.imageBytes) {
    throw new Error('Image exceeds 20MB limit.');
  }

  const diagnosisRef = doc(collection(db, VISION_DIAGNOSES));
  const imagePath = `${VISION_DIAGNOSES}/${farmer.uid}/${diagnosisRef.id}.jpg`;
  const imageBlob = await resizeDiagnosisImage(imageFile);
  const imageRef = ref(storage, imagePath);
  const snapshot = await uploadBytes(imageRef, imageBlob, {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
  });
  const imageUrl = await getDownloadURL(snapshot.ref);

  await setDoc(diagnosisRef, {
    farmerId: farmer.uid,
    farmerName: farmer.name ?? '',
    farmerRegion: farmer.city ?? null,
    farmerPhone: farmer.phone ?? null,
    imagePath,
    imageUrl,
    status: DIAGNOSIS_STATUS.awaiting,
    visibleParts: [],
    observations: [],
    bodyPart: null,
    primaryBodyPart: null,
    imageQuality: null,
    problems: [],
    manualLabel: '',
    overallSeverity: null,
    recommendedAction: '',
    expertNote: '',
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    modelHint: null,
    weatherContext: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { id: diagnosisRef.id, imageUrl };
};

export const subscribeFarmerDiagnoses = (farmerId, callback) => {
  if (!farmerId) return () => {};
  const q = query(
    collection(db, VISION_DIAGNOSES),
    where('farmerId', '==', farmerId),
  );
  return onSnapshot(q, (snapshot) => {
    const diagnoses = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    callback(diagnoses);
  });
};

export const subscribeFarmerMediaMessages = (farmerId, callback) => {
  if (!farmerId) return () => {};
  const q = query(
    collection(db, FARMER_MESSAGES),
    where('farmerId', '==', farmerId),
  );
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    callback(messages);
  });
};

const resizeDiagnosisImage = async (file) => {
  const image = await loadImageSource(file);
  const { width, height } = getDiagnosisImageSize(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);

  if (typeof image.close === 'function') {
    image.close();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to process image.'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      DIAGNOSIS_JPEG_QUALITY,
    );
  });
};

const loadImageSource = async (file) => {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const getDiagnosisImageSize = (sourceWidth, sourceHeight) => {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  if (longestEdge <= DIAGNOSIS_IMAGE_MAX_EDGE) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const scale = DIAGNOSIS_IMAGE_MAX_EDGE / longestEdge;
  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  };
};

const timestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
};
