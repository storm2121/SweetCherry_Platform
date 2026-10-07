import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import MessageMedia from '../../components/consultation/MessageMedia.jsx';
import {
  addInboxReply,
  markInboxMessageRead,
  subscribeInbox,
  subscribeInboxReplies,
} from '../../services/expertService.js';

// Photos and voice notes farmers sent before questions to experts existed.
// Notes written here stay between experts; the farmer never sees them.
const Inbox = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [filters, setFilters] = useState({ unread: 'all', type: 'all', date: 'all', search: '' });

  useEffect(() => {
    const unsubscribe = subscribeInbox(setMessages, user);
    return () => unsubscribe?.();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMessages = useMemo(() => filterMessages(messages, filters), [messages, filters]);
  const groupedMessages = useMemo(() => groupMessagesByDate(filteredMessages), [filteredMessages]);
  const unreadCount = messages.filter((message) => message.isUnread).length;
  // Only an explicitly opened message counts as read.
  const selected = messages.find((message) => message.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setReplies([]);
      return undefined;
    }
    const unsubscribe = subscribeInboxReplies(selectedId, setReplies);
    markInboxMessageRead({ messageId: selectedId, expert: user }).catch((error) => {
      console.error('Failed to mark inbox item read', error);
    });
    return () => unsubscribe?.();
  }, [selectedId, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));

  const handleReply = async (event) => {
    event.preventDefault();
    if (!selected || !replyText.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      await addInboxReply({ messageId: selected.id, expert: user, body: replyText });
      setReplyText('');
      setStatus({ tone: 'ready', text: 'أُضيفت الملاحظة. يراها الخبراء فقط.' });
    } catch (error) {
      console.error('Failed to add inbox reply', error);
      setStatus({ tone: 'danger', text: 'تعذّر حفظ الملاحظة. حاول مرة أخرى.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="desk-split" data-view={selected ? 'detail' : 'list'}>
      <aside className="desk-split__list review-queue" aria-label="الرسائل السابقة">
        <p className="desk-notice">
          صور وتسجيلات أرسلها المزارعون قبل خدمة الأسئلة. ما تكتبه هنا ملاحظات بين الخبراء ولا يصل إلى المزارع؛
          للرد على مزارع استخدم قسم «أسئلة المزارعين».
        </p>
        <div className="review-queue__tools">
          <label className="desk-field">
            <span className="sr-only">بحث</span>
            <input
              className="desk-input"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو المنطقة"
            />
          </label>
          <div className="review-queue__selects">
            <label className="desk-field">
              <span>الحالة</span>
              <select className="desk-select" value={filters.unread} onChange={(event) => updateFilter('unread', event.target.value)}>
                <option value="all">الكل</option>
                <option value="unread">غير المقروءة ({unreadCount})</option>
              </select>
            </label>
            <label className="desk-field">
              <span>النوع</span>
              <select className="desk-select" value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
                <option value="all">صور وتسجيلات</option>
                <option value="image">صور</option>
                <option value="audio">تسجيلات صوتية</option>
              </select>
            </label>
          </div>
          <label className="desk-field">
            <span>الفترة</span>
            <select className="desk-select" value={filters.date} onChange={(event) => updateFilter('date', event.target.value)}>
              <option value="all">كل الوقت</option>
              <option value="today">اليوم</option>
              <option value="week">آخر 7 أيام</option>
            </select>
          </label>
        </div>

        {!filteredMessages.length ? <p className="desk-empty">لا توجد رسائل مطابقة.</p> : null}
        {groupedMessages.map((group) => (
          <div key={group.label} className="desk-list-group">
            <p className="desk-list-title">{group.label}</p>
            <ul className="desk-list">
              {group.items.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    className="desk-item review-queue__item"
                    aria-current={message.id === selectedId}
                    onClick={() => setSelectedId(message.id)}
                  >
                    {message.type === 'image' ? <img src={message.fileUrl} alt="" loading="lazy" /> : <span className="inbox-audio-mark">صوت</span>}
                    <span className="review-queue__text">
                      <span className="desk-item__top">
                        <span className="desk-item__title">{message.farmerName || 'مزارع'}</span>
                        {message.isUnread ? <span className="desk-unread" aria-label="غير مقروءة" /> : null}
                      </span>
                      <span className="desk-item__meta">
                        {message.farmerRegion || 'منطقة غير محددة'} · {formatTime(message.lastActivityAt)}
                      </span>
                      <span className="desk-item__preview">
                        {message.lastReplyPreview || (message.type === 'audio' ? 'تسجيل صوتي من المزارع' : 'صورة من المزارع')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <div className="desk-split__detail">
        {!selected ? (
          <div className="desk-surface">
            <p className="desk-empty">اختر رسالة لعرضها وقراءة ملاحظات الخبراء عليها.</p>
          </div>
        ) : (
          <section className="desk-thread" aria-label={`رسالة من ${selected.farmerName || 'مزارع'}`}>
            <header className="desk-thread__head">
              <div>
                <button type="button" className="desk-button desk-button--quiet desk-back" onClick={() => setSelectedId(null)}>
                  رجوع إلى القائمة
                </button>
                <h3>{selected.farmerName || 'مزارع'}</h3>
                <p className="desk-muted">
                  {selected.farmerRegion || 'منطقة غير محددة'}
                  {selected.farmerPhone ? (
                    <>
                      {' · '}
                      <bdi dir="ltr">{selected.farmerPhone}</bdi>
                    </>
                  ) : null}
                  {' · أُرسلت '}
                  {formatTimestamp(selected.createdAt)}
                </p>
              </div>
              <span className="desk-chip">{selected.type === 'audio' ? 'تسجيل صوتي' : 'صورة'}</span>
            </header>

            <div className="desk-thread__body">
              <article className="desk-msg">
                <div className="desk-msg__meta">
                  <span className="desk-msg__label">رسالة المزارع</span>
                  <time>{formatTimestamp(selected.createdAt)}</time>
                </div>
                <MessageMedia type={selected.type} fileUrl={selected.fileUrl} description={`من ${selected.farmerName || 'المزارع'}`} />
              </article>
              {!replies.length ? <p className="desk-empty">لا توجد ملاحظات بعد.</p> : null}
              {replies.map((reply) => (
                <article key={reply.id} className={`desk-msg${reply.expertId === user?.uid ? ' desk-msg--own' : ''}`}>
                  <div className="desk-msg__meta">
                    <span>{reply.expertId === user?.uid ? 'أنت' : reply.expertName || 'خبير'}</span>
                    <time>{formatTimestamp(reply.createdAt)}</time>
                  </div>
                  <p className="desk-msg__body">{reply.body}</p>
                </article>
              ))}
            </div>

            <form className="desk-composer" onSubmit={handleReply}>
              <label className="desk-field" htmlFor="expert-inbox-note">
                <span>ملاحظة للخبراء</span>
                <textarea
                  id="expert-inbox-note"
                  className="desk-textarea"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="ما لاحظته في هذه الرسالة، ليطّلع عليه باقي الخبراء"
                />
              </label>
              <div className="desk-composer__row">
                <span className="desk-muted">لا تصل هذه الملاحظة إلى المزارع.</span>
                <button type="submit" className="desk-button desk-button--primary" disabled={sending || !replyText.trim()}>
                  {sending ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}
                </button>
              </div>
              {status ? (
                <p className={`desk-notice desk-notice--${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
                  {status.text}
                </p>
              ) : null}
            </form>
          </section>
        )}
      </div>
    </div>
  );
};

const filterMessages = (messages, filters) => {
  const search = filters.search.trim().toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return messages.filter((message) => {
    if (filters.unread === 'unread' && !message.isUnread) return false;
    if (filters.type !== 'all' && message.type !== filters.type) return false;
    const activityMs = timestampMs(message.lastActivityAt || message.createdAt);
    if (filters.date === 'today' && activityMs < startOfTodayMs()) return false;
    if (filters.date === 'week' && now - activityMs > 7 * dayMs) return false;
    if (!search) return true;
    return [message.farmerName, message.farmerPhone, message.farmerRegion, message.lastReplyPreview]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
};

const groupMessagesByDate = (messages) => {
  const groups = [];
  messages.forEach((message) => {
    const label = formatDateGroup(message.lastActivityAt || message.createdAt);
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.items.push(message);
    else groups.push({ label, items: [message] });
  });
  return groups;
};

const startOfTodayMs = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const formatDateGroup = (value) => {
  const date = timestampToDate(value);
  if (!date) return 'تاريخ غير محدد';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'اليوم';
  if (sameDay(date, yesterday)) return 'أمس';
  return date.toLocaleDateString('ar-MA', { weekday: 'long', day: 'numeric', month: 'short' });
};

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatTime = (value) => {
  const date = timestampToDate(value);
  if (!date) return '';
  return date.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
};

const formatTimestamp = (value) => {
  const date = timestampToDate(value);
  if (!date) return 'غير محدد';
  return date.toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' });
};

const timestampToDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
};

const timestampMs = (value) => {
  const date = timestampToDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

export default Inbox;
