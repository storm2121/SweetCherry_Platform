import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import ConversationThread from '../../components/consultation/ConversationThread.jsx';
import MessageComposer from '../../components/consultation/MessageComposer.jsx';
import MessageMedia from '../../components/consultation/MessageMedia.jsx';
import { contentLabel, formatWhen } from '../../components/consultation/format.js';
import { REGIONS } from '../../services/constants.js';
import {
  answerExpertRequest,
  subscribeConversations,
  subscribeOpenRequests,
} from '../../services/expertRequestService.js';

// Expert side of farmer questions. Open questions wait in arrival order; the
// first expert to reply takes the question and continues in a conversation.
const ExpertQuestions = () => {
  const { user } = useAuth();
  const [openRequests, setOpenRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selection, setSelection] = useState(null);
  const [region, setRegion] = useState('all');
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const failed = () => setLoadError('تعذّر تحميل الأسئلة. تحقق من الاتصال ثم أعد فتح الصفحة.');
    const stopRequests = subscribeOpenRequests(setOpenRequests, failed);
    const stopConversations = subscribeConversations({ uid: user?.uid, role: 'expert' }, setConversations, failed);
    return () => {
      stopRequests();
      stopConversations();
    };
  }, [user?.uid]);

  const visibleRequests = useMemo(
    () => (region === 'all' ? openRequests : openRequests.filter((item) => item.farmerRegion === region)),
    [openRequests, region],
  );
  const liveRequest =
    selection?.kind === 'request' ? openRequests.find((item) => item.id === selection.id) ?? null : null;
  // Keep showing a question after it leaves the open list (another expert took
  // it, or the farmer cancelled), so a reply being typed is not lost.
  const [lastRequest, setLastRequest] = useState(null);
  useEffect(() => {
    if (liveRequest) setLastRequest(liveRequest);
  }, [liveRequest]);
  const selectedRequest =
    liveRequest ?? (selection?.kind === 'request' && lastRequest?.id === selection.id ? lastRequest : null);
  const requestClosed = Boolean(selectedRequest) && !liveRequest;
  const selectedConversation =
    selection?.kind === 'conversation' ? conversations.find((item) => item.id === selection.id) ?? null : null;
  const conversationLoading = selection?.kind === 'conversation' && !selectedConversation;

  const select = (kind, id) => {
    setNotice(null);
    setSelection({ kind, id });
  };

  const answer = async (message) => {
    const result = await answerExpertRequest({ requestId: selectedRequest.id, expert: user, ...message });
    if (result?.ok) {
      setSelection({ kind: 'conversation', id: result.conversationId });
      setNotice({ tone: 'ready', text: 'أُرسل ردك وأصبح السؤال ضمن محادثاتك.' });
      return;
    }
    if (result?.status === 'cancelled') throw new Error('ألغى المزارع هذا السؤال قبل ردك.');
    throw new Error(`ردّ ${result?.assignedExpertName || 'خبير آخر'} على هذا السؤال قبلك. نصّ ردك ما زال هنا.`);
  };

  return (
    <div className="desk-split" data-view={selection ? 'detail' : 'list'}>
      <div className="desk-split__list">
        {loadError ? <p className="desk-notice desk-notice--danger" role="alert">{loadError}</p> : null}

        <div className="desk-list-group">
          <div className="desk-list-title">
            <span>أسئلة تنتظر ردّاً ({openRequests.length})</span>
            <label>
              <span className="sr-only">المنطقة</span>
              <select className="desk-select" value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="all">كل المناطق</option>
                {REGIONS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          {visibleRequests.length ? (
            <ul className="desk-list">
              {visibleRequests.map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    className="desk-item"
                    aria-current={selection?.kind === 'request' && selection.id === request.id}
                    onClick={() => select('request', request.id)}
                  >
                    <span className="desk-item__top">
                      <span className="desk-item__title">{request.farmerName || 'مزارع'}</span>
                      <span className="desk-item__meta">{formatWhen(request.createdAt)}</span>
                    </span>
                    <span className="desk-item__preview">{contentLabel(request)}</span>
                    <span className="desk-item__meta">{request.farmerRegion || 'منطقة غير محددة'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="desk-muted">لا توجد أسئلة مفتوحة{region === 'all' ? '' : ` في ${region}`}.</p>
          )}
        </div>

        <div className="desk-list-group">
          <p className="desk-list-title">
            <span>محادثاتي</span>
            <span>{conversations.length}</span>
          </p>
          {conversations.length ? (
            <ul className="desk-list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className="desk-item"
                    aria-current={selection?.kind === 'conversation' && selection.id === conversation.id}
                    onClick={() => select('conversation', conversation.id)}
                  >
                    <span className="desk-item__top">
                      <span className="desk-item__title">{conversation.farmerName || 'مزارع'}</span>
                      {conversation.unreadForExpert ? <span className="desk-unread" aria-label="رسالة جديدة" /> : null}
                    </span>
                    <span className="desk-item__preview">{conversation.lastMessagePreview}</span>
                    <span className="desk-item__meta">
                      {conversation.farmerRegion || 'منطقة غير محددة'} · {formatWhen(conversation.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="desk-muted">ستظهر هنا المحادثات بعد ردك على سؤال.</p>
          )}
        </div>
      </div>

      <div className="desk-split__detail">
        {notice ? <p className={`desk-notice desk-notice--${notice.tone}`} role="status">{notice.text}</p> : null}

        {selectedRequest ? (
          <section className="desk-surface question-card" aria-labelledby="question-title">
            <button type="button" className="desk-button desk-button--quiet desk-back" onClick={() => setSelection(null)}>
              رجوع إلى القائمة
            </button>
            <div className="question-card__head">
              <div>
                <h3 id="question-title">سؤال من {selectedRequest.farmerName || 'مزارع'}</h3>
                <p className="desk-muted">
                  {selectedRequest.farmerRegion || 'منطقة غير محددة'} · {formatWhen(selectedRequest.createdAt)}
                </p>
              </div>
              <span className={`desk-chip ${requestClosed ? 'desk-chip--closed' : 'desk-chip--waiting'}`}>
                {requestClosed ? 'لم يعد مفتوحاً' : 'بانتظار ردّ'}
              </span>
            </div>
            <MessageMedia type={selectedRequest.type} fileUrl={selectedRequest.fileUrl} description={selectedRequest.body} />
            {selectedRequest.body ? <p className="question-card__body">{selectedRequest.body}</p> : null}
            {requestClosed ? (
              <p className="desk-notice desk-notice--warning" role="status">
                ردّ خبير آخر على هذا السؤال أو ألغاه المزارع. يبقى نص ردك ظاهراً إن أردت نسخه.
              </p>
            ) : null}
            <MessageComposer
              standalone
              key={selectedRequest.id}
              label="ردّك الأول"
              onSend={answer}
              disabled={requestClosed}
              placeholder="اكتب تشخيصك المبدئي أو ما تحتاج معرفته من المزارع"
              submitLabel="إرسال الرد وتولّي السؤال"
              hint="يُسند السؤال لأول خبير يرد، ثم يتابع المزارع المحادثة معه."
            />
          </section>
        ) : null}

        {conversationLoading ? (
          <div className="desk-surface">
            <p className="desk-empty">جارٍ فتح المحادثة…</p>
          </div>
        ) : null}

        {selectedConversation ? (
          <ConversationThread
            conversation={selectedConversation}
            viewer={user}
            role="expert"
            title={selectedConversation.farmerName || 'مزارع'}
            subtitle={
              <>
                {selectedConversation.farmerRegion || 'منطقة غير محددة'}
                {selectedConversation.farmerPhone ? (
                  <>
                    {' · '}
                    <bdi dir="ltr">{selectedConversation.farmerPhone}</bdi>
                  </>
                ) : null}
              </>
            }
            onBack={() => setSelection(null)}
          />
        ) : null}

        {!selection ? (
          <div className="desk-surface">
            <p className="desk-empty">اختر سؤالاً للرد عليه، أو محادثة لمتابعتها.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ExpertQuestions;
