// Farmer questions to experts and the conversations that follow.
// Contract and rules: functions/lib/expertRequests.mjs, firestore.rules,
// storage.rules. The first expert reply goes through the
// claimExpertRequestAndReply callable so two experts cannot take the same
// question; later messages are written here directly.
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from '../config/firebase.js';
import { STORAGE_LIMITS } from './constants.js';
import {
  EXPERT_CONVERSATIONS,
  EXPERT_CONVERSATION_MESSAGES,
  EXPERT_PENDING_REPLIES,
  EXPERT_REQUESTS,
  MESSAGE_BODY_MAX,
  messagePreview,
} from '../../functions/lib/expertRequests.mjs';

const claimCallable = httpsCallable(functions, 'claimExpertRequestAndReply');

export const REQUEST_STATUS = {
  open: 'open',
  assigned: 'assigned',
  cancelled: 'cancelled',
};

export { MESSAGE_BODY_MAX };

// ---- validation ----------------------------------------------------------

// Returns a message to show, or null when the content can be sent.
export const validateMessage = ({ type = 'text', body = '', file = null }) => {
  const text = String(body || '').trim();
  if (text.length > MESSAGE_BODY_MAX) return `النص أطول من ${MESSAGE_BODY_MAX} حرف.`;
  if (type === 'text') return text ? null : 'اكتب رسالتك أولاً.';
  if (!file) return 'لم يتم اختيار ملف.';
  if (type === 'image') {
    if (!String(file.type || '').startsWith('image/')) return 'اختر ملف صورة.';
    if (file.size >= STORAGE_LIMITS.imageBytes) return 'حجم الصورة يتجاوز 20 ميغابايت.';
  }
  if (type === 'audio' && file.size >= STORAGE_LIMITS.audioBytes) {
    return 'التسجيل الصوتي أكبر من 5 ميغابايت. سجّل رسالة أقصر.';
  }
  return null;
};

const assertSendable = (message) => {
  const problem = validateMessage(message);
  if (problem) throw new Error(problem);
};

// ---- helpers -------------------------------------------------------------

const toItem = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });

export const timestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return Date.parse(value) || 0;
};

const newestFirst = (field) => (a, b) => timestampMs(b[field]) - timestampMs(a[field]);
const oldestFirst = (field) => (a, b) => timestampMs(a[field]) - timestampMs(b[field]);

const safeFileName = (file) => {
  const name = String(file?.name || 'file').replace(/[^\w.-]+/g, '_').slice(-80);
  return `${Date.now()}-${name}`;
};

const uploadAttachment = async (folder, file) => {
  const snapshot = await uploadBytes(ref(storage, `${folder}/${safeFileName(file)}`), file, {
    contentType: file.type || undefined,
  });
  return { fileUrl: await getDownloadURL(snapshot.ref), filePath: snapshot.ref.fullPath };
};

const noAttachment = { fileUrl: null, filePath: null };

// ---- farmer --------------------------------------------------------------

export const createExpertRequest = async ({ farmer, type = 'text', body = '', file = null }) => {
  assertSendable({ type, body, file });
  const attachment =
    type === 'text' ? noAttachment : await uploadAttachment(`${EXPERT_REQUESTS}/${farmer.uid}`, file);

  const requestRef = await addDoc(collection(db, EXPERT_REQUESTS), {
    farmerId: farmer.uid,
    farmerName: farmer.name ?? '',
    farmerPhone: farmer.phone ?? null,
    farmerRegion: farmer.city ?? null,
    type,
    body: String(body || '').trim(),
    ...attachment,
    status: REQUEST_STATUS.open,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return requestRef.id;
};

export const cancelExpertRequest = (requestId) =>
  updateDoc(doc(db, EXPERT_REQUESTS, requestId), {
    status: REQUEST_STATUS.cancelled,
    updatedAt: serverTimestamp(),
  });

export const subscribeFarmerRequests = (farmerId, onData, onError) => {
  if (!farmerId) return () => {};
  const q = query(collection(db, EXPERT_REQUESTS), where('farmerId', '==', farmerId));
  return onSnapshot(q, (snap) => onData(snap.docs.map(toItem).sort(newestFirst('createdAt'))), onError);
};

// ---- expert --------------------------------------------------------------

export const subscribeOpenRequests = (onData, onError) => {
  const q = query(collection(db, EXPERT_REQUESTS), where('status', '==', REQUEST_STATUS.open));
  return onSnapshot(q, (snap) => onData(snap.docs.map(toItem).sort(oldestFirst('createdAt'))), onError);
};

// Sends the first reply and takes the question. Resolves to the callable's
// result: { ok: true, conversationId } or { ok: false, status, assignedExpertName }.
export const answerExpertRequest = async ({ requestId, expert, type = 'text', body = '', file = null }) => {
  assertSendable({ type, body, file });
  const attachment =
    type === 'text' ? {} : await uploadAttachment(`${EXPERT_PENDING_REPLIES}/${expert.uid}`, file);
  const { data } = await claimCallable({
    requestId,
    reply: { type, body: String(body || '').trim(), ...attachment },
  });
  return data;
};

// ---- conversations (both sides) -----------------------------------------

export const subscribeConversations = ({ uid, role }, onData, onError) => {
  if (!uid) return () => {};
  const field = role === 'expert' ? 'expertId' : 'farmerId';
  const q = query(collection(db, EXPERT_CONVERSATIONS), where(field, '==', uid));
  return onSnapshot(q, (snap) => onData(snap.docs.map(toItem).sort(newestFirst('updatedAt'))), onError);
};

export const subscribeMessages = (conversationId, onData, onError) => {
  if (!conversationId) return () => {};
  const q = query(
    collection(db, EXPERT_CONVERSATIONS, conversationId, EXPERT_CONVERSATION_MESSAGES),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => onData(snap.docs.map(toItem)), onError);
};

export const sendConversationMessage = async ({
  conversationId,
  sender,
  role,
  type = 'text',
  body = '',
  file = null,
}) => {
  assertSendable({ type, body, file });
  const text = String(body || '').trim();
  const attachment =
    type === 'text'
      ? noAttachment
      : await uploadAttachment(`${EXPERT_CONVERSATIONS}/${conversationId}/${sender.uid}`, file);
  const fromFarmer = role === 'farmer';

  const batch = writeBatch(db);
  batch.set(doc(collection(db, EXPERT_CONVERSATIONS, conversationId, EXPERT_CONVERSATION_MESSAGES)), {
    conversationId,
    senderId: sender.uid,
    senderName: sender.name ?? '',
    senderRole: role,
    type,
    body: text,
    ...attachment,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, EXPERT_CONVERSATIONS, conversationId), {
    lastMessagePreview: messagePreview({ type, body: text }, role),
    lastMessageSenderId: sender.uid,
    lastMessageSenderRole: role,
    unreadForFarmer: !fromFarmer,
    unreadForExpert: fromFarmer,
    [fromFarmer ? 'farmerReadAt' : 'expertReadAt']: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
};

export const markConversationRead = async ({ conversation, role }) => {
  const fromFarmer = role === 'farmer';
  const unread = fromFarmer ? conversation?.unreadForFarmer : conversation?.unreadForExpert;
  if (!conversation?.id || !unread) return;
  await updateDoc(
    doc(db, EXPERT_CONVERSATIONS, conversation.id),
    fromFarmer
      ? { unreadForFarmer: false, farmerReadAt: serverTimestamp() }
      : { unreadForExpert: false, expertReadAt: serverTimestamp() },
  );
};
