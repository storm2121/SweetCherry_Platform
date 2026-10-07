import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import { useWeather } from '../../hooks/useWeather.js';
import NotesList from '../../components/NotesList.jsx';
import AiNoteCard from '../../components/AiNoteCard.jsx';
import PlantScanCard from '../../components/PlantScanCard.jsx';
import { subscribeAiNotes, subscribeFarmerNotes } from '../../services/farmerService.js';
import { ensureAiNoteForRegion } from '../../services/aiNotesService.js';
import { contextDate, contextNumber, contextSource, contextTimestamp, weatherGuidance } from '../../utils/fieldPresentation.js';
import '../../styles/field-context.css';

const PageWeather = () => {
  const { user } = useAuth();
  const { weather, loading: weatherLoading, error: weatherError } = useWeather(user?.city);
  const [notes, setNotes] = useState([]);
  const [aiNote, setAiNote] = useState(null);
  const [noteError, setNoteError] = useState('');
  const aiRequestRef = useRef(false);

  useEffect(() => {
    const unsubNotes = subscribeFarmerNotes(user?.city, setNotes);
    const unsubAi = subscribeAiNotes(user?.city, setAiNote);
    return () => {
      unsubNotes?.();
      unsubAi?.();
    };
  }, [user?.city]);

  useEffect(() => {
    if (!user?.city || weatherLoading || weather?.dataStatus !== 'live') return;
    if (!Array.isArray(weather.forecast) || !weather.forecast.length) return;
    const generatedAtMs = contextTimestamp(aiNote?.generatedAt);
    const fresh = generatedAtMs && Date.now() - generatedAtMs < 24 * 60 * 60 * 1000;
    if (fresh || aiRequestRef.current) return;

    let ignore = false;
    aiRequestRef.current = true;
    const weatherSummary = {
      temperature: weather.temperature,
      condition: weather.condition,
      humidity: weather.humidity,
      risk: weather.risk,
      forecast: weather.forecast,
    };
    ensureAiNoteForRegion({ region: user.city, weatherSummary })
      .then((note) => {
        if (!ignore && note) {
          setAiNote(note);
          setNoteError('');
        }
      })
      .catch(() => {
        if (!ignore) setNoteError('تعذر تحديث المذكرة الزراعية. يمكنك الرجوع إلى ملاحظات الخبير.');
      })
      .finally(() => { aiRequestRef.current = false; });
    return () => { ignore = true; };
  }, [user?.city, weather, aiNote, weatherLoading]);

  const current = weather || {};
  const guidance = weatherGuidance(current, weatherLoading);
  const weatherKeyBase = user?.city ? 'weather-card-' + user.city : 'weather-card-unknown';
  const fingerprint = useMemo(() => buildWeatherFingerprint(weather), [weather]);
  const forecast = Array.isArray(current.forecast) ? current.forecast : [];
  const statusLabel = weatherLoading ? 'جارٍ التحديث'
    : current.dataStatus === 'live' ? 'بيانات حالية'
    : current.dataStatus === 'partial' ? 'بيانات غير مكتملة' : 'الطقس غير متاح';

  return (
    <section className="weather-page" aria-label="الطقس وإرشادات المزرعة">
      <section
        className="field-surface"
        aria-labelledby="local-weather-title"
        aria-busy={weatherLoading}
        data-tts-key={weatherKeyBase + '-' + fingerprint}
        data-tts-clean-prefix={weatherKeyBase}
      >
        <div className="field-heading">
          <div>
            <p className="field-eyebrow">قراءة المزرعة</p>
            <h2 id="local-weather-title">الطقس في {user?.city || 'منطقتك'}</h2>
            <p className="field-muted">المؤشرات الحالية والتوقع القريب قبل ترتيب أعمال الحقل.</p>
          </div>
          <span className={'field-status' + (current.dataStatus === 'partial' ? ' field-status--warning' : '')}>
            {statusLabel}
          </span>
        </div>

        <dl className="weather-observations">
          <WeatherMetric label="درجة الحرارة" value={contextNumber(current.temperature, '°م')} />
          <WeatherMetric label="الرطوبة" value={contextNumber(current.humidity, '%', 0)} />
          <WeatherMetric label="الحالة" value={current.conditionAr || 'غير متاح'} text />
          <WeatherMetric label="تقييم المخاطر" value={current.riskLabel || 'غير متاح'} text />
        </dl>

        {weatherError ? <p className="field-muted" role="status">{weatherError}</p> : null}
        <div className={'field-notice field-notice--' + guidance.tone} role="status">
          <strong>{guidance.title}</strong>
          <p className="field-muted">{guidance.message}</p>
        </div>

        {forecast.length ? (
          <section className="weather-forecast" aria-labelledby="near-weather-title">
            <h3 id="near-weather-title">التوقع القريب</h3>
            <div className="weather-forecast__days">
              {forecast.map((day, index) => (
                <article className="weather-forecast__day" key={day.date || index}>
                  <h4>{contextDate(day.date, true)}</h4>
                  <p className="field-muted">{day.conditionAr || 'الحالة غير متاحة'}</p>
                  <dl>
                    <dt>العظمى</dt><dd><bdi>{contextNumber(day.tempMax, '°م')}</bdi></dd>
                    <dt>الصغرى</dt><dd><bdi>{contextNumber(day.tempMin, '°م')}</bdi></dd>
                    <dt>احتمال المطر</dt><dd><bdi>{contextNumber(day.rainChance, '%', 0)}</bdi></dd>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="field-data-meta">
          <span>المصدر: <bdi>{contextSource(current.source)}</bdi></span>
          <span>وقت الرصد: {contextDate(current.asOf)}</span>
          <span>التوقيت: المغرب</span>
        </div>
      </section>

      <div className="weather-lower">
        <AiNoteCard
          note={aiNote}
          regionKey={user?.city ? 'ai-note-' + user.city : undefined}
          error={noteError}
        />
        <section className="field-surface" aria-labelledby="expert-guidance-title">
          <div className="field-heading">
            <div>
              <p className="field-eyebrow">من الخبير إلى الحقل</p>
              <h2 id="expert-guidance-title">ملاحظات الخبراء</h2>
              <p className="field-muted">التوجيهات الحالية المنشورة لمنطقتك.</p>
            </div>
          </div>
          <div style={{ marginTop: '1.2rem' }}><NotesList notes={notes} /></div>
        </section>
      </div>

      <PlantScanCard />
    </section>
  );
};

const WeatherMetric = ({ label, value, text = false }) => (
  <div className={'weather-observation' + (text ? ' weather-observation--text' : '')}>
    <dt>{label}</dt>
    <dd><bdi>{value}</bdi></dd>
  </div>
);

const buildWeatherFingerprint = (weather = {}) => {
  const parts = [
    weather?.temperature, weather?.condition, weather?.humidity,
    weather?.risk, weather?.dataStatus, weather?.asOf,
    ...(weather?.forecast || []).map((day) => [
      day.date, day.tempMax, day.tempMin, day.rainChance, day.conditionAr,
    ].join('-')),
  ].join('|');
  let hash = 0;
  for (let i = 0; i < parts.length; i += 1) {
    hash = (hash << 5) - hash + parts.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

export default PageWeather;

