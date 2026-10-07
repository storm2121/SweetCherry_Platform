import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import MessageComposer from './MessageComposer.jsx';
import MessageMedia from './MessageMedia.jsx';
import { formatWhen } from './format.js';
import {
  markConversationRead,
  sendConversationMessage,
  subscribeMessages,
} from '../../services/expertRequestService.js';

// One farmer–expert conversation, for either side. `role` is the viewer's
// side ('farmer' | 'expert').
const ConversationThread = ({ conversation, viewer, role, title, subtitle, onBack }) => {
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const bodyRef = useRef(null);
  // Follow new messages while the reader is at the bottom; leave them alone
  // once they scroll up to read earlier ones.
  const followRef = useRef(true);
  const unread = role === 'farmer' ? conversation.unreadForFarmer : conversation.unreadForExpert;

  useEffect(() => {
    followRef.current = true;
    setMessages([]);
    setLoadError('');
    return subscribeMessages(conversation.id, setMessages, () =>
      setLoadError('تعذّر تحميل الرسائل. تحقق من الاتصال ثم أعد فتح المحادثة.'),
    );
  }, [conversation.id]);

  useEffect(() => {
    if (!unread) return;
    markConversationRead({ conversation, role }).catch(() => {});
  }, [conversation, role, unread]);

  const followLatest = useCallback(() => {
    const body = bodyRef.current;
    if (body && followRef.current) body.scrollTop = body.scrollHeight;
  }, []);

  // Photos finish loading after the messages render and push them down, so
  // they call followLatest again when they load.
  useLayoutEffect(followLatest, [messages, followLatest]);

  const trackScroll = () => {
    const body = bodyRef.current;
    if (body) followRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  };

  const send = (message) => {
    followRef.current = true;
    return sendConversationMessage({ conversationId: conversation.id, sender: viewer, role, ...message });
  };

  const active = (conversation.status ?? 'active') === 'active';

  return (
    <section className="desk-thread" aria-label={`محادثة مع ${title}`}>
      <header className="desk-thread__head">
        <div>
          {onBack ? (
            <button type="button" className="desk-button desk-button--quiet desk-back" onClick={onBack}>
              رجوع إلى القائمة
            </button>
          ) : null}
          <h3>{title}</h3>
          {subtitle ? <p className="desk-muted">{subtitle}</p> : null}
        </div>
        <span className={`desk-chip ${active ? 'desk-chip--active' : 'desk-chip--closed'}`}>
          {active ? 'محادثة جارية' : 'محادثة مغلقة'}
        </span>
      </header>

      <div className="desk-thread__body" ref={bodyRef} role="log" aria-live="polite" onScroll={trackScroll}>
        {loadError ? <p className="desk-notice desk-notice--danger">{loadError}</p> : null}
        {!loadError && !messages.length ? <p className="desk-empty">جارٍ تحميل الرسائل…</p> : null}
        {messages.map((message) => (
          <Message key={message.id} message={message} own={message.senderId === viewer.uid} onMediaLoad={followLatest} />
        ))}
      </div>

      {active ? (
        <MessageComposer
          onSend={send}
          placeholder={role === 'farmer' ? 'اكتب ردك أو سؤالاً إضافياً' : 'اكتب ردك للمزارع'}
        />
      ) : (
        <p className="desk-notice desk-thread__closed">لا يمكن إرسال رسائل جديدة في هذه المحادثة.</p>
      )}
    </section>
  );
};

const Message = ({ message, own, onMediaLoad }) => {
  const sender = message.senderRole === 'expert' ? `الخبير ${message.senderName || ''}`.trim() : message.senderName || 'المزارع';
  return (
    <article className={`desk-msg${own ? ' desk-msg--own' : ''}`}>
      <div className="desk-msg__meta">
        {message.requestMarker ? <span className="desk-msg__label">السؤال</span> : null}
        <span>{own ? 'أنت' : sender}</span>
        <time>{formatWhen(message.createdAt)}</time>
      </div>
      <MessageMedia type={message.type} fileUrl={message.fileUrl} description={message.body} onLoad={onMediaLoad} />
      {message.body ? <p className="desk-msg__body">{message.body}</p> : null}
    </article>
  );
};

export default ConversationThread;
