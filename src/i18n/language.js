import { useEffect, useState } from 'react';

// Languages of the public pages (landing, sign-in, registration, the expert
// waiting page). French is the default; the choice is remembered per browser.
// The signed-in workspaces are still Arabic only.
export const LANGUAGES = ['fr', 'en', 'ar'];
export const DEFAULT_LANGUAGE = 'fr';
export const LANGUAGE_NAMES = { fr: 'Français', en: 'English', ar: 'العربية' };
export const LOCALES = { fr: 'fr-MA', en: 'en-GB', ar: 'ar-MA' };

const STORAGE_KEY = 'sweetcherry.language';

export const dirFor = (lang) => (lang === 'ar' ? 'rtl' : 'ltr');

export const storedLanguage = () => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

const storeLanguage = (lang) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private browsing: the choice lasts for this visit only.
  }
};

// The page language, kept in step with <html lang/dir> so screen readers and
// browser translation pick the right one.
export const usePublicLanguage = () => {
  const [lang, setLang] = useState(storedLanguage);

  useEffect(() => {
    const root = document.documentElement;
    const previous = { lang: root.lang, dir: root.dir };
    root.lang = lang;
    root.dir = dirFor(lang);
    return () => {
      root.lang = previous.lang;
      root.dir = previous.dir;
    };
  }, [lang]);

  const choose = (next) => {
    if (!LANGUAGES.includes(next)) return;
    setLang(next);
    storeLanguage(next);
  };

  return [lang, choose];
};
