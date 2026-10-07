// Fills the local demo emulators with fictional accounts, plant photos,
// questions and conversations, for checking the farmer, expert and admin
// screens by hand. Forecast sheets are imported separately by
// scripts/seed-forecast-demo.mjs from the simulated forecast sample.
//
//   firebase emulators:start --config firebase.demo.json --project demo-sweetcherry
//   node tests/rules/seed-demo.mjs [folder of .jpg photos]
//
// Every account signs in with the password demo-pass-1234. Names say they are
// demo accounts and phone numbers are fictional. The script refuses to run
// unless all three Firebase hosts point at local emulators; the defaults are
// the ports in firebase.demo.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8280';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9219';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9399';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key])) {
    console.error(`Refusing to seed: ${key} is not a local emulator address.`);
    process.exit(1);
  }
}

const PROJECT_ID = 'demo-sweetcherry';
const BUCKET = `${PROJECT_ID}.appspot.com`;
const PASSWORD = 'demo-pass-1234';
const app = initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET }, 'seed-demo');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

// Start from empty emulators so the script can be run again.
await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });

const minutesAgo = (minutes) => Timestamp.fromMillis(Date.now() - minutes * 60 * 1000);

const people = {
  farmerA: { uid: 'farmerA', role: 'farmer', status: 'approved', phone: '+212600000001', name: 'مزارع تجريبي أ', city: 'إفران' },
  farmerB: { uid: 'farmerB', role: 'farmer', status: 'approved', phone: '+212600000002', name: 'مزارعة تجريبية ب', city: 'صفرو' },
  farmerC: { uid: 'farmerC', role: 'farmer', status: 'approved', phone: '+212600000007', name: 'مزارع تجريبي ج', city: 'آزرو' },
  expertA: { uid: 'expertA', role: 'expert', status: 'approved', phone: '+212600000003', name: 'خبيرة تجريبية أ', city: null },
  expertB: { uid: 'expertB', role: 'expert', status: 'approved', phone: '+212600000004', name: 'خبير تجريبي ب', city: null },
  admin: { uid: 'adminA', role: 'admin', status: 'approved', phone: '+212600000006', name: 'إدارة تجريبية', city: null },
  // Waiting for approval; a foreign number, like several live accounts.
  expertC: { uid: 'expertC', role: 'expert', status: 'pending', phone: '+966500000008', name: 'خبيرة تجريبية ج (قيد المراجعة)', city: null },
};

const photosDir = process.argv[2];
const photos = photosDir
  ? readdirSync(photosDir).filter((name) => /\.jpe?g$/i.test(name)).map((name) => join(photosDir, name))
  : [];

// Uploads a photo and returns a token URL, as getDownloadURL would in production.
const uploadPhoto = async (path, index) => {
  if (!photos.length) return '';
  const token = randomUUID();
  await bucket.file(path).save(readFileSync(photos[index % photos.length]), {
    contentType: 'image/jpeg',
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
};

const emptyReview = {
  visibleParts: [], observations: [], bodyPart: null, primaryBodyPart: null, imageQuality: null,
  problems: [], manualLabel: '', overallSeverity: null, recommendedAction: '', expertNote: '',
  reviewedBy: null, reviewedByName: null, reviewedAt: null, modelHint: null, weatherContext: null,
};

const farmerFields = (farmer) => ({
  farmerId: farmer.uid, farmerName: farmer.name, farmerRegion: farmer.city, farmerPhone: farmer.phone,
});

for (const person of Object.values(people)) {
  await getAuth(app).createUser({ uid: person.uid, email: `${person.phone.slice(1)}@sweetcherry.ma`, password: PASSWORD });
  await db.doc(`users/${person.uid}`).set({ ...person, documentUrl: null, createdAt: Date.now() - 40 * 86400000 });
}

// The pending expert's proof document, as registration would upload it.
if (photos.length) {
  const proofUrl = await uploadPhoto('expertProofs/expertC/diploma.jpg', 0);
  await db.doc('users/expertC').update({ documentUrl: proofUrl, createdAt: Date.now() - 2 * 86400000 });
}

const diagnoses = [
  { id: 'd1', farmer: people.farmerA, age: 340, data: { status: 'awaiting_expert' } },
  { id: 'd2', farmer: people.farmerC, age: 95, data: { status: 'awaiting_expert' } },
  { id: 'd3', farmer: people.farmerB, age: 70, data: { status: 'in_review', reviewedBy: 'expertB', reviewedByName: people.expertB.name, claimedAt: minutesAgo(8), updatedAt: minutesAgo(8) } },
  { id: 'd4', farmer: people.farmerA, age: 260, data: { status: 'in_review', reviewedBy: 'expertB', reviewedByName: people.expertB.name, claimedAt: minutesAgo(150), updatedAt: minutesAgo(150) } },
  {
    id: 'd5', farmer: people.farmerB, age: 1500,
    data: {
      status: 'reviewed', reviewedBy: 'expertA', reviewedByName: people.expertA.name, reviewedAt: minutesAgo(1300),
      visibleParts: ['leaf'], imageQuality: 'good', overallSeverity: 'moderate', bodyPart: 'leaf', primaryBodyPart: 'leaf',
      observations: [{ bodyPart: 'leaf', problemType: 'shot_hole', manualLabel: '', severity: 'moderate', confidence: 'high', spread: 'many_spots' }],
      problems: [{ bodyPart: 'leaf', problemType: 'shot_hole', manualLabel: '', severity: 'moderate', confidence: 'high', spread: 'many_spots' }],
      recommendedAction: 'أزل الأوراق المصابة واجمعها بعيداً عن الأشجار، ثم رش مركباً نحاسياً بعد تساقط الأوراق في الخريف.',
    },
  },
];

for (const [index, item] of diagnoses.entries()) {
  const imagePath = `visionDiagnoses/${item.farmer.uid}/${item.id}.jpg`;
  await db.doc(`visionDiagnoses/${item.id}`).set({
    ...farmerFields(item.farmer), ...emptyReview, imagePath, imageUrl: await uploadPhoto(imagePath, index),
    createdAt: minutesAgo(item.age), updatedAt: minutesAgo(item.age), ...item.data,
  });
}

const requests = [
  { id: 'r1', farmer: people.farmerC, age: 50, type: 'text', body: 'هل أبدأ الري بالتنقيط الآن؟ الحرارة نزلت في الليل إلى 3 درجات والأرض ما زالت رطبة بعد أمطار الأسبوع الماضي.' },
  { id: 'r2', farmer: people.farmerB, age: 22, type: 'image', body: 'ظهرت بقع صغيرة على الأوراق في الصفوف القريبة من الساقية.' },
  { id: 'r3', farmer: people.farmerA, age: 900, type: 'text', body: 'سؤال قديم ألغيته.', status: 'cancelled' },
];
for (const [index, item] of requests.entries()) {
  const filePath = item.type === 'image' ? `expertRequests/${item.farmer.uid}/${item.id}.jpg` : null;
  await db.doc(`expertRequests/${item.id}`).set({
    ...farmerFields(item.farmer), type: item.type, body: item.body,
    fileUrl: filePath ? await uploadPhoto(filePath, index + 2) : null, filePath,
    status: item.status ?? 'open', createdAt: minutesAgo(item.age), updatedAt: minutesAgo(item.age),
  });
}

const conversationId = 'farmerA__expertA';
await db.doc('expertRequests/r0').set({
  ...farmerFields(people.farmerA), type: 'text', body: 'أوراق أشجار بورلات تصفرّ من الأطراف منذ أسبوعين. ما السبب؟',
  fileUrl: null, filePath: null, status: 'assigned', assignedExpertId: 'expertA', assignedExpertName: people.expertA.name,
  conversationId, assignedAt: minutesAgo(180), createdAt: minutesAgo(200), updatedAt: minutesAgo(180),
});
await db.doc(`expertConversations/${conversationId}`).set({
  farmerId: 'farmerA', farmerName: people.farmerA.name, farmerPhone: people.farmerA.phone, farmerRegion: people.farmerA.city,
  expertId: 'expertA', expertName: people.expertA.name, participantIds: ['farmerA', 'expertA'], status: 'active',
  lastRequestId: 'r0', lastMessagePreview: 'أرسلت لك صورة لورقة من الصف الثالث.', lastMessageSenderId: 'farmerA',
  lastMessageSenderRole: 'farmer', unreadForFarmer: false, unreadForExpert: true,
  farmerReadAt: minutesAgo(30), expertReadAt: minutesAgo(170), createdAt: minutesAgo(180), updatedAt: minutesAgo(30),
});
const thread = [
  { id: 'request_r0', senderId: 'farmerA', senderName: people.farmerA.name, senderRole: 'farmer', type: 'text', body: 'أوراق أشجار بورلات تصفرّ من الأطراف منذ أسبوعين. ما السبب؟', requestMarker: true, requestId: 'r0', age: 200 },
  { id: 'm1', senderId: 'expertA', senderName: people.expertA.name, senderRole: 'expert', type: 'text', body: 'قد يكون نقصاً في البوتاسيوم أو إجهاداً مائياً. هل الاصفرار على الأوراق القديمة أم الجديدة؟ وأرسل صورة قريبة لورقة من الجهتين إن أمكن.', requestId: 'r0', age: 180 },
  { id: 'm2', senderId: 'farmerA', senderName: people.farmerA.name, senderRole: 'farmer', type: 'image', body: 'أرسلت لك صورة لورقة من الصف الثالث.', age: 30, photo: 4 },
];
for (const message of thread) {
  const filePath = message.photo !== undefined ? `expertConversations/${conversationId}/farmerA/${message.id}.jpg` : null;
  await db.doc(`expertConversations/${conversationId}/messages/${message.id}`).set({
    conversationId, senderId: message.senderId, senderName: message.senderName, senderRole: message.senderRole,
    type: message.type, body: message.body, fileUrl: filePath ? await uploadPhoto(filePath, message.photo) : null, filePath,
    ...(message.requestMarker ? { requestMarker: true } : {}), ...(message.requestId ? { requestId: message.requestId } : {}),
    createdAt: minutesAgo(message.age),
  });
}

for (const [index, item] of [
  { id: 'm-old-1', farmer: people.farmerC, age: 6000 },
  { id: 'm-old-2', farmer: people.farmerA, age: 9000 },
].entries()) {
  const filePath = `farmerMessages/${item.farmer.uid}/${item.id}.jpg`;
  await db.doc(`farmerMessages/${item.id}`).set({
    ...farmerFields(item.farmer), type: 'image', fileUrl: await uploadPhoto(filePath, index + 1), filePath,
    readBy: {}, replyCount: 0, lastReplyPreview: '', lastActivityAt: minutesAgo(item.age), createdAt: minutesAgo(item.age),
  });
}

await db.doc('farmerNotes/_d8_a5_d9_81_d8_b1_d8_a7_d9_86__expertA').set({
  scope: 'expert_region_current', currentKey: '_d8_a5_d9_81_d8_b1_d8_a7_d9_86:expertA', region: 'إفران',
  subject: 'الري بعد موجة البرد', body: 'أخّروا الري حتى ترتفع حرارة التربة، وتجنبوا الرش في المساء خلال هذا الأسبوع.',
  expertId: 'expertA', expertName: people.expertA.name, active: true, updatedAt: minutesAgo(600), createdAt: minutesAgo(2000),
});

// Market price reports from farmers.
const pricePosts = [
  [people.farmerA, '34', 'AA', 'M01', 1], [people.farmerB, '29.5', 'A', 'M02', 2], [people.farmerC, '41', 'AAA', 'M01', 2],
  [people.farmerA, '27', 'A', 'M03', 4], [people.farmerB, '33', 'AA', 'M02', 5], [people.farmerC, '38.5', 'AAA', 'M03', 6],
];
for (const [index, [farmer, price, quality, market, daysAgo]] of pricePosts.entries()) {
  await db.doc(`pricePosts/p${index + 1}`).set({
    farmerId: farmer.uid, farmerName: farmer.name, region: farmer.city, price, quality, imageUrl: null,
    market, date: new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10), createdAt: minutesAgo(daysAgo * 1440 - 60),
  });
}

// Farmers' room.
const chat = [
  [people.farmerC, 'هل بدأ أحد الري في آزرو هذا الأسبوع؟', 400],
  [people.farmerB, 'في صفرو انتظرنا حتى تجف التربة قليلاً بعد المطر.', 380],
  [people.farmerA, 'السوق في الدار البيضاء طلب AA أمس بثمن أعلى من الأسبوع الماضي.', 120],
];
for (const [index, [sender, content, age]] of chat.entries()) {
  await db.doc(`farmerChat/c${index + 1}`).set({ senderId: sender.uid, senderName: sender.name, type: 'text', content, createdAt: minutesAgo(age) });
}

// Daily note for Ifrane, as generateAiNote would store it.
await db.doc('aiNotes/_d8_a5_d9_81_d8_b1_d8_a7_d9_86').set({
  region: 'إفران',
  content: 'اليوم: صباح بارد مع احتمال صقيع خفيف قبل الشروق، ثم ارتفاع تدريجي للحرارة. أجّل الري إلى منتصف النهار، وتجنب الرش إذا اشتدت الرياح بعد الظهر.\nغداً: أجواء مستقرة مناسبة لمعاينة الأوراق والبحث عن بقع ثقب الرصاص بعد أمطار الأسبوع الماضي.\nبعد غد: ارتفاع الرطوبة مساءً؛ راقب الصفوف القريبة من السواقي.',
  weatherSummary: { forecast: [{}] }, generatedAt: Date.now() - 3 * 3600000, expiresAt: Date.now() + 21 * 3600000, createdBy: 'farmerA',
});

console.log(`Seeded ${Object.keys(people).length} accounts, ${diagnoses.length} photos, ${requests.length + 1} questions, 1 conversation, ${pricePosts.length} price reports${photos.length ? '' : ' (no photo folder given, so no images)'}. Import forecasts with scripts/seed-forecast-demo.mjs.`);
