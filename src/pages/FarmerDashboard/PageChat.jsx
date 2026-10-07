import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import MessageComposer from '../../components/consultation/MessageComposer.jsx';
import MessageMedia from '../../components/consultation/MessageMedia.jsx';
import { formatWhen } from '../../components/consultation/format.js';
import { sendChatMessage, subscribeFarmerChat } from '../../services/farmerService.js';

// The farmers' room: one shared conversation for all members.
const PageChat = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const bodyRef = useRef(null);
  const followRef = useRef(true);

  useEffect(
    () => subscribeFarmerChat(setMessages, () => setLoadError('تعذّر تحميل الرسائل. تحقق من الاتصال.')),
    [],
  );

  const followLatest = useCallback(() => {
    const body = bodyRef.current;
    if (body && followRef.current) body.scrollTop = body.scrollHeight;
  }, []);

  useLayoutEffect(followLatest, [messages, followLatest]);

  const trackScroll = () => {
    const body = bodyRef.current;
    if (body) followRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  };

  // A room message holds either text or one file, so a caption on a photo or
  // voice note goes out as a short text message right after it.
  const send = async ({ type, body, file }) => {
    followRef.current = true;
    const text = String(body || '').trim();
    if (type === 'text') {
      await sendChatMessage({ sender: user, type: 'text', content: text });
      return;
    }
    await sendChatMessage({ sender: user, type, file });
    if (text) await sendChatMessage({ sender: user, type: 'text', content: text });
  };

  return (
    <section className="farm-page" aria-labelledby="room-title">
      <section className="desk-thread room" aria-labelledby="room-title">
        <header className="desk-thread__head">
          <div>
            <h2 id="room-title" className="room__title">غرفة المزارعين</h2>
            <p className="desk-muted">مساحة مفتوحة لكل مزارعي المنصة. لا تشارك أرقام الهواتف أو المعلومات الشخصية.</p>
          </div>
        </header>

        <div className="desk-thread__body" ref={bodyRef} role="log" aria-live="polite" onScroll={trackScroll}>
          {loadError ? <p className="desk-notice desk-notice--danger">{loadError}</p> : null}
          {!loadError && !messages.length ? <p className="desk-empty">لا توجد رسائل بعد. ابدأ أنت.</p> : null}
          {messages.map((message) => {
            const own = message.senderId === user?.uid;
            return (
              <article key={message.id} className={`desk-msg${own ? ' desk-msg--own' : ''}`}>
                <div className="desk-msg__meta">
                  <span>{own ? 'أنت' : message.senderName || 'مزارع'}</span>
                  <time>{formatWhen(message.createdAt)}</time>
                </div>
                {message.type === 'text' ? (
                  <p className="desk-msg__body">{message.content}</p>
                ) : (
                  <MessageMedia type={message.type} fileUrl={message.content} onLoad={followLatest} />
                )}
              </article>
            );
          })}
        </div>

        <MessageComposer onSend={send} placeholder="اكتب رسالة لمزارعي المنطقة" />
      </section>
    </section>
  );
};

export default PageChat;
