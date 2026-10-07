import { useEffect, useRef, useState } from 'react';
import '../../styles/workspace.css';
import { useAuth } from '../../context/useAuth.js';
import { subscribeConversations, subscribeOpenRequests } from '../../services/expertRequestService.js';
import ExpertQuestions from './ExpertQuestions.jsx';
import Inbox from './Inbox.jsx';
import NotesManager from './NotesManager.jsx';
import VisionQueue from './VisionQueue.jsx';

const TABS = [
  { id: 'vision', label: 'تشخيص الصور' },
  { id: 'questions', label: 'أسئلة المزارعين' },
  { id: 'notes', label: 'التوجيهات حسب المنطقة' },
  { id: 'inbox', label: 'رسائل سابقة' },
];

const ExpertDashboard = () => {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('vision');
  const pendingQuestions = usePendingQuestionCount(user?.uid);
  const tabRefs = useRef({});

  // Arrow keys move between tabs. In right-to-left text the next tab is to the left.
  const onTabKey = (event) => {
    const index = TABS.findIndex((item) => item.id === tab);
    const step = { ArrowLeft: 1, ArrowRight: -1 }[event.key];
    let next = null;
    if (step) next = TABS[(index + step + TABS.length) % TABS.length];
    if (event.key === 'Home') next = TABS[0];
    if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <main className="desk" dir="rtl">
      <header className="desk-header">
        <div>
          <h1>مساحة الخبير</h1>
          <p>{user?.name ? `${user.name} · خبير معتمد` : 'خبير معتمد'}</p>
        </div>
        <button type="button" className="desk-button" onClick={logout}>
          تسجيل الخروج
        </button>
      </header>

      <div className="desk-tabs" role="tablist" aria-label="أقسام مساحة الخبير" onKeyDown={onTabKey}>
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            type="button"
            role="tab"
            id={`expert-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`expert-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className="desk-tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'questions' && pendingQuestions ? (
              <span className="desk-count" aria-label={`${pendingQuestions} بانتظار الرد`}>{pendingQuestions}</span>
            ) : null}
          </button>
        ))}
      </div>

      <section role="tabpanel" id={`expert-panel-${tab}`} aria-labelledby={`expert-tab-${tab}`}>
        {tab === 'vision' ? <VisionQueue /> : null}
        {tab === 'questions' ? <ExpertQuestions /> : null}
        {tab === 'notes' ? <NotesManager /> : null}
        {tab === 'inbox' ? <Inbox /> : null}
      </section>
    </main>
  );
};

// Open questions plus this expert's conversations with unread farmer messages.
const usePendingQuestionCount = (uid) => {
  const [open, setOpen] = useState(0);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!uid) return undefined;
    const stopOpen = subscribeOpenRequests((items) => setOpen(items.length), () => setOpen(0));
    const stopUnread = subscribeConversations(
      { uid, role: 'expert' },
      (items) => setUnread(items.filter((item) => item.unreadForExpert).length),
      () => setUnread(0),
    );
    return () => {
      stopOpen();
      stopUnread();
    };
  }, [uid]);
  return open + unread;
};

export default ExpertDashboard;
