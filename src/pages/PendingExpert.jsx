import '../styles/public.css';
import '../styles/workspace.css';
import Brand from '../components/Brand.jsx';
import LanguageSwitch from '../components/LanguageSwitch.jsx';
import { useAuth } from '../context/useAuth.js';
import { AUTH_COPY } from '../i18n/authCopy.js';
import { dirFor, usePublicLanguage } from '../i18n/language.js';

// Shown to experts whose registration an admin has not approved. Like the
// sign-in pages, it follows the chosen public language.
const PendingExpert = ({ status }) => {
  const { user, logout } = useAuth();
  const [lang, setLang] = usePublicLanguage();
  const t = AUTH_COPY[lang];
  const rejected = status === 'rejected';

  return (
    <main className="ws-pending sc-public" dir={dirFor(lang)} lang={lang}>
      <div className="ws-pending__top">
        <Brand tagline={t.tagline} />
        <LanguageSwitch lang={lang} onChange={setLang} />
      </div>
      <section className="desk-surface ws-pending__card" aria-labelledby="pending-title">
        <h1 id="pending-title">{rejected ? t.pending.rejectedTitle : t.pending.title}</h1>
        <p>{rejected ? t.pending.rejectedBody : t.pending.body(user?.name)}</p>
        <p className="desk-muted">
          {t.pending.account} <bdi dir="ltr">{user?.phone || '—'}</bdi>
        </p>
        <button type="button" className="desk-button" onClick={logout}>
          {t.pending.signOut}
        </button>
      </section>
    </main>
  );
};

export default PendingExpert;
