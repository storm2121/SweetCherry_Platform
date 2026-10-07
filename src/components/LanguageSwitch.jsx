import { LANGUAGES, LANGUAGE_NAMES } from '../i18n/language.js';

const SHORT_NAMES = { fr: 'FR', en: 'EN', ar: 'ع' };
const GROUP_LABEL = { fr: 'Langue', en: 'Language', ar: 'اللغة' };

// Three-way language choice for the public pages. Each option is labelled in
// its own language so a reader can find theirs.
const LanguageSwitch = ({ lang, onChange }) => (
  <div className="sc-lang-switch" role="group" aria-label={GROUP_LABEL[lang]}>
    {LANGUAGES.map((code) => (
      <button
        key={code}
        type="button"
        lang={code}
        aria-pressed={lang === code}
        aria-label={LANGUAGE_NAMES[code]}
        onClick={() => onChange(code)}
      >
        <span className="sc-lang-switch__long">{LANGUAGE_NAMES[code]}</span>
        <span className="sc-lang-switch__short" aria-hidden="true">{SHORT_NAMES[code]}</span>
      </button>
    ))}
  </div>
);

export default LanguageSwitch;
