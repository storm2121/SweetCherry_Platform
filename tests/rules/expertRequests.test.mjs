// The recovered claimExpertRequestAndReply logic, run with the Admin SDK
// against the Firestore emulator, followed by the client steps the rules allow.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import {
  ExpertRequestError,
  claimExpertRequest,
  expertConversationId,
  loadApprovedExpert,
  messagePreview,
  normalizeExpertReplyPayload,
} from '../../functions/lib/expertRequests.mjs';
import { PROJECT_ID, USERS, as, createEnv, seedUsers } from './env.mjs';

let env;
let adminApp;
let adminDb;

before(async () => {
  env = await createEnv();
  adminApp = initializeApp({ projectId: PROJECT_ID }, 'expert-requests-test');
  adminDb = getFirestore(adminApp);
});

after(async () => {
  await deleteApp(adminApp);
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
});

const askQuestion = async (farmer = USERS.farmer) => {
  const ref = await addDoc(collection(as(env, farmer).firestore(), 'expertRequests'), {
    farmerId: farmer.uid,
    farmerName: farmer.name,
    farmerPhone: farmer.phone,
    farmerRegion: farmer.city,
    type: 'text',
    body: 'ظهرت بقع بنية على الأوراق بعد المطر.',
    fileUrl: null,
    filePath: null,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

const claim = (expert, requestId, reply = { type: 'text', body: 'أرسل صورة قريبة للورقة من الجهتين.' }) =>
  claimExpertRequest({ db: adminDb, FieldValue, expert: { ...expert }, requestId, reply });

describe('reply payloads', () => {
  it('require text or an uploaded file', () => {
    assert.deepEqual(normalizeExpertReplyPayload({ body: '  نص  ' }), { type: 'text', body: 'نص', fileUrl: null, filePath: null });
    assert.throws(() => normalizeExpertReplyPayload({ type: 'text', body: ' ' }), ExpertRequestError);
    assert.throws(() => normalizeExpertReplyPayload({ type: 'image' }), ExpertRequestError);
    assert.throws(() => normalizeExpertReplyPayload({ body: 'x'.repeat(2001) }), ExpertRequestError);
  });

  it('give thread ids and previews the client can rebuild', () => {
    assert.equal(expertConversationId('farmer/1', 'expert.2'), 'farmer_1__expert_2');
    assert.equal(messagePreview({ type: 'audio' }, 'farmer'), 'رسالة صوتية من المزارع');
    assert.equal(messagePreview({ type: 'text', body: 'ب'.repeat(200) }).length, 160);
  });
});

describe('claiming a question', () => {
  it('accepts approved experts only', async () => {
    await assert.rejects(loadApprovedExpert({ db: adminDb, auth: null }), { code: 'unauthenticated' });
    await assert.rejects(loadApprovedExpert({ db: adminDb, auth: { uid: USERS.pendingExpert.uid } }), { code: 'permission-denied' });
    await assert.rejects(loadApprovedExpert({ db: adminDb, auth: { uid: USERS.farmer.uid } }), { code: 'permission-denied' });
    const expert = await loadApprovedExpert({ db: adminDb, auth: { uid: USERS.expert.uid } });
    assert.equal(expert.uid, USERS.expert.uid);
  });

  it('assigns the request, opens the thread and lets the farmer read the answer', async () => {
    const requestId = await askQuestion();
    const result = await claim(USERS.expert, requestId);
    assert.equal(result.ok, true);
    assert.equal(result.conversationId, `${USERS.farmer.uid}__${USERS.expert.uid}`);

    const request = (await adminDb.doc(`expertRequests/${requestId}`).get()).data();
    assert.equal(request.status, 'assigned');
    assert.equal(request.assignedExpertId, USERS.expert.uid);

    const farmerDb = as(env, USERS.farmer).firestore();
    const threads = await assertSucceeds(
      getDocs(query(collection(farmerDb, 'expertConversations'), where('farmerId', '==', USERS.farmer.uid))),
    );
    assert.equal(threads.size, 1);
    assert.equal(threads.docs[0].data().unreadForFarmer, true);

    const messages = await assertSucceeds(
      getDocs(query(collection(farmerDb, 'expertConversations', result.conversationId, 'messages'), orderBy('createdAt', 'asc'))),
    );
    assert.deepEqual(messages.docs.map((m) => m.data().senderRole), ['farmer', 'expert']);
    assert.equal(messages.docs[0].data().requestMarker, true);

    await assertFails(getDocs(collection(as(env, USERS.otherFarmer).firestore(), 'expertConversations', result.conversationId, 'messages')));
  });

  it('lets only the first expert answer', async () => {
    const requestId = await askQuestion();
    const [first, second] = await Promise.all([claim(USERS.expert, requestId), claim(USERS.otherExpert, requestId)]);
    const winners = [first, second].filter((r) => r.ok);
    assert.equal(winners.length, 1);
    const loser = [first, second].find((r) => !r.ok);
    assert.equal(loser.status, 'already_assigned');
    assert.equal(loser.assignedExpertId, winners[0].assignedExpertId);
  });

  it('reports cancelled questions as cancelled', async () => {
    const requestId = await askQuestion();
    await adminDb.doc(`expertRequests/${requestId}`).update({ status: 'cancelled' });
    const result = await claim(USERS.expert, requestId);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'cancelled');
  });

  it('reuses the thread for a second question and keeps when it started', async () => {
    const first = await claim(USERS.expert, await askQuestion());
    const createdAt = (await adminDb.doc(`expertConversations/${first.conversationId}`).get()).data().createdAt;
    const second = await claim(USERS.expert, await askQuestion());
    assert.equal(second.conversationId, first.conversationId);
    const thread = (await adminDb.doc(`expertConversations/${first.conversationId}`).get()).data();
    assert.ok(thread.createdAt.isEqual(createdAt));
    const count = (await adminDb.collection(`expertConversations/${first.conversationId}/messages`).get()).size;
    assert.equal(count, 4);
  });

  it('refuses media the expert did not upload', async () => {
    const requestId = await askQuestion();
    await assert.rejects(
      claim(USERS.expert, requestId, {
        type: 'image',
        fileUrl: 'https://example.test/x.jpg',
        filePath: `expertPendingReplies/${USERS.otherExpert.uid}/x.jpg`,
      }),
      { code: 'invalid-argument' },
    );
    const result = await claim(USERS.expert, requestId, {
      type: 'image',
      fileUrl: 'https://example.test/x.jpg',
      filePath: `expertPendingReplies/${USERS.expert.uid}/x.jpg`,
    });
    assert.equal(result.ok, true);
  });

  it('fails cleanly for unknown requests', async () => {
    await assert.rejects(claim(USERS.expert, 'missing'), { code: 'not-found' });
    await assert.rejects(claim(USERS.expert, ''), { code: 'invalid-argument' });
  });
});
