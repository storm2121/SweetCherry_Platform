import { useState } from 'react';
import '../../styles/workspace.css';
import '../../styles/farmer-shell.css';
import Brand from '../../components/Brand.jsx';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../context/useAuth.js';
import { useTTS } from '../../hooks/useTTS.js';
import PageWeather from './PageWeather.jsx';
import PageClimate from './PageClimate.jsx';
import PagePrices from './PagePrices.jsx';
import PagePriceForecast from './PagePriceForecast.jsx';
import PageChat from './PageChat.jsx';
import PageGallery from './PageGallery.jsx';
import PageExpertQuestions from './PageExpertQuestions.jsx';
import ProfileModal from '../../components/ProfileModal.jsx';
import HydroponicsDashboard from '../HydroponicsDashboard/HydroponicsDashboard.jsx';

// Five sections; market and experts each hold two related views.
const SECTIONS = [
  { id: 'farm', icon: 'weather', label: 'المزرعة' },
  {
    id: 'market',
    icon: 'chart',
    label: 'السوق',
    views: [
      { id: 'forecast', label: 'نطاقات الأسعار' },
      { id: 'prices', label: 'أسعار الحقل' },
    ],
  },
  {
    id: 'experts',
    icon: 'leaf',
    label: 'الخبراء',
    views: [
      { id: 'questions', label: 'أسئلتي' },
      { id: 'photos', label: 'صوري المرسلة' },
    ],
  },
  { id: 'climate', icon: 'map', label: 'المناخ' },
  { id: 'community', icon: 'chat', label: 'المجتمع' },
];

const VIEWS = {
  farm: PageWeather,
  forecast: PagePriceForecast,
  prices: PagePrices,
  questions: PageExpertQuestions,
  photos: PageGallery,
  climate: PageClimate,
  community: PageChat,
};

// ---- read aloud -----------------------------------------------------------
const TTS_SELECTORS = ['[data-tts-chunk]', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'li', 'strong', 'small'].join(', ');

const hasReadableText = (el) => {
  if (el.dataset.ttsSkip === 'true') return false;
  const textNodes = Array.from(el.childNodes || []).filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
  if (textNodes.length) return true;
  return !el.childElementCount && Boolean(el.textContent?.trim());
};

const collectReadableElements = () =>
  Array.from(document.querySelectorAll(`.farm-main ${TTS_SELECTORS.split(', ').join(', .farm-main ')}`)).filter(
    (el) => el.offsetParent !== null && hasReadableText(el) && !el.closest('[data-tts-skip="true"]'),
  );

const FarmerDashboard = () => {
  const { user } = useAuth();
  const [sectionId, setSectionId] = useState('farm');
  const [viewBySection, setViewBySection] = useState({ market: 'forecast', experts: 'questions' });
  const [showProfile, setShowProfile] = useState(false);
  const [showHydroponics, setShowHydroponics] = useState(false);
  const { speaking, speakElements, stop } = useTTS();

  if (showHydroponics) {
    return <HydroponicsDashboard onBack={() => setShowHydroponics(false)} userId={user?.uid} />;
  }

  const section = SECTIONS.find((item) => item.id === sectionId) ?? SECTIONS[0];
  const viewId = section.views ? viewBySection[section.id] : section.id;
  const View = VIEWS[viewId] ?? PageWeather;

  const openSection = (id) => {
    if (speaking) stop();
    setSectionId(id);
    window.scrollTo(0, 0);
  };

  const readAloud = () => (speaking ? stop() : speakElements(collectReadableElements()));

  return (
    <div className="farm" dir="rtl">
      <header className="farm-header" data-tts-skip="true">
        <div className="farm-header__inner">
          <Brand compact />
          <nav className="farm-nav farm-nav--top" aria-label="أقسام المنصة">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="farm-nav__item"
                aria-current={item.id === section.id ? 'page' : undefined}
                onClick={() => openSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="farm-header__tools">
            <button type="button" className="farm-tool" aria-pressed={speaking} onClick={readAloud}>
              <Icon name={speaking ? 'stop' : 'speaker'} size={19} />
              <span>{speaking ? 'إيقاف القراءة' : 'قراءة الصفحة'}</span>
            </button>
            <button type="button" className="farm-account" onClick={() => setShowProfile(true)} aria-label="الحساب والإعدادات">
              <span className="farm-account__name">{user?.name || 'حسابي'}</span>
              <span className="farm-account__region">
                <Icon name="location" size={14} />
                {user?.city || 'المنطقة غير محددة'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="farm-main" id="farm-content">
        {section.views ? (
          <div className="farm-views" role="tablist" aria-label={section.label} data-tts-skip="true">
            {section.views.map((view) => (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={viewId === view.id}
                className="farm-views__item"
                onClick={() => setViewBySection((current) => ({ ...current, [section.id]: view.id }))}
              >
                {view.label}
              </button>
            ))}
          </div>
        ) : null}
        <View />
      </main>

      <nav className="farm-nav farm-nav--bottom" aria-label="أقسام المنصة" data-tts-skip="true">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="farm-nav__item"
            aria-current={item.id === section.id ? 'page' : undefined}
            onClick={() => openSection(item.id)}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {showProfile ? (
        <ProfileModal onClose={() => setShowProfile(false)} onOpenHydroponics={() => setShowHydroponics(true)} />
      ) : null}
    </div>
  );
};

export default FarmerDashboard;
