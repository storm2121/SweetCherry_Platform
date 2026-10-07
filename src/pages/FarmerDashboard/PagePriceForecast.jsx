import { useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useForecastRows } from '../../hooks/useForecastRows.js';
import { GRADES, MARKET_LABELS } from '../../services/forecastService.js';
import {
  observationCalendarDate, observationKey, selectForecastRows, summarizeObservations, timestampMillis,
} from '../../utils/forecastData.js';
import '../../styles/priceForecast.css';

const HORIZONS = [
  { id: 'all', label: 'كل المدد' },
  { id: 'short_term', label: '1–8 أسابيع' },
  { id: 'medium_term', label: '9–52 أسبوعاً' },
  { id: 'long_range', label: '1–5 سنوات' },
];
const HORIZON_NAMES = { short_term: 'قصير', medium_term: 'متوسط', long_range: 'بعيد' };
const dateFormatter = new Intl.DateTimeFormat('ar-MA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const numberFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const formatPrice = (value) => numberFormatter.format(value);
const formatDate = (value) => dateFormatter.format(new Date(value + 'T00:00:00Z'));
const horizonLabel = (row) => {
  if (/^\d{4}$/.test(row.horizon)) return 'سنة ' + row.horizon;
  const weekly = row.horizon.match(/^(\d+)(?:[–—-](\d+))?\s*(?:w|wk|wks|week|weeks)$/i);
  const annual = row.horizon.match(/^(\d+)(?:[–—-](\d+))?\s*(?:y|yr|yrs|year|years)$/i);
  if (weekly) return weekly[1] + (weekly[2] ? '–' + weekly[2] : '') + ' أسبوع';
  if (annual) return annual[1] + (annual[2] ? '–' + annual[2] : '') + ' سنة';
  return 'المدة غير مرفقة';
};
const rowKey = (row, index) => [row.date, row.market, row.horizonType, row.horizon, index].join('|');

const PagePriceForecast = () => {
  const [grade, setGrade] = useState('A');
  const [selectedMarket, setMarket] = useState('');
  const [horizon, setHorizon] = useState('all');
  const data = useForecastRows(grade);
  const market = data.markets.includes(selectedMarket) ? selectedMarket : data.markets[0] || '';
  const rows = useMemo(() => selectForecastRows(data.rows, market, horizon), [data.rows, market, horizon]);
  const chartData = useMemo(() => rows.map((row, index) => {
    const observation = summarizeObservations(row, data.observations.get(observationKey(row.market, row.date)) || []);
    const band = row.low !== null && row.high !== null ? [row.low, row.high] : null;
    return {
      short_expected: row.horizonType === 'short_term' ? row.expected : null,
      medium_expected: row.horizonType === 'medium_term' ? row.expected : null,
      long_expected: row.horizonType === 'long_range' ? row.expected : null,
      short_band: row.horizonType === 'short_term' ? band : null,
      medium_band: row.horizonType === 'medium_term' ? band : null,
      long_band: row.horizonType === 'long_range' ? band : null,
      ...row,
      key: rowKey(row, index),
      displayDate: formatDate(row.date),
      band: row.low !== null && row.high !== null ? [row.low, row.high] : null,
      observed: observation?.average ?? null,
      observation,
    };
  }), [rows, data.observations]);

  return (
    <section className="price-forecast" aria-labelledby="price-forecast-title" data-tts-key="price-forecast-page">
      <header className="price-forecast__heading">
        <div>
          <p className="price-forecast__eyebrow">تخطيط البيع</p>
          <h2 id="price-forecast-title">توقعات أسعار الكرز</h2>
          <p>تابع السعر الأوسط والنطاق المتوقع حسب السوق ودرجة الجودة ومدة التوقع.</p>
        </div>
        <span className="price-forecast__unit">درهم / كغ</span>
      </header>

      <div className="price-forecast__controls">
        <fieldset>
          <legend>درجة الجودة</legend>
          <div className="price-forecast__buttons">
            {GRADES.map((value) => <button type="button" key={value} aria-pressed={grade === value} onClick={() => setGrade(value)}>درجة <bdi>{value}</bdi></button>)}
          </div>
        </fieldset>
        <label className="price-forecast__market">
          السوق
          <select value={market} onChange={(event) => setMarket(event.target.value)} disabled={!data.markets.length}>
            {!data.markets.length ? <option value="">لا توجد أسواق متاحة</option> : null}
            {data.markets.map((value) => <option key={value} value={value}>{MARKET_LABELS[value] || value}</option>)}
          </select>
        </label>
        <fieldset className="price-forecast__horizons">
          <legend>مدة التوقع</legend>
          <div className="price-forecast__buttons">
            {HORIZONS.map((value) => <button type="button" key={value.id} aria-pressed={horizon === value.id} onClick={() => setHorizon(value.id)}>{value.label}</button>)}
          </div>
        </fieldset>
      </div>

      <Provenance data={data} />

      {data.loading ? <p className="price-forecast__state" role="status">جاري تحميل توقعات درجة {grade}…</p> : null}
      {data.error ? <p className="price-forecast__state price-forecast__state--error" role="alert">{data.error}</p> : null}
      {!data.loading && !data.error && !rows.length ? (
        <div className="price-forecast__state">
          <h3>{data.rows.length ? 'لا توجد توقعات لهذه المدة' : 'التوقعات غير متاحة حالياً'}</h3>
          <p>{data.rows.length ? 'اختر مدة أخرى أو سوقاً آخر لعرض البيانات المتاحة.' : 'ستظهر التوقعات عند نشر بيانات صالحة لهذه الدرجة. لا توجد أسعار تقديرية بديلة.'}</p>
        </div>
      ) : null}

      {!data.loading && !data.error && rows.length > 0 ? (
        <>
          <div className="price-forecast__chart">
            <div className="price-forecast__chart-heading">
              <h3>{MARKET_LABELS[market] || market} · درجة <bdi>{grade}</bdi></h3>
              <span>{rows.length} توقع</span>
            </div>
            <p id="forecast-chart-description" className="price-forecast__chart-description">
              الخط يمثل السعر الأوسط P50، والمساحة المظللة النطاق P10–P90 عندما يكون مرفقاً. التواريخ والأسعار نفسها متاحة في الجدول أدناه.
            </p>
            <div role="img" aria-label="السعر المتوقع عبر التواريخ المختارة" aria-describedby="forecast-chart-description">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chartData} margin={{ top: 12, left: 8, right: 8, bottom: 12 }} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="#e8e9e3" strokeDasharray="3 3" />
                  <XAxis dataKey="key" tickFormatter={(key) => chartData.find((row) => row.key === key)?.displayDate || ''} interval="preserveStartEnd" tick={{ fontSize: 10, fill: '#687363' }} tickLine={false} />
                  <YAxis orientation="right" width={44} tick={{ fontSize: 11, fill: '#687363' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Area dataKey="short_band" fill="#dce6d7" fillOpacity={0.8} stroke="none" connectNulls={false} isAnimationActive={false} />
                  <Area dataKey="medium_band" fill="#eee4d0" fillOpacity={0.7} stroke="none" connectNulls={false} isAnimationActive={false} />
                  <Area dataKey="long_band" fill="#ecdde1" fillOpacity={0.6} stroke="none" connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="short_expected" name="P50 قصير" stroke="#526946" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  <Line dataKey="medium_expected" name="P50 متوسط" stroke="#96763f" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  <Line dataKey="long_expected" name="P50 بعيد" stroke="#ab5466" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  <Line dataKey="observed" name="بلاغات مطابقة" stroke="none" dot={{ r: 4, fill: '#ab5466', stroke: '#fff', strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="price-forecast__legend"><span aria-hidden="true" /> الخط: أخضر للقصير، ذهبي للمتوسط، وردي للبعيد · النقاط: متوسط بلاغات مطابقة</p>
          </div>
          <ForecastTable key={grade + market + horizon} rows={rows} observations={data.observations} market={market} grade={grade} />
        </>
      ) : null}

      <aside className="price-forecast__guidance" aria-label="كيف تستخدم التوقعات">
        <h3>استخدم التوقعات للمقارنة قبل البيع</h3>
        <p>P50 هو التقدير الأوسط، وليس سعر بيع مضموناً. النطاق بين P10 وP90 يصف تقديرات النموذج، وقد تقع الأسعار خارجه. قارن بعروض السوق وتكاليف النقل وجودة المحصول؛ وعندما لا يُرفق النطاق، لا يمكن تقدير عدم اليقين من هذه البيانات.</p>
        <p>بلاغات المزارعين ملاحظات غير متحقق منها. تُعرض فقط عند تطابق السوق والدرجة والتاريخ، ولا تمثل قياساً لدقة النموذج.</p>
      </aside>
    </section>
  );
};

const Provenance = ({ data }) => {
  const [now] = useState(() => Date.now());
  const updated = timestampMillis(data.updatedAt);
  const generated = timestampMillis(data.generatedAt);
  const today = observationCalendarDate(now);
  const pastCount = data.rows.filter((row) => row.date < today).length;
  const daysOld = updated === null ? null : Math.max(0, Math.floor((now - updated) / 86400000));
  return (
    <div className="price-forecast__provenance" aria-live="polite">
      {data.provenance === 'synthetic' ? <p className="price-forecast__notice">بيانات محاكاة للتجربة. ليست أسعار سوق فعلية ولا توقعات موثقة ميدانياً. {data.dataCutoff ? 'آخر تاريخ في بيانات المحاكاة: ' + data.dataCutoff + ' .' : ''}</p> : null}
      <p>آخر رفع للبيانات: {updated === null ? 'التاريخ غير مرفق' : dateFormatter.format(new Date(updated))}.
        {' '}توليد التوقع: {generated === null ? 'التاريخ غير مرفق' : dateFormatter.format(new Date(generated))}.
        {typeof data.sourceName === 'string' ? ' المصدر: ' + data.sourceName + '.' : ''}
        {typeof data.modelVersion === 'string' ? ' إصدار النموذج: ' + data.modelVersion + '.' : ''}
      </p>
      {pastCount > 0 ? <p>{pastCount} توقعاً لتواريخ مضت؛ هذه توقعات مؤرشفة وليست أسعاراً فعلية مسجلة.</p> : null}
      {daysOld > 7 ? <p className="price-forecast__notice">مضى أكثر من أسبوع على رفع الملف. تحقق من أحدث بيانات السوق قبل اتخاذ قرار البيع.</p> : null}
      {data.rejectedCount > 0 ? <p className="price-forecast__notice">استُبعد {data.rejectedCount} صفاً بسبب سعر أو تاريخ أو مدة غير صالحة. لم تُصحح هذه القيم تلقائياً.</p> : null}
      {data.incompleteIntervalCount > 0 ? <p>{data.incompleteIntervalCount} توقعاً دون نطاق كامل؛ يُعرض السعر الأوسط فقط في الرسم لهذه الصفوف.</p> : null}
      {data.unscopedObservationCount > 0 ? <p>لم تُعرض {data.unscopedObservationCount} بلاغات ميدانية لغياب سوق أو تاريخ أو سعر صالح للمقارنة.</p> : null}
    </div>
  );
};

const ForecastTooltip = ({ active, payload }) => {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="price-forecast__tooltip" dir="rtl">
    <strong>{row.displayDate}</strong>
    <p>{HORIZON_NAMES[row.horizonType]} · {horizonLabel(row)}</p>
    <p>السعر الأوسط: <bdi>{formatPrice(row.expected)}</bdi> درهم/كغ</p>
    <p>النطاق: {row.band ? <bdi>{formatPrice(row.low)}–{formatPrice(row.high)}</bdi> : 'غير مرفق بالكامل'}</p>
    {row.observation ? <p>متوسط {row.observation.count} بلاغات مطابقة: <bdi>{formatPrice(row.observed)}</bdi></p> : null}
  </div>;
};

const ForecastTable = ({ rows, observations, market, grade }) => {
  const [page, setPage] = useState(0);
  const [today] = useState(() => observationCalendarDate(Date.now()));
  const pages = Math.ceil(rows.length / 20);
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 20, (currentPage + 1) * 20);
  return <div className="price-forecast__table-card">
    <h3>تفاصيل التوقعات</h3>
    <div className="price-forecast__table-scroll" tabIndex={0} aria-label="جدول الأسعار؛ مرر أفقياً عند الحاجة">
      <table>
        <caption>توقعات {MARKET_LABELS[market] || market}، درجة {grade}. جميع الأسعار بالدرهم لكل كيلوغرام.</caption>
        <thead><tr><th scope="col">تاريخ السعر</th><th scope="col">مدة التوقع</th><th scope="col">السعر الأوسط P50</th><th scope="col">النطاق P10–P90</th><th scope="col">بلاغات مطابقة</th></tr></thead>
        <tbody>{visible.map((row, index) => {
          const summary = summarizeObservations(row, observations.get(observationKey(row.market, row.date)) || []);
          return <tr key={rowKey(row, currentPage * 20 + index)}>
            <th scope="row"><time dateTime={row.date}>{formatDate(row.date)}</time>{row.date < today ? <small className="price-forecast__archived">توقع مؤرشف</small> : null}</th>
            <td><span className="price-forecast__horizon-tag">{HORIZON_NAMES[row.horizonType]}</span><br />{horizonLabel(row)}</td>
            <td className="price-forecast__median"><bdi>{formatPrice(row.expected)}</bdi></td>
            <td>{row.low !== null && row.high !== null ? <bdi>{formatPrice(row.low)}–{formatPrice(row.high)}</bdi> : 'غير مرفق بالكامل'}</td>
            <td>{summary ? <><bdi>{formatPrice(summary.min)}{summary.max !== summary.min ? '–' + formatPrice(summary.max) : ''}</bdi><small>{summary.count} بلاغات{summary.outsideCount ? ' · ' + summary.outsideCount + ' خارج النطاق المرفق' : ''}</small></> : <span className="price-forecast__muted">لا توجد</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {pages > 1 ? <nav className="price-forecast__pagination" aria-label="صفحات جدول التوقعات">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>السابق</button>
      <span aria-live="polite">صفحة {currentPage + 1} من {pages}</span>
      <button type="button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>التالي</button>
    </nav> : null}
  </div>;
};

export default PagePriceForecast;
