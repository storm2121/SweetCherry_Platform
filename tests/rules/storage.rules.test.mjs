// Storage rules. Paths and content types match what src/services/* upload.
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { USERS, as, createEnv, seed, seedUsers } from './env.mjs';

let env;
const storage = (user) => as(env, user).storage();
const bytes = (size = 1024) => new Uint8Array(size);
const jpeg = { contentType: 'image/jpeg' };
const webm = { contentType: 'audio/webm' };

const upload = (user, path, data = bytes(), metadata = jpeg) => uploadBytes(ref(storage(user), path), data, metadata);

const seedFile = (path, metadata = jpeg) =>
  env.withSecurityRulesDisabled((context) => uploadBytes(ref(context.storage(), path), bytes(), metadata));

before(async () => {
  env = await createEnv();
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedUsers(env);
});

describe('expert credential', () => {
  it('can be uploaded by a new account while registration is open, and read by admins', async () => {
    const newExpert = { uid: 'brandNew', phone: '+212644444444' };
    await assertFails(upload(newExpert, 'expertProofs/brandNew/diploma.pdf', bytes(), { contentType: 'application/pdf' }));
    await seed(env, 'settings/registration', { open: true, updatedAt: new Date(), updatedBy: USERS.admin.uid });
    await assertSucceeds(upload(newExpert, 'expertProofs/brandNew/diploma.pdf', bytes(), { contentType: 'application/pdf' }));
    await assertFails(upload(newExpert, 'expertProofs/brandNew/run.exe', bytes(), { contentType: 'application/x-msdownload' }));
    await assertFails(upload(USERS.farmer, 'expertProofs/brandNew/diploma.pdf', bytes(), { contentType: 'application/pdf' }));
    await seedFile('expertProofs/brandNew/diploma.pdf', { contentType: 'application/pdf' });
    await assertSucceeds(getBytes(ref(storage(USERS.admin), 'expertProofs/brandNew/diploma.pdf')));
    await assertFails(getBytes(ref(storage(USERS.expert), 'expertProofs/brandNew/diploma.pdf')));
  });
});

describe('diagnosis photos', () => {
  const path = `visionDiagnoses/${USERS.farmer.uid}/d1.jpg`;

  it('accepts the resized JPEG from its farmer only', async () => {
    await assertSucceeds(upload(USERS.farmer, path));
    await assertFails(upload(USERS.farmer, path.replace('.jpg', '.png'), bytes(), { contentType: 'image/png' }));
    await assertFails(upload(USERS.otherFarmer, path));
    await assertFails(upload(USERS.expert, `visionDiagnoses/${USERS.expert.uid}/d1.jpg`));
  });

  it('refuses files of 20 MB or more', async () => {
    await assertFails(upload(USERS.farmer, path, bytes(20 * 1024 * 1024)));
  });

  it('can be read by the farmer and by staff, not by other farmers', async () => {
    await seedFile(path);
    await assertSucceeds(getBytes(ref(storage(USERS.farmer), path)));
    await assertSucceeds(getBytes(ref(storage(USERS.expert), path)));
    await assertFails(getBytes(ref(storage(USERS.otherFarmer), path)));
    await assertFails(getBytes(ref(storage(USERS.pendingExpert), path)));
  });
});

describe('question and conversation media', () => {
  const conversationId = `${USERS.farmer.uid}__${USERS.expert.uid}`;

  beforeEach(async () => {
    await seed(env, `expertConversations/${conversationId}`, {
      farmerId: USERS.farmer.uid,
      expertId: USERS.expert.uid,
      participantIds: [USERS.farmer.uid, USERS.expert.uid],
      status: 'active',
      updatedAt: Timestamp.now(),
    });
  });

  it('takes a farmer’s photo or voice note for a question', async () => {
    await assertSucceeds(upload(USERS.farmer, `expertRequests/${USERS.farmer.uid}/1-leaf.jpg`));
    await assertSucceeds(upload(USERS.farmer, `expertRequests/${USERS.farmer.uid}/1-voice.webm`, bytes(), webm));
    await assertFails(upload(USERS.farmer, `expertRequests/${USERS.farmer.uid}/long.webm`, bytes(5 * 1024 * 1024), webm));
    await assertFails(upload(USERS.otherFarmer, `expertRequests/${USERS.farmer.uid}/1-leaf.jpg`));
  });

  it('takes reply media from approved experts only', async () => {
    await assertSucceeds(upload(USERS.expert, `expertPendingReplies/${USERS.expert.uid}/1-answer.jpg`));
    await assertFails(upload(USERS.pendingExpert, `expertPendingReplies/${USERS.pendingExpert.uid}/1-answer.jpg`));
    await assertFails(upload(USERS.farmer, `expertPendingReplies/${USERS.farmer.uid}/1-answer.jpg`));
  });

  it('keeps conversation media between the two participants', async () => {
    await assertSucceeds(upload(USERS.farmer, `expertConversations/${conversationId}/${USERS.farmer.uid}/2-leaf.jpg`));
    await assertSucceeds(upload(USERS.expert, `expertConversations/${conversationId}/${USERS.expert.uid}/3-note.webm`, bytes(), webm));
    await assertFails(upload(USERS.farmer, `expertConversations/${conversationId}/${USERS.expert.uid}/spoof.jpg`));
    await assertFails(upload(USERS.otherFarmer, `expertConversations/${conversationId}/${USERS.otherFarmer.uid}/x.jpg`));
    await seedFile(`expertConversations/${conversationId}/${USERS.farmer.uid}/2-leaf.jpg`);
    await assertSucceeds(getBytes(ref(storage(USERS.expert), `expertConversations/${conversationId}/${USERS.farmer.uid}/2-leaf.jpg`)));
    await assertFails(getBytes(ref(storage(USERS.otherExpert), `expertConversations/${conversationId}/${USERS.farmer.uid}/2-leaf.jpg`)));
  });
});

describe('community and market uploads', () => {
  it('match the client paths and limits', async () => {
    await assertSucceeds(upload(USERS.farmer, `pricePosts/${USERS.farmer.uid}/1-crate.jpg`));
    await assertFails(upload(USERS.expert, `pricePosts/${USERS.expert.uid}/1-crate.jpg`));
    await assertSucceeds(upload(USERS.expert, `farmerChat/${USERS.expert.uid}/1-note.webm`, bytes(), webm));
    await assertFails(upload(USERS.pendingExpert, `farmerChat/${USERS.pendingExpert.uid}/1-note.webm`, bytes(), webm));
    await assertSucceeds(upload(USERS.farmer, `farmerMessages/${USERS.farmer.uid}/1-leaf.jpg`));
    await assertSucceeds(upload(USERS.farmer, `hydroVision/device_${USERS.farmer.uid}/1-plant.jpg`));
    await assertFails(upload(USERS.farmer, `hydroVision/device_${USERS.otherFarmer.uid}/1-plant.jpg`));
  });

  it('keep function-written and unnamed paths closed to uploads', async () => {
    await assertFails(upload(USERS.admin, 'tts/fake.mp3', bytes(), { contentType: 'audio/mpeg' }));
    await assertFails(upload(USERS.admin, 'climate/layers/1/temperature.json', bytes(), { contentType: 'application/json' }));
    await assertFails(upload(USERS.admin, 'datasets/leaf/1.jpg'));
  });
});
