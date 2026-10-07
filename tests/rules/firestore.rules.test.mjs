// Firestore rules. Payloads copy what src/services/* send, so a passing test
// means the current client keeps working under these rules.
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { USERS, as, createEnv, emailFor, seed, seedUsers } from './env.mjs';

let env;
const db = (user) => as(env, user).firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await createEnv();
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
});

// --- payloads mirrored from the client ------------------------------------

const newProfile = (user, overrides = {}) => ({
  uid: user.uid,
  role: user.role,
  phone: user.phone,
  name: user.name,
  city: user.role === 'farmer' ? user.city : null,
  status: user.role === 'farmer' ? 'approved' : 'pending',
  documentUrl: null,
  createdAt: Date.now(),
  ...overrides,
});

// The registration switch an admin writes from the dashboard.
const registrationSwitch = (user, open) => ({ open, updatedAt: serverTimestamp(), updatedBy: user.uid });
const openRegistration = () => seed(env, 'settings/registration', { open: true, updatedAt: new Date(), updatedBy: USERS.admin.uid });

const pricePost = (user, overrides = {}) => ({
  farmerId: user.uid,
  farmerName: user.name,
  region: user.city,
  price: '35',
  quality: 'AA',
  imageUrl: null,
  createdAt: serverTimestamp(),
  ...overrides,
});

const diagnosisSubmission = (user, diagnosisId, overrides = {}) => ({
  farmerId: user.uid,
  farmerName: user.name,
  farmerRegion: user.city,
  farmerPhone: user.phone,
  imagePath: `visionDiagnoses/${user.uid}/${diagnosisId}.jpg`,
  imageUrl: 'https://example.test/leaf.jpg',
  status: 'awaiting_expert',
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
  ...overrides,
});

const reviewFields = () => ({
  visibleParts: ['leaf'],
  observations: [{ bodyPart: 'leaf', problemType: 'powdery_mildew', manualLabel: '', severity: 'mild', confidence: 'medium', spread: 'few_spots' }],
  bodyPart: 'leaf',
  primaryBodyPart: 'leaf',
  imageQuality: 'good',
  problems: [{ bodyPart: 'leaf', problemType: 'powdery_mildew', manualLabel: '', severity: 'mild', confidence: 'medium', spread: 'few_spots' }],
  manualLabel: '',
  overallSeverity: 'mild',
  recommendedAction: 'رش الكبريت في الصباح الباكر.',
  expertNote: 'رش الكبريت في الصباح الباكر.',
});

const draftUpdate = (user) => ({
  ...reviewFields(),
  status: 'in_review',
  reviewedBy: user.uid,
  reviewedByName: user.name,
  updatedAt: serverTimestamp(),
});

const submitUpdate = (user) => ({
  ...reviewFields(),
  status: 'reviewed',
  reviewedBy: user.uid,
  reviewedByName: user.name,
  reviewedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const seedDiagnosis = (id, overrides = {}) =>
  seed(env, `visionDiagnoses/${id}`, {
    ...diagnosisSubmission(USERS.farmer, id),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  });

const minutesAgo = (minutes) => Timestamp.fromMillis(Date.now() - minutes * 60 * 1000);

// --- tests ------------------------------------------------------------------

describe('users', () => {
  it('keeps profiles away from visitors and other members', async () => {
    await assertFails(getDoc(doc(anonDb(), 'users', USERS.farmer.uid)));
    await assertFails(getDocs(collection(anonDb(), 'users')));
    await assertFails(getDoc(doc(db(USERS.otherFarmer), 'users', USERS.farmer.uid)));
    await assertFails(getDocs(collection(db(USERS.expert), 'users')));
  });

  it('lets a member read their own profile and an admin list everyone', async () => {
    await assertSucceeds(getDoc(doc(db(USERS.farmer), 'users', USERS.farmer.uid)));
    await assertSucceeds(getDocs(collection(db(USERS.admin), 'users')));
    await assertSucceeds(
      getDocs(query(collection(db(USERS.admin), 'users'), where('role', '==', 'expert'), where('status', 'in', ['pending', 'rejected']))),
    );
  });

  it('keeps registration closed until an admin opens it', async () => {
    const farmer = { uid: 'newFarmer', role: 'farmer', phone: '+212611111111', name: 'جديد', city: 'آزرو' };
    await assertFails(setDoc(doc(db(farmer), 'users', farmer.uid), newProfile(farmer)));
    await assertSucceeds(getDoc(doc(anonDb(), 'settings', 'registration')));
    await assertFails(setDoc(doc(db(USERS.farmer), 'settings', 'registration'), registrationSwitch(USERS.farmer, true)));
    await assertFails(setDoc(doc(db(USERS.admin), 'settings', 'other'), registrationSwitch(USERS.admin, true)));
    await assertFails(setDoc(doc(db(USERS.admin), 'settings', 'registration'), { ...registrationSwitch(USERS.admin, true), note: 'x' }));
    await assertSucceeds(setDoc(doc(db(USERS.admin), 'settings', 'registration'), registrationSwitch(USERS.admin, true)));
    await assertSucceeds(setDoc(doc(db(farmer), 'users', farmer.uid), newProfile(farmer)));
    await assertSucceeds(setDoc(doc(db(USERS.admin), 'settings', 'registration'), registrationSwitch(USERS.admin, false)));
    const late = { uid: 'lateFarmer', role: 'farmer', phone: '+212622222223', name: 'متأخر', city: 'صفرو' };
    await assertFails(setDoc(doc(db(late), 'users', late.uid), newProfile(late)));
  });

  it('accepts the registration profile for farmers and pending experts', async () => {
    await openRegistration();
    const farmer = { uid: 'newFarmer', role: 'farmer', phone: '+212611111111', name: 'جديد', city: 'آزرو' };
    const expert = { uid: 'newExpert', role: 'expert', phone: '+212622222222', name: 'خبير جديد' };
    await assertSucceeds(setDoc(doc(db(farmer), 'users', farmer.uid), newProfile(farmer)));
    await assertSucceeds(setDoc(doc(db(expert), 'users', expert.uid), newProfile(expert)));
  });

  it('accepts foreign numbers, which several live accounts have', async () => {
    await openRegistration();
    const expert = { uid: 'saudiExpert', role: 'expert', phone: '+966500000009', name: 'خبير', city: null };
    await assertSucceeds(setDoc(doc(db(expert), 'users', expert.uid), newProfile(expert)));
  });

  it('refuses self-made admins, self-approved experts and borrowed phone numbers', async () => {
    await openRegistration();
    const user = { uid: 'intruder', role: 'farmer', phone: '+212633333333', name: 'x', city: 'صفرو' };
    const ctx = db(user);
    await assertFails(setDoc(doc(ctx, 'users', user.uid), newProfile(user, { role: 'admin' })));
    await assertFails(setDoc(doc(ctx, 'users', user.uid), newProfile({ ...user, role: 'expert' }, { status: 'approved' })));
    await assertFails(setDoc(doc(ctx, 'users', user.uid), newProfile(user, { phone: USERS.farmer.phone })));
    await assertFails(setDoc(doc(ctx, 'users', 'someoneElse'), newProfile(user, { uid: 'someoneElse' })));
  });

  it('lets only an admin change an expert status', async () => {
    await assertFails(updateDoc(doc(db(USERS.pendingExpert), 'users', USERS.pendingExpert.uid), { status: 'approved' }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'users', USERS.farmer.uid), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(db(USERS.admin), 'users', USERS.pendingExpert.uid), { status: 'approved' }));
    await assertFails(updateDoc(doc(db(USERS.admin), 'users', USERS.farmer.uid), { status: 'rejected' }));
  });

  it('lets a farmer edit only their name and region', async () => {
    await assertSucceeds(updateDoc(doc(db(USERS.farmer), 'users', USERS.farmer.uid), { name: 'اسم جديد', city: 'تاونات' }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'users', USERS.farmer.uid), { phone: '+212699999999' }));
  });
});

describe('price posts and farmers room', () => {
  it('shares the price board with members only', async () => {
    await assertFails(getDocs(collection(anonDb(), 'pricePosts')));
    await assertFails(getDocs(collection(db(USERS.pendingExpert), 'pricePosts')));
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'pricePosts'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(collection(db(USERS.expert), 'pricePosts')));
  });

  it('accepts a farmer post with the price as typed and rejects bad values', async () => {
    const ctx = db(USERS.farmer);
    await assertSucceeds(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer)));
    await assertSucceeds(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { price: 42.5 })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { price: '-3' })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { quality: 'B' })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.otherFarmer)));
    await assertFails(addDoc(collection(db(USERS.expert), 'pricePosts'), pricePost(USERS.expert)));
  });

  it('accepts the newer market and observation-date fields, checked when present', async () => {
    const ctx = db(USERS.farmer);
    const today = new Date().toISOString().slice(0, 10);
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await assertSucceeds(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M02', date: today })));
    await assertSucceeds(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M01', date: lastMonth })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M09', date: today })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M01', date: nextWeek })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M01', date: '2026-13-01' })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M01', date: '03/10/2026' })));
    await assertFails(addDoc(collection(ctx, 'pricePosts'), pricePost(USERS.farmer, { market: 'M01', date: '2024-01-01' })));
  });

  it('lets farmers delete only their own posts', async () => {
    await seed(env, 'pricePosts/p1', { ...pricePost(USERS.farmer), createdAt: Timestamp.now() });
    await assertFails(deleteDoc(doc(db(USERS.otherFarmer), 'pricePosts', 'p1')));
    await assertSucceeds(deleteDoc(doc(db(USERS.farmer), 'pricePosts', 'p1')));
  });

  it('accepts chat messages only under the sender’s own id', async () => {
    const message = { senderId: USERS.farmer.uid, senderName: USERS.farmer.name, type: 'text', content: 'السلام عليكم', createdAt: serverTimestamp() };
    await assertSucceeds(addDoc(collection(db(USERS.farmer), 'farmerChat'), message));
    await assertFails(addDoc(collection(db(USERS.otherFarmer), 'farmerChat'), message));
    await assertFails(getDocs(collection(anonDb(), 'farmerChat')));
  });
});

describe('earlier messages to experts (farmerMessages)', () => {
  beforeEach(async () => {
    await seed(env, 'farmerMessages/m1', {
      farmerId: USERS.farmer.uid,
      farmerName: USERS.farmer.name,
      farmerPhone: USERS.farmer.phone,
      farmerRegion: USERS.farmer.city,
      type: 'image',
      fileUrl: 'https://example.test/m1.jpg',
      filePath: `farmerMessages/${USERS.farmer.uid}/1-m1.jpg`,
      readBy: {},
      replyCount: 0,
      lastReplyPreview: '',
      lastActivityAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
  });

  it('shows a farmer only their own messages and experts all of them', async () => {
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'farmerMessages'), where('farmerId', '==', USERS.farmer.uid))));
    await assertFails(getDocs(collection(db(USERS.farmer), 'farmerMessages')));
    await assertFails(getDocs(query(collection(db(USERS.otherFarmer), 'farmerMessages'), where('farmerId', '==', USERS.farmer.uid))));
    await assertSucceeds(getDocs(query(collection(db(USERS.expert), 'farmerMessages'), orderBy('createdAt', 'desc'))));
    await assertFails(getDocs(collection(db(USERS.pendingExpert), 'farmerMessages')));
  });

  it('lets an expert mark read and add an internal reply, nothing more', async () => {
    const ctx = db(USERS.expert);
    await assertSucceeds(updateDoc(doc(ctx, 'farmerMessages', 'm1'), { [`readBy.${USERS.expert.uid}`]: serverTimestamp() }));
    await assertSucceeds(
      addDoc(collection(ctx, 'farmerMessages', 'm1', 'replies'), {
        expertId: USERS.expert.uid,
        expertName: USERS.expert.name,
        body: 'تبدو إصابة خفيفة.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(ctx, 'farmerMessages', 'm1'), {
        lastActivityAt: serverTimestamp(),
        lastReplyPreview: 'تبدو إصابة خفيفة.',
        replyCount: increment(1),
        [`readBy.${USERS.expert.uid}`]: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(ctx, 'farmerMessages', 'm1'), { [`readBy.${USERS.otherExpert.uid}`]: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx, 'farmerMessages', 'm1'), { farmerId: USERS.expert.uid }));
    await assertFails(getDocs(collection(db(USERS.farmer), 'farmerMessages', 'm1', 'replies')));
  });
});

describe('expert regional notes', () => {
  const noteId = (expert) => `_d8_a5_d9_81_d8_b1_d8_a7_d9_86__${expert.uid}`;
  const note = (expert, createdAt = serverTimestamp()) => ({
    scope: 'expert_region_current',
    currentKey: `_d8_a5_d9_81_d8_b1_d8_a7_d9_86:${expert.uid}`,
    region: 'إفران',
    subject: 'موعد الري',
    body: 'قلل الري هذا الأسبوع.',
    expertId: expert.uid,
    expertName: expert.name,
    active: true,
    updatedAt: serverTimestamp(),
    createdAt,
  });

  it('lets an approved expert keep one current note per region', async () => {
    const ctx = db(USERS.expert);
    await assertSucceeds(setDoc(doc(ctx, 'farmerNotes', noteId(USERS.expert)), note(USERS.expert), { merge: true }));
    const stored = await getDoc(doc(ctx, 'farmerNotes', noteId(USERS.expert)));
    await assertSucceeds(
      setDoc(doc(ctx, 'farmerNotes', noteId(USERS.expert)), note(USERS.expert, stored.data().createdAt), { merge: true }),
    );
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'farmerNotes'), where('region', '==', 'إفران'))));
  });

  it('refuses notes written for another expert or by a pending expert', async () => {
    await assertFails(setDoc(doc(db(USERS.otherExpert), 'farmerNotes', noteId(USERS.expert)), note(USERS.expert)));
    await assertFails(setDoc(doc(db(USERS.pendingExpert), 'farmerNotes', noteId(USERS.pendingExpert)), note(USERS.pendingExpert)));
    await assertFails(setDoc(doc(db(USERS.farmer), 'farmerNotes', noteId(USERS.farmer)), note(USERS.farmer)));
  });
});

describe('plant photo diagnosis', () => {
  it('accepts a farmer submission in its initial state only', async () => {
    const ctx = db(USERS.farmer);
    await assertSucceeds(setDoc(doc(ctx, 'visionDiagnoses', 'd1'), diagnosisSubmission(USERS.farmer, 'd1')));
    await assertFails(setDoc(doc(ctx, 'visionDiagnoses', 'd2'), diagnosisSubmission(USERS.farmer, 'd2', { status: 'reviewed' })));
    await assertFails(setDoc(doc(ctx, 'visionDiagnoses', 'd3'), diagnosisSubmission(USERS.farmer, 'd3', { reviewedBy: USERS.farmer.uid })));
    await assertFails(setDoc(doc(ctx, 'visionDiagnoses', 'd4'), diagnosisSubmission(USERS.farmer, 'other-id')));
    await assertFails(setDoc(doc(db(USERS.otherFarmer), 'visionDiagnoses', 'd5'), diagnosisSubmission(USERS.farmer, 'd5')));
  });

  it('shows farmers their own diagnoses and staff all of them', async () => {
    await seedDiagnosis('d1');
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'visionDiagnoses'), where('farmerId', '==', USERS.farmer.uid))));
    await assertFails(getDocs(collection(db(USERS.farmer), 'visionDiagnoses')));
    await assertFails(getDoc(doc(db(USERS.otherFarmer), 'visionDiagnoses', 'd1')));
    await assertSucceeds(getDocs(query(collection(db(USERS.expert), 'visionDiagnoses'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(collection(db(USERS.admin), 'visionDiagnoses')));
  });

  it('lets one expert claim a photo and keeps others out while the claim is fresh', async () => {
    await seedDiagnosis('d1');
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.expert), claimedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.otherExpert), claimedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd1'), submitUpdate(USERS.otherExpert)));
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'visionDiagnoses', 'd1'), submitUpdate(USERS.expert)));
  });

  it('accepts the current client’s draft save without claimedAt', async () => {
    await seedDiagnosis('d1');
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'visionDiagnoses', 'd1'), draftUpdate(USERS.expert)));
    await assertFails(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd1'), draftUpdate(USERS.otherExpert)));
  });

  it('lets another expert take over a claim older than 30 minutes', async () => {
    await seedDiagnosis('d1', { status: 'in_review', reviewedBy: USERS.expert.uid, reviewedByName: USERS.expert.name, claimedAt: minutesAgo(45), updatedAt: minutesAgo(45) });
    await assertSucceeds(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.otherExpert), claimedAt: serverTimestamp() }));
  });

  it('lets the holder release a claim, and only the original reviewer amend a result', async () => {
    await seedDiagnosis('d1', { status: 'in_review', reviewedBy: USERS.expert.uid, reviewedByName: USERS.expert.name, claimedAt: minutesAgo(1) });
    await assertFails(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd1'), { status: 'awaiting_expert', reviewedBy: null, reviewedByName: null }));
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'visionDiagnoses', 'd1'), { status: 'awaiting_expert', reviewedBy: null, reviewedByName: null }));

    await seedDiagnosis('d2', { ...submitUpdate(USERS.expert), reviewedAt: minutesAgo(60), updatedAt: minutesAgo(60) });
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'visionDiagnoses', 'd2'), submitUpdate(USERS.expert)));
    await assertFails(updateDoc(doc(db(USERS.otherExpert), 'visionDiagnoses', 'd2'), submitUpdate(USERS.otherExpert)));
  });

  it('protects the photo, the farmer and function-owned fields', async () => {
    await seedDiagnosis('d1');
    const ctx = db(USERS.expert);
    await assertFails(updateDoc(doc(ctx, 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.expert), imageUrl: 'https://example.test/other.jpg' }));
    await assertFails(updateDoc(doc(ctx, 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.expert), weatherContext: { fake: true } }));
    await assertFails(updateDoc(doc(ctx, 'visionDiagnoses', 'd1'), { ...draftUpdate(USERS.expert), reviewedBy: USERS.otherExpert.uid }));
    await assertFails(updateDoc(doc(db(USERS.pendingExpert), 'visionDiagnoses', 'd1'), draftUpdate(USERS.pendingExpert)));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'visionDiagnoses', 'd1'), submitUpdate(USERS.farmer)));
    await assertFails(deleteDoc(doc(db(USERS.admin), 'visionDiagnoses', 'd1')));
  });
});

describe('questions to experts', () => {
  const textRequest = (user, overrides = {}) => ({
    farmerId: user.uid,
    farmerName: user.name,
    farmerPhone: user.phone,
    farmerRegion: user.city,
    type: 'text',
    body: 'الأوراق تصفر من الأطراف، ما السبب؟',
    fileUrl: null,
    filePath: null,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it('accepts open questions from farmers and checks attached media paths', async () => {
    const ctx = db(USERS.farmer);
    await assertSucceeds(addDoc(collection(ctx, 'expertRequests'), textRequest(USERS.farmer)));
    await assertSucceeds(
      addDoc(collection(ctx, 'expertRequests'), textRequest(USERS.farmer, {
        type: 'image',
        body: '',
        fileUrl: 'https://example.test/q.jpg',
        filePath: `expertRequests/${USERS.farmer.uid}/1-q.jpg`,
      })),
    );
    await assertFails(addDoc(collection(ctx, 'expertRequests'), textRequest(USERS.farmer, { body: '' })));
    await assertFails(addDoc(collection(ctx, 'expertRequests'), textRequest(USERS.farmer, { status: 'assigned' })));
    await assertFails(
      addDoc(collection(ctx, 'expertRequests'), textRequest(USERS.farmer, {
        type: 'image',
        fileUrl: 'https://example.test/q.jpg',
        filePath: `expertRequests/${USERS.otherFarmer.uid}/1-q.jpg`,
      })),
    );
    await assertFails(addDoc(collection(db(USERS.expert), 'expertRequests'), textRequest(USERS.expert)));
  });

  it('shows open questions to experts and each farmer only their own', async () => {
    await seed(env, 'expertRequests/r1', { ...textRequest(USERS.farmer), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await assertSucceeds(getDocs(query(collection(db(USERS.expert), 'expertRequests'), where('status', '==', 'open'))));
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'expertRequests'), where('farmerId', '==', USERS.farmer.uid))));
    await assertFails(getDocs(collection(db(USERS.farmer), 'expertRequests')));
    await assertFails(getDoc(doc(db(USERS.otherFarmer), 'expertRequests', 'r1')));
    await assertFails(getDocs(collection(db(USERS.pendingExpert), 'expertRequests')));
  });

  it('lets a farmer cancel an open question; assignment happens only in the callable', async () => {
    await seed(env, 'expertRequests/r1', { ...textRequest(USERS.farmer), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await assertFails(updateDoc(doc(db(USERS.expert), 'expertRequests', 'r1'), { status: 'assigned', assignedExpertId: USERS.expert.uid }));
    await assertFails(updateDoc(doc(db(USERS.otherFarmer), 'expertRequests', 'r1'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db(USERS.farmer), 'expertRequests', 'r1'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'expertRequests', 'r1'), { status: 'open', updatedAt: serverTimestamp() }));
  });
});

describe('farmer–expert conversations', () => {
  const conversationId = `${USERS.farmer.uid}__${USERS.expert.uid}`;

  beforeEach(async () => {
    await seed(env, `expertConversations/${conversationId}`, {
      farmerId: USERS.farmer.uid,
      farmerName: USERS.farmer.name,
      farmerPhone: USERS.farmer.phone,
      farmerRegion: USERS.farmer.city,
      expertId: USERS.expert.uid,
      expertName: USERS.expert.name,
      participantIds: [USERS.farmer.uid, USERS.expert.uid],
      status: 'active',
      lastRequestId: 'r1',
      lastMessagePreview: 'جرّب تقليل الري.',
      lastMessageSenderId: USERS.expert.uid,
      lastMessageSenderRole: 'expert',
      unreadForFarmer: true,
      unreadForExpert: false,
      farmerReadAt: null,
      expertReadAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });

  const message = (user, role, overrides = {}) => ({
    conversationId,
    senderId: user.uid,
    senderName: user.name,
    senderRole: role,
    type: 'text',
    body: 'شكراً، سأجرب ذلك.',
    fileUrl: null,
    filePath: null,
    createdAt: serverTimestamp(),
    ...overrides,
  });

  it('shows a conversation only to its farmer, its expert and admins', async () => {
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'expertConversations'), where('farmerId', '==', USERS.farmer.uid))));
    await assertSucceeds(getDocs(query(collection(db(USERS.expert), 'expertConversations'), where('expertId', '==', USERS.expert.uid))));
    await assertSucceeds(getDocs(query(collection(db(USERS.farmer), 'expertConversations', conversationId, 'messages'), orderBy('createdAt', 'asc'))));
    await assertFails(getDoc(doc(db(USERS.otherFarmer), 'expertConversations', conversationId)));
    await assertFails(getDocs(collection(db(USERS.otherExpert), 'expertConversations', conversationId, 'messages')));
    await assertFails(getDocs(collection(db(USERS.farmer), 'expertConversations')));
    await assertSucceeds(getDocs(collection(db(USERS.admin), 'expertConversations')));
  });

  it('accepts a message plus its conversation update as one batch', async () => {
    const ctx = db(USERS.farmer);
    const batch = writeBatch(ctx);
    batch.set(doc(collection(ctx, 'expertConversations', conversationId, 'messages')), message(USERS.farmer, 'farmer'));
    batch.update(doc(ctx, 'expertConversations', conversationId), {
      lastMessagePreview: 'شكراً، سأجرب ذلك.',
      lastMessageSenderId: USERS.farmer.uid,
      lastMessageSenderRole: 'farmer',
      unreadForExpert: true,
      unreadForFarmer: false,
      farmerReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('refuses spoofed senders, outsiders and conversations created from the client', async () => {
    const msgs = (user) => collection(db(user), 'expertConversations', conversationId, 'messages');
    await assertFails(addDoc(msgs(USERS.farmer), message(USERS.farmer, 'expert')));
    await assertFails(addDoc(msgs(USERS.farmer), message(USERS.expert, 'expert')));
    await assertFails(addDoc(msgs(USERS.otherFarmer), message(USERS.otherFarmer, 'farmer')));
    await assertFails(
      addDoc(msgs(USERS.farmer), message(USERS.farmer, 'farmer', {
        type: 'image',
        body: '',
        fileUrl: 'https://example.test/x.jpg',
        filePath: `expertConversations/${conversationId}/${USERS.expert.uid}/x.jpg`,
      })),
    );
    await assertSucceeds(
      addDoc(msgs(USERS.expert), message(USERS.expert, 'expert', {
        type: 'image',
        body: '',
        fileUrl: 'https://example.test/x.jpg',
        filePath: `expertConversations/${conversationId}/${USERS.expert.uid}/x.jpg`,
      })),
    );
    await assertFails(setDoc(doc(db(USERS.farmer), 'expertConversations', 'farmerA__expertB'), { farmerId: USERS.farmer.uid, expertId: USERS.otherExpert.uid }));
  });

  it('lets each side mark only its own side read', async () => {
    await assertSucceeds(updateDoc(doc(db(USERS.farmer), 'expertConversations', conversationId), { unreadForFarmer: false, farmerReadAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'expertConversations', conversationId), { unreadForExpert: false, expertReadAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'expertConversations', conversationId), { expertId: USERS.farmer.uid }));
    await assertSucceeds(updateDoc(doc(db(USERS.expert), 'expertConversations', conversationId), { unreadForExpert: false, expertReadAt: serverTimestamp() }));
  });
});

describe('function-written data', () => {
  it('lets members read regional and market outputs, never write them', async () => {
    await seed(env, 'aiNotes/ifrane', { content: 'ملاحظة', generatedAt: Date.now() });
    await assertSucceeds(getDoc(doc(db(USERS.farmer), 'aiNotes', 'ifrane')));
    await assertFails(getDoc(doc(anonDb(), 'aiNotes', 'ifrane')));
    await assertFails(setDoc(doc(db(USERS.admin), 'aiNotes', 'ifrane'), { content: 'x' }));
  });

  it('keeps climate, weather cache, system and lock documents closed', async () => {
    for (const path of ['climateSnapshots/latest', 'climateSummaries/ifrane', 'dailyWeatherCache/ifrane_2026-10-01', 'system/status', 'aiNoteLocks/ifrane']) {
      await assertFails(getDoc(doc(db(USERS.admin), path)));
      await assertFails(setDoc(doc(db(USERS.admin), path), { x: 1 }));
    }
  });

  it('closes the retired monthly-average forecast collections', async () => {
    await seed(env, 'priceForecasts/ifrane__AA', { regionId: 'ifrane' });
    await seed(env, 'seasonalPriceOutlook/ifrane', { regionId: 'ifrane' });
    await assertFails(getDoc(doc(db(USERS.farmer), 'priceForecasts', 'ifrane__AA')));
    await assertFails(getDoc(doc(db(USERS.admin), 'seasonalPriceOutlook', 'ifrane')));
  });

  it('publishes forecast ranges to everyone and takes imports from admins only', async () => {
    const sheet = (user) => ({
      rows: [{ date: '2026-11-02', market: 'M01', low: 27.1, expected: 28.4, high: 29.9, horizonType: 'short_term', horizon: '1w' }],
      updatedAt: serverTimestamp(),
      uploadedBy: user.uid,
      rowCount: 1,
      // Provenance copied from the workbook's About sheet.
      provenance: 'synthetic',
      dataCutoff: '2026-05-24',
      generatedAt: '2026-10-07T11:27:29Z',
      modelVersion: 'lgbm-quantile-1w8w-1.0.0',
      sourceName: 'Synthetic market simulation',
      seed: '20260524',
    });
    await assertSucceeds(getDoc(doc(anonDb(), 'forecastSheets', 'A')));
    await assertSucceeds(setDoc(doc(db(USERS.admin), 'forecastSheets', 'A'), sheet(USERS.admin)));
    await assertFails(setDoc(doc(db(USERS.admin), 'forecastSheets', 'B'), sheet(USERS.admin)));
    await assertFails(setDoc(doc(db(USERS.admin), 'forecastSheets', 'AA'), { ...sheet(USERS.admin), rowCount: 5 }));
    await assertFails(setDoc(doc(db(USERS.farmer), 'forecastSheets', 'A'), sheet(USERS.farmer)));
    const crowded = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`extra${i}`, 'x']));
    await assertFails(setDoc(doc(db(USERS.admin), 'forecastSheets', 'AAA'), { ...sheet(USERS.admin), ...crowded }));
  });
});

describe('hydroponics device module', () => {
  const ownDevice = `device_${USERS.farmer.uid}`;

  it('lets a member create and control only their own device', async () => {
    const ctx = db(USERS.farmer);
    await assertSucceeds(getDoc(doc(ctx, 'hydroDevices', ownDevice)));
    await assertSucceeds(setDoc(doc(ctx, 'hydroDevices', ownDevice), { ownerId: USERS.farmer.uid, deviceName: 'جهاز ESP32', createdAt: Date.now(), connected: false }));
    await assertSucceeds(updateDoc(doc(ctx, 'hydroDevices', ownDevice), { pumpCommand: true, pumpCommandAt: Date.now() }));
    await assertFails(updateDoc(doc(ctx, 'hydroDevices', ownDevice), { connected: true }));
    await assertFails(getDoc(doc(ctx, 'hydroDevices', `device_${USERS.otherFarmer.uid}`)));
    await assertFails(setDoc(doc(ctx, 'hydroDevices', `device_${USERS.otherFarmer.uid}`), { ownerId: USERS.farmer.uid, deviceName: 'x', createdAt: Date.now(), connected: false }));
  });

  it('shows readings and alerts to the device owner and lets them resolve alerts', async () => {
    await seed(env, `hydroReadings/${ownDevice}`, { tds: 640, temperature: 21.5, pumpOn: false, timestamp: Date.now() });
    await seed(env, 'hydroAlerts/a1', { deviceId: ownDevice, ownerId: USERS.farmer.uid, type: 'نقص البوتاسيوم', status: 'open', createdAt: Date.now() });
    await assertSucceeds(getDoc(doc(db(USERS.farmer), 'hydroReadings', ownDevice)));
    await assertFails(getDoc(doc(db(USERS.otherFarmer), 'hydroReadings', ownDevice)));
    await assertSucceeds(
      getDocs(query(collection(db(USERS.farmer), 'hydroAlerts'), where('deviceId', '==', ownDevice), orderBy('createdAt', 'desc'))),
    );
    await assertFails(getDocs(query(collection(db(USERS.otherFarmer), 'hydroAlerts'), where('deviceId', '==', ownDevice))));
    await assertSucceeds(updateDoc(doc(db(USERS.farmer), 'hydroAlerts', 'a1'), { status: 'resolved' }));
    await assertFails(updateDoc(doc(db(USERS.farmer), 'hydroAlerts', 'a1'), { message: 'x' }));
  });
});

describe('image model data', () => {
  it('is admin-only, except the published model entry members can read', async () => {
    await seed(env, 'modelRegistry/current', { modelVersion: 'cherry-multiclass-v1' });
    const admin = db(USERS.admin);
    await assertSucceeds(addDoc(collection(admin, 'modelTrainingJobs'), { targetPart: 'leaf', status: 'manifest_ready', createdAt: Date.now() }));
    await assertSucceeds(setDoc(doc(admin, 'modelTrainingJobs', 'j1', 'manifestItems', '000000'), { imageUrl: 'x' }));
    await assertSucceeds(getDocs(collection(admin, 'datasetImages')));
    await assertSucceeds(getDoc(doc(db(USERS.farmer), 'modelRegistry', 'current')));
    await assertFails(getDocs(collection(db(USERS.expert), 'modelCandidates')));
    await assertFails(setDoc(doc(db(USERS.expert), 'modelRegistry', 'current'), { modelVersion: 'x' }));
  });

  it('denies collections the rules do not name', async () => {
    await assertFails(getDocs(collection(db(USERS.admin), 'somethingElse')));
    await assertFails(setDoc(doc(db(USERS.admin), 'somethingElse/x'), { a: 1 }));
  });
});

// Profiles in env.mjs use the same phone → email mapping as authService.
describe('test fixtures', () => {
  it('map phones to Auth emails the way registration does', () => {
    if (emailFor(USERS.farmer) !== '212600000001@sweetcherry.ma') throw new Error('unexpected email alias');
  });
});
