// Farmer questions to experts.
//
// The claimExpertRequestAndReply callable was deployed on 2026-05-07 but never
// committed. This module rebuilds it from the deployed source. It keeps the
// recovered behaviour with four fixes:
// - a conversation that already exists keeps its createdAt and farmerReadAt;
// - the copied question keeps the time it was asked, so it sorts before the reply;
// - a cancelled request is reported as cancelled, not as already assigned;
// - an expert can attach only media they uploaded themselves.
//
// The module has no imports. Firebase objects are passed in, so the same code
// runs in Cloud Functions, in tests against the emulator, and (for ids,
// previews and limits) in the web client.
//
// Firestore:
//   expertRequests/{requestId}             the farmer's question; status open → assigned | cancelled
//   expertConversations/{farmer}__{expert} one thread per farmer/expert pair
//   expertConversations/{id}/messages/*    the request copy, then messages from both sides
// Storage:
//   expertRequests/{farmerUid}/…                 media attached by the farmer
//   expertPendingReplies/{expertUid}/…           media an expert sends with the first reply
//   expertConversations/{conversationId}/{uid}/… media sent later in a thread

export const EXPERT_REQUESTS = 'expertRequests';
export const EXPERT_CONVERSATIONS = 'expertConversations';
export const EXPERT_CONVERSATION_MESSAGES = 'messages';
export const EXPERT_PENDING_REPLIES = 'expertPendingReplies';
export const EXPERT_STORAGE_PREFIXES = [
  `${EXPERT_REQUESTS}/`,
  `${EXPERT_CONVERSATIONS}/`,
  `${EXPERT_PENDING_REPLIES}/`,
];

export const MESSAGE_TYPES = ['text', 'image', 'audio'];
export const MESSAGE_BODY_MAX = 2000;
export const PREVIEW_MAX = 160;

export class ExpertRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExpertRequestError';
    this.code = code;
  }
}

const cleanString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const safeDocSegment = (value) => String(value || '').replace(/[/.#[\]]/g, '_');

export const expertConversationId = (farmerId, expertId) =>
  `${safeDocSegment(farmerId)}__${safeDocSegment(expertId)}`;

export const normalizeExpertReplyPayload = (input = {}) => {
  const type = MESSAGE_TYPES.includes(input?.type) ? input.type : 'text';
  const body = String(input?.body || input?.content || '').trim();
  const fileUrl = cleanString(input?.fileUrl);
  const filePath = cleanString(input?.filePath);

  if (type === 'text' && !body) {
    throw new ExpertRequestError('invalid-argument', 'Reply text is required.');
  }
  if (type !== 'text' && !fileUrl) {
    throw new ExpertRequestError('invalid-argument', 'Reply media URL is required.');
  }
  if (body.length > MESSAGE_BODY_MAX) {
    throw new ExpertRequestError('invalid-argument', 'Reply text is too long.');
  }

  return {
    type,
    body,
    fileUrl: type === 'text' ? null : fileUrl,
    filePath: type === 'text' ? null : filePath,
  };
};

export const requestPreviewText = (request = {}) => {
  if (request.type === 'text') return String(request.body || '').slice(0, PREVIEW_MAX);
  if (request.type === 'audio') return 'رسالة صوتية جديدة من المزارع';
  return 'صورة جديدة من المزارع';
};

export const messagePreview = (message = {}, senderRole = 'expert') => {
  if (message.type === 'text') return String(message.body || '').slice(0, PREVIEW_MAX);
  const fromFarmer = senderRole === 'farmer';
  if (message.type === 'audio') return fromFarmer ? 'رسالة صوتية من المزارع' : 'رسالة صوتية من الخبير';
  return fromFarmer ? 'صورة من المزارع' : 'صورة من الخبير';
};

export const expertDisplayName = (expert = {}) => expert.name || expert.phone || 'Expert';

export const loadApprovedExpert = async ({ db, auth }) => {
  if (!auth?.uid) {
    throw new ExpertRequestError('unauthenticated', 'Login required.');
  }

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists) {
    throw new ExpertRequestError('permission-denied', 'User profile missing.');
  }

  const user = { uid: auth.uid, ...userSnap.data() };
  if (user.role !== 'expert' || user.status !== 'approved') {
    throw new ExpertRequestError('permission-denied', 'Approved expert access required.');
  }
  return user;
};

// Assigns an open request to the expert and posts their first reply, in one
// transaction. If another expert answered first, nothing is written and the
// result says who did.
export const claimExpertRequest = async ({ db, FieldValue, expert, requestId, reply }) => {
  const id = String(requestId || '').trim();
  if (!id) {
    throw new ExpertRequestError('invalid-argument', 'requestId is required.');
  }

  const normalizedReply = normalizeExpertReplyPayload(reply);
  if (
    normalizedReply.filePath &&
    !normalizedReply.filePath.startsWith(`${EXPERT_PENDING_REPLIES}/${expert.uid}/`)
  ) {
    throw new ExpertRequestError('invalid-argument', 'Reply media must be uploaded by the replying expert.');
  }

  const expertName = expertDisplayName(expert);
  const requestRef = db.collection(EXPERT_REQUESTS).doc(id);

  return db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) {
      throw new ExpertRequestError('not-found', 'Expert request not found.');
    }

    const request = requestSnap.data() ?? {};
    if (request.status !== 'open') {
      return {
        ok: false,
        status: request.status === 'cancelled' ? 'cancelled' : 'already_assigned',
        requestId: id,
        assignedExpertId: request.assignedExpertId ?? null,
        assignedExpertName: request.assignedExpertName ?? null,
        conversationId: request.conversationId ?? null,
      };
    }

    const farmerId = String(request.farmerId || '').trim();
    if (!farmerId) {
      throw new ExpertRequestError('failed-precondition', 'Request is missing farmerId.');
    }

    const conversationId = expertConversationId(farmerId, expert.uid);
    const conversationRef = db.collection(EXPERT_CONVERSATIONS).doc(conversationId);
    // Transactions read before they write.
    const conversationSnap = await transaction.get(conversationRef);
    const messages = conversationRef.collection(EXPERT_CONVERSATION_MESSAGES);
    const requestMessageRef = messages.doc(`request_${id}`);
    const replyMessageRef = messages.doc();
    const now = FieldValue.serverTimestamp();

    transaction.set(
      conversationRef,
      {
        farmerId,
        farmerName: request.farmerName ?? '',
        farmerPhone: request.farmerPhone ?? null,
        farmerRegion: request.farmerRegion ?? null,
        expertId: expert.uid,
        expertName,
        participantIds: [farmerId, expert.uid],
        status: 'active',
        lastRequestId: id,
        lastMessagePreview: messagePreview(normalizedReply, 'expert'),
        lastMessageSenderId: expert.uid,
        lastMessageSenderRole: 'expert',
        unreadForFarmer: true,
        unreadForExpert: false,
        expertReadAt: now,
        updatedAt: now,
        ...(conversationSnap.exists ? {} : { farmerReadAt: null, createdAt: now }),
      },
      { merge: true },
    );

    transaction.set(requestMessageRef, {
      conversationId,
      requestId: id,
      senderId: farmerId,
      senderName: request.farmerName ?? 'Farmer',
      senderRole: 'farmer',
      type: request.type || 'text',
      body: request.body || '',
      fileUrl: request.fileUrl ?? null,
      filePath: request.filePath ?? null,
      requestMarker: true,
      createdAt: request.createdAt ?? now,
    });

    transaction.set(replyMessageRef, {
      conversationId,
      requestId: id,
      senderId: expert.uid,
      senderName: expertName,
      senderRole: 'expert',
      type: normalizedReply.type,
      body: normalizedReply.body,
      fileUrl: normalizedReply.fileUrl,
      filePath: normalizedReply.filePath,
      createdAt: now,
    });

    transaction.update(requestRef, {
      status: 'assigned',
      assignedExpertId: expert.uid,
      assignedExpertName: expertName,
      conversationId,
      assignedAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      status: 'assigned',
      requestId: id,
      conversationId,
      assignedExpertId: expert.uid,
      assignedExpertName: expertName,
      requestPreview: requestPreviewText(request),
    };
  });
};

// Builds the callable exported from functions/index.js:
//   export const claimExpertRequestAndReply =
//     createClaimExpertRequestAndReply({ onCall, HttpsError, db, FieldValue });
export const createClaimExpertRequestAndReply = ({ onCall, HttpsError, db, FieldValue }) =>
  onCall({ cors: true }, async (request) => {
    try {
      const expert = await loadApprovedExpert({ db, auth: request.auth });
      return await claimExpertRequest({
        db,
        FieldValue,
        expert,
        requestId: request.data?.requestId,
        reply: request.data?.reply,
      });
    } catch (error) {
      if (error instanceof ExpertRequestError) {
        throw new HttpsError(error.code, error.message);
      }
      throw error;
    }
  });

// Deletes a conversation's messages and the files they reference, 200 at a
// time. Used when an admin deletes a conversation or a user.
export const deleteConversationMessages = async ({
  db,
  collectionRef,
  collectStoragePaths,
  deleteStoragePath,
}) => {
  let deleted = 0;
  let storageDeleted = 0;
  while (true) {
    const snapshot = await collectionRef.limit(200).get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      for (const path of collectStoragePaths(docSnap.data())) {
        storageDeleted += await deleteStoragePath(path);
      }
    }

    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 200) break;
  }
  return { deleted, storageDeleted };
};
