import { useEffect, useMemo, useState } from 'react';
import '../../styles/workspace.css';
import { useAuth } from '../../context/useAuth.js';
import ConversationThread from '../../components/consultation/ConversationThread.jsx';
import MessageComposer from '../../components/consultation/MessageComposer.jsx';
import { contentLabel, formatWhen } from '../../components/consultation/format.js';
import {
  REQUEST_STATUS,
  cancelExpertRequest,
  createExpertRequest,
  subscribeConversations,
  subscribeFarmerRequests,
} from '../../services/expertRequestService.js';

// Farmer side of "ask an expert": new questions, questions waiting for an
// expert, and the conversations that follow a reply.
const PageExpertQuestions = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const failed = () => setLoadError('تعذّر تحميل أسئلتك. تحقق من الاتصال ثم أعد فتح الصفحة.');
    const stopRequests = subscribeFarmerRequests(user?.uid, setRequests, failed);
    const stopConversations = subscribeConversations({ uid: user?.uid, role: 'farmer' }, setConversations, failed);
    return () => {
      stopRequests();
      stopConversations();
    };
  }, [user?.uid]);

  const waiting = useMemo(() => requests.filter((item) => item.status === REQUEST_STATUS.open), [requests]);
  const cancelled = useMemo(
    () => requests.filter((item) => item.status === REQUEST_STATUS.cancelled).slice(0, 5),
    [requests],
  );
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const ask = async (message) => {
    setConfirmation('');
    await createExpertRequest({ farmer: user, ...message });
    setConfirmation('وصل سؤالك إلى الخبراء. ستظهر المحادثة هنا عند أول رد.');
  };

  const cancel = async (request) => {
    if (!window.confirm('هل تريد إلغاء هذا السؤال؟ لن يراه الخبراء بعد الإلغاء.')) return;
    try {
      await cancelExpertRequest(request.id);
    } catch {
      setLoadError('تعذّر إلغاء السؤال. ربما ردّ عليه خبير للتو.');
    }
  };

  return (
    <section className="questions" dir="rtl">
      <header className="questions-intro">
        <h2>أسئلة للخبراء</h2>
        <p>
          اكتب سؤالك، أو أرفق صورة للجزء المصاب أو تسجيلاً صوتياً. يتولى السؤالَ أولُ خبير متاح، وتستمر
          المحادثة معه في هذه الصفحة.
        </p>
      </header>

      {loadError ? <p className="desk-notice desk-notice--danger" role="alert">{loadError}</p> : null}

      <div className="desk-split" data-view={selected ? 'detail' : 'list'}>
        <div className="desk-split__list">
          <section className="desk-surface question-card" aria-labelledby="new-question-title">
            <div className="desk-heading">
              <h3 id="new-question-title">سؤال جديد</h3>
            </div>
            <MessageComposer
              standalone
              onSend={ask}
              placeholder="مثال: ظهرت بقع بنية على أوراق صنف بورلات بعد أمطار الأسبوع الماضي."
              submitLabel="إرسال السؤال"
              hint="الصورة حتى 20 ميغابايت، والتسجيل الصوتي حتى 10 دقائق."
            />
            {confirmation ? <p className="desk-notice desk-notice--ready" role="status">{confirmation}</p> : null}
          </section>

          <div className="desk-list-group">
            <p className="desk-list-title">
              <span>بانتظار خبير</span>
              <span>{waiting.length}</span>
            </p>
            {waiting.length ? (
              <ul className="desk-list">
                {waiting.map((request) => (
                  <li key={request.id}>
                    <div className="desk-item desk-item--static">
                      <div className="desk-item__top">
                        <span className="desk-chip desk-chip--waiting">بانتظار خبير</span>
                        <span className="desk-item__meta">{formatWhen(request.createdAt)}</span>
                      </div>
                      <span className="desk-item__preview">{contentLabel(request)}</span>
                      <button
                        type="button"
                        className="desk-button desk-button--quiet desk-button--danger"
                        onClick={() => cancel(request)}
                      >
                        إلغاء السؤال
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="desk-muted">لا توجد أسئلة بانتظار الرد.</p>
            )}
          </div>

          <div className="desk-list-group">
            <p className="desk-list-title">
              <span>المحادثات مع الخبراء</span>
              <span>{conversations.length}</span>
            </p>
            {conversations.length ? (
              <ul className="desk-list">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className="desk-item"
                      aria-current={conversation.id === selectedId}
                      onClick={() => setSelectedId(conversation.id)}
                    >
                      <span className="desk-item__top">
                        <span className="desk-item__title">الخبير {conversation.expertName}</span>
                        {conversation.unreadForFarmer ? <span className="desk-unread" aria-label="رد جديد" /> : null}
                      </span>
                      <span className="desk-item__preview">{conversation.lastMessagePreview}</span>
                      <span className="desk-item__meta">{formatWhen(conversation.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="desk-muted">ستظهر هنا المحادثة بعد أول رد من خبير.</p>
            )}
          </div>

          {cancelled.length ? (
            <div className="desk-list-group">
              <p className="desk-list-title">
                <span>أسئلة ألغيتها</span>
              </p>
              <ul className="desk-list">
                {cancelled.map((request) => (
                  <li key={request.id}>
                    <div className="desk-item desk-item--static">
                      <span className="desk-item__preview">{contentLabel(request)}</span>
                      <span className="desk-item__meta">{formatWhen(request.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="desk-split__detail">
          {selected ? (
            <ConversationThread
              conversation={selected}
              viewer={user}
              role="farmer"
              title={`الخبير ${selected.expertName}`}
              subtitle={`بدأت ${formatWhen(selected.createdAt)}`}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="desk-surface">
              <p className="desk-empty">اختر محادثة من القائمة لقراءة ردود الخبير.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default PageExpertQuestions;
