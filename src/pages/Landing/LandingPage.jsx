import Brand from '../../components/Brand.jsx';
import LanguageSwitch from '../../components/LanguageSwitch.jsx';
import { useRegionsWeather } from '../../hooks/useRegionsWeather.js';
import { useRegistrationOpen } from '../../hooks/useRegistrationOpen.js';
import { dirFor, usePublicLanguage } from '../../i18n/language.js';
import { COPY } from './copy.js';
import ForecastPreview from './ForecastPreview.jsx';
import RegionWeather from './RegionWeather.jsx';
import SatelliteFigure from './SatelliteFigure.jsx';
import '../../styles/public.css';
import '../../styles/landing.css';

const LandingPage = ({ onNavigate }) => {
  const [lang, setLang] = usePublicLanguage();
  const t = COPY[lang];
  const weather = useRegionsWeather();
  // null while checking; registration links appear only once it is known to be open.
  const registrationOpen = useRegistrationOpen();

  const go = (event, path) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <div className="sc-public lp" lang={lang} dir={dirFor(lang)}>
      <a className="lp-skip" href="#main">{t.skip}</a>

      <header className="lp-header">
        <div className="lp-container lp-header__row">
          <a className="lp-brand" href="/" aria-label="SweetCherry">
            <Brand compact />
          </a>
          <nav className="lp-nav" aria-label={t.navLabel}>
            {t.nav.map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>
          <div className="lp-header__actions">
            <LanguageSwitch lang={lang} onChange={setLang} />
            <a className="lp-signin" href="/login" onClick={(event) => go(event, '/login')}>
              {t.signIn}
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-intro" aria-labelledby="intro-title">
          <div className="lp-container lp-intro__grid">
            <div className="lp-intro__copy">
              <h1 id="intro-title">{t.intro.title}</h1>
              <p className="lp-lede">{t.intro.body}</p>
              {registrationOpen === false ? (
                <div className="lp-paused" role="status">
                  <strong>{t.intro.closedTitle}</strong>
                  <p>{t.intro.closedNote}</p>
                </div>
              ) : null}
              <div className="lp-actions">
                {registrationOpen ? (
                  <a className="lp-button" href="/register" onClick={(event) => go(event, '/register')}>
                    {t.intro.register}
                  </a>
                ) : null}
                <a
                  className={registrationOpen ? 'lp-button lp-button--quiet' : 'lp-button'}
                  href="/login"
                  onClick={(event) => go(event, '/login')}
                >
                  {t.signIn}
                </a>
              </div>
              {registrationOpen ? (
                <p className="lp-expert">
                  {t.intro.expertPrompt}{' '}
                  <a href="/register/expert" onClick={(event) => go(event, '/register/expert')}>{t.intro.expertLink}</a>.{' '}
                  {t.intro.expertNote}
                </p>
              ) : null}
            </div>
            <SatelliteFigure t={t.figure} lang={lang} weather={weather} />
          </div>
        </section>

        <ForecastPreview t={t.forecast} lang={lang} />

        <section className="lp-section" id="weather" aria-labelledby="weather-title">
          <div className="lp-container">
            <header className="lp-head">
              <h2 id="weather-title">{t.weather.title}</h2>
              <p>{t.weather.lead}</p>
            </header>
            <RegionWeather t={t.weather} lang={lang} weather={weather} />
          </div>
        </section>

        <section className="lp-section lp-photos" id="photos" aria-labelledby="photos-title">
          <div className="lp-container lp-photos__grid">
            <div className="lp-photos__copy">
              <h2 id="photos-title">{t.photos.title}</h2>
              {t.photos.body.map((paragraph) => (
                <p key={paragraph.slice(0, 32)}>{paragraph}</p>
              ))}
            </div>
            <div className="lp-diseases">
              <h3 id="diseases-title">{t.photos.diseasesTitle}</h3>
              <ul aria-labelledby="diseases-title">
                {t.photos.diseases.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer__grid">
          <div className="lp-footer__about">
            <Brand compact />
            <p>{t.footer.about}</p>
          </div>
          <div>
            <h2>{t.footer.account}</h2>
            <ul>
              <li><a href="/login" onClick={(event) => go(event, '/login')}>{t.signIn}</a></li>
              {registrationOpen ? (
                <>
                  <li><a href="/register" onClick={(event) => go(event, '/register')}>{t.footer.register}</a></li>
                  <li><a href="/register/expert" onClick={(event) => go(event, '/register/expert')}>{t.footer.expert}</a></li>
                </>
              ) : null}
            </ul>
          </div>
          <div>
            <h2>{t.footer.sources}</h2>
            <ul className="lp-footer__sources">
              {t.footer.sourceList.map((source) => (
                <li key={source.link}>
                  {source.before}
                  <a href={source.href} rel="noreferrer" target="_blank">{source.link}</a>
                  {source.after}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
