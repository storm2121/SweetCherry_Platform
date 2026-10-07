import { useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import { REGIONS } from '../services/constants.js';
import { findGrowingRegion, GROWING_REGIONS } from '../data/growingRegions.js';
import Brand from '../components/Brand.jsx';
import Icon from '../components/Icon.jsx';
import LanguageSwitch from '../components/LanguageSwitch.jsx';
import { useRegistrationOpen } from '../hooks/useRegistrationOpen.js';
import { AUTH_COPY } from '../i18n/authCopy.js';
import { dirFor, usePublicLanguage } from '../i18n/language.js';
import { isPlausiblePhone, isValidNewPhone } from '../utils/phone.js';
import '../styles/public.css';

const PROOF_MAX_BYTES = 10 * 1024 * 1024;

const LoginPage = ({ initialMode = 'login', initialRole = 'farmer', onNavigate }) => {
  const { login, register, loading } = useAuth();
  const [lang, setLang] = usePublicLanguage();
  const t = AUTH_COPY[lang];
  const mode = initialMode;
  const page = mode === 'login' ? t.login : t.register;
  // null while checking. Registration is paused between intakes; the rules
  // refuse new profiles then, so the form is not shown at all.
  const registrationOpen = useRegistrationOpen();
  const [role, setRole] = useState(initialRole);
  const [form, setForm] = useState({ fullName: '', phone: '', password: '', city: REGIONS[0], documentFile: null });
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const change = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  const busy = loading || submitting;
  const regionName = (arabicName) => findGrowingRegion(arabicName)?.[lang] ?? arabicName;

  const navigate = (event, path) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(path);
  };

  const explain = (error) => t.errors[error?.code] ?? t.errors.generic;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setStatus('');
    // Sign-in accepts any number an existing account could have; some
    // accounts, the admin's among them, are not Moroccan.
    const phoneOk = mode === 'register' ? isValidNewPhone(form.phone) : isPlausiblePhone(form.phone);
    if (!phoneOk) {
      setStatus(t.errors.phone);
      return;
    }
    if (mode === 'register' && role === 'expert' && form.documentFile?.size > PROOF_MAX_BYTES) {
      setStatus(t.errors.documentTooLarge);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') await login({ phone: form.phone, password: form.password });
      else {
        await register({
          role,
          phone: form.phone,
          password: form.password,
          fullName: form.fullName.trim(),
          city: form.city,
          documentFile: form.documentFile,
        });
      }
    } catch (error) {
      setStatus(explain(error));
    } finally {
      setSubmitting(false);
    }
  };

  const showForm = mode === 'login' || registrationOpen === true;

  return (
    <main className="sc-auth sc-public" dir={dirFor(lang)} lang={lang}>
      <header className="sc-auth-header">
        <a className="sc-brand-link" href="/" onClick={(event) => navigate(event, '/')}>
          <Brand tagline={t.tagline} />
        </a>
        <div className="sc-auth-header__actions">
          <LanguageSwitch lang={lang} onChange={setLang} />
          <a className="sc-text-link sc-back-link" href="/" onClick={(event) => navigate(event, '/')}>
            {t.back}
            <Icon name="arrow" size={18} />
          </a>
        </div>
      </header>

      <div className="sc-auth-layout">
        <section className="sc-auth-context">
          <h1>{page.title}</h1>
          <p>{page.body}</p>
          <div className="sc-auth-context-line">
            <Icon name="location" />
            {GROWING_REGIONS.map((region) => region[lang]).join(' · ')}
          </div>
        </section>

        <section className="sc-auth-form" aria-labelledby="auth-title">
          {mode === 'register' && registrationOpen === null ? (
            <p className="sc-auth-checking" role="status">{t.closed.checking}</p>
          ) : null}

          {mode === 'register' && registrationOpen === false ? (
            <div className="sc-auth-paused" role="status">
              <h2 id="auth-title">{t.closed.title}</h2>
              <p>{t.closed.body}</p>
              <a className="sc-button" href="/login" onClick={(event) => navigate(event, '/login')}>
                {t.closed.action}
                <Icon name="arrow" size={20} />
              </a>
            </div>
          ) : null}

          {showForm ? (
            <>
              <div className="sc-auth-form-heading">
                <h2 id="auth-title">{page.formTitle}</h2>
                <p>{page.formBody}</p>
              </div>
              {mode === 'register' ? (
                <fieldset className="sc-role">
                  <legend>{t.roleLegend}</legend>
                  {['farmer', 'expert'].map((value) => (
                    <label key={value}>
                      <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} disabled={busy} />
                      <span>{t.roles[value]}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <form onSubmit={submit} aria-busy={submitting}>
                {mode === 'register' ? (
                  <label>
                    {t.fields.name}
                    <input name="name" autoComplete="name" required maxLength={100} value={form.fullName} onChange={(event) => change('fullName', event.target.value)} disabled={busy} />
                  </label>
                ) : null}
                <label>
                  {t.fields.phone}
                  <input name="phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" required value={form.phone} onChange={(event) => change('phone', event.target.value)} placeholder="06 00 00 00 00" maxLength={20} disabled={busy} />
                  <small>{t.fields.phoneHint}</small>
                </label>
                <label>
                  {t.fields.password}
                  <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 6 : undefined} value={form.password} onChange={(event) => change('password', event.target.value)} disabled={busy} />
                  {mode === 'register' ? <small>{t.fields.passwordHint}</small> : null}
                </label>
                {mode === 'register' && role === 'farmer' ? (
                  <label>
                    {t.fields.region}
                    <select name="city" value={form.city} onChange={(event) => change('city', event.target.value)} disabled={busy}>
                      {REGIONS.map((city) => <option key={city} value={city}>{regionName(city)}</option>)}
                    </select>
                  </label>
                ) : null}
                {mode === 'register' && role === 'expert' ? (
                  <label>
                    {t.fields.proof}
                    <input name="proof" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required onChange={(event) => change('documentFile', event.target.files?.[0] ?? null)} disabled={busy} />
                    <small>{t.fields.proofHint}</small>
                  </label>
                ) : null}
                {status ? <p className="sc-form-error" role="alert">{status}</p> : null}
                <button className="sc-button" disabled={busy} type="submit">
                  {busy ? t.busy : page.submit}
                  <Icon name="arrow" size={20} />
                </button>
              </form>
              {mode === 'register' || registrationOpen === true ? (
                <p className="sc-auth-switch">
                  {page.switchPrompt}{' '}
                  <a href={mode === 'login' ? '/register' : '/login'} onClick={(event) => navigate(event, mode === 'login' ? '/register' : '/login')}>
                    {page.switchLink}
                  </a>
                </p>
              ) : null}
              {mode === 'login' && registrationOpen === false ? (
                <p className="sc-auth-switch">{t.closed.title}.</p>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
      <footer className="sc-auth-footer">{t.footer}</footer>
    </main>
  );
};

export default LoginPage;
