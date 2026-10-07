import { contextDate, contextNumber, contextSource } from '../utils/fieldPresentation.js';
import '../styles/field-context.css';

const STATUS_META = {
  ready: { label: 'متاح', tone: 'ready', message: 'تتوفر سجلات طقس للفترة السابقة للصورة.' },
  partial: { label: 'سجلات محدودة', tone: 'warning', message: 'تتوفر بعض السجلات، لكن فترة المتابعة غير مكتملة.' },
  missing_region: { label: 'المنطقة غير محددة', tone: 'danger', message: 'لم تُحدد منطقة الطقس المرتبطة بهذه الصورة.' },
  insufficient_cache: { label: 'سجلات غير متاحة', tone: 'warning', message: 'لا تتوفر سجلات للفترة والمنطقة المطلوبتين.' },
};

const WeatherContextPanel = ({ diagnosis, compact = false }) => {
  const context = diagnosis?.weatherContext;
  const meta = context ? STATUS_META[context.status] || {
    label: 'قيد التحقق', tone: 'warning', message: 'لم يتأكد توفر السياق الجوي لهذه الصورة.',
  } : {
    label: 'لم يُضف بعد', tone: 'warning', message: 'لم تُرفق سجلات الطقس بهذا الطلب بعد.',
  };
  const metrics = context?.metrics;
  const lookback = context?.lookback;
  const requested = Number.isFinite(lookback?.daysRequested) ? lookback.daysRequested : null;
  const available = Number.isFinite(lookback?.daysAvailable) ? lookback.daysAvailable : null;
  const incomplete = requested !== null && available !== null && available < requested;
  const period = lookback?.startDateKey && lookback?.endDateKey
    ? contextDate(lookback.startDateKey, true) + ' إلى ' + contextDate(lookback.endDateKey, true)
    : 'فترة السجلات غير محددة';
  const coverage = available !== null && requested !== null
    ? contextNumber(available, '', 0) + ' من ' + contextNumber(requested, '', 0) + ' يوماً'
    : 'التغطية غير محددة';

  return (
    <section className={'weather-context' + (compact ? ' weather-context--compact' : '')} aria-label="السياق الجوي السابق للصورة">
      <div className="field-heading">
        <div>
          {!compact ? <p className="field-eyebrow">سياق المراجعة</p> : null}
          <h3>{compact ? 'السياق الجوي' : 'الطقس قبل التقاط الصورة'}</h3>
          <p className="field-muted">
            {context?.regionName || diagnosis?.farmerRegion || 'المنطقة غير محددة'}
            {context?.diagnosisDateKey ? ' · تاريخ الصورة: ' + contextDate(context.diagnosisDateKey, true) : ''}
          </p>
        </div>
        <span className={'field-status field-status--' + meta.tone}>{meta.label}</span>
      </div>

      {!metrics ? (
        <p className="field-muted">{meta.message}</p>
      ) : compact ? (
        <p className="field-muted">
          الهطول في نافذة 7 أيام: <bdi>{contextNumber(metrics.rainLast7dMm, 'مم')}</bdi>
          {' · '}الرطوبة في نافذة 14 يوماً: <bdi>{contextNumber(metrics.humidityMean14dPct, '%', 0)}</bdi>
        </p>
      ) : (
        <dl className="weather-context__metrics">
          <WeatherMetric label="الهطول · آخر 7 أيام" value={contextNumber(metrics.rainLast7dMm, 'مم')} />
          <WeatherMetric label="الهطول · آخر 30 يوماً" value={contextNumber(metrics.rainLast30dMm, 'مم')} />
          <WeatherMetric label="متوسط الرطوبة · 14 يوماً" value={contextNumber(metrics.humidityMean14dPct, '%', 0)} />
          <WeatherMetric label="أطول تتابع للأيام الممطرة · 30 يوماً" value={contextNumber(metrics.wetStreakMax30d, 'أيام', 0)} />
          <WeatherMetric label="أيام الحرارة · 30 يوماً" value={contextNumber(metrics.heatDays30d, 'أيام', 0)} />
          <WeatherMetric label="أيام الصقيع · 30 يوماً" value={contextNumber(metrics.frostDays30d, 'أيام', 0)} />
        </dl>
      )}

      {context ? (
        <div className="field-data-meta">
          <span>المصدر: <bdi>{contextSource(context.provider)}</bdi></span>
          <span>الفترة: {period}</span>
          <span>السجلات المتاحة: {coverage}</span>
          {context.populatedAt ? <span>أُرفقت في: {contextDate(context.populatedAt)}</span> : null}
        </div>
      ) : null}
      {metrics ? (
        <p className="field-muted">
          {incomplete
            ? 'التغطية غير مكتملة؛ هذه المؤشرات محسوبة من الأيام المتاحة ولا تمثل رصداً كاملاً للفترة.'
            : 'هذه المؤشرات تلخص السجلات الجوية المتاحة وتساعد الخبير على قراءة الصورة؛ ليست تشخيصاً للنبات.'}
        </p>
      ) : null}
    </section>
  );
};

const WeatherMetric = ({ label, value }) => (
  <div className="weather-context__metric">
    <dt>{label}</dt>
    <dd><bdi>{value}</bdi></dd>
  </div>
);

export default WeatherContextPanel;

