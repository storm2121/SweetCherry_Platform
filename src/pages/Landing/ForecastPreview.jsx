import { useEffect, useMemo, useState } from 'react';
import { fetchForecastSheet, GRADES } from '../../services/forecastService.js';
import { observationCalendarDate, validateForecastRows } from '../../utils/forecastData.js';
import { seriesEnd, weekContaining, weeklySeries } from '../../utils/landingForecast.js';
import PriceBandChart from './PriceBandChart.jsx';
import { formatDay, formatInstant, formatPrice } from './format.js';

const MARKETS = ['M01', 'M02', 'M03'];

// The published price forecast, read once per grade. Anyone can read the
// forecast sheets (see firestore.rules), so this works before sign-in.
const ForecastPreview = ({ t, lang }) => {
  const [grade, setGrade] = useState(GRADES[0]);
  const [market, setMarket] = useState(MARKETS[0]);
  const [sheets, setSheets] = useState({});
  const [today] = useState(() => observationCalendarDate(Date.now()));

  useEffect(() => {
    if (sheets[grade]) return undefined;
    let active = true;
    fetchForecastSheet(grade)
      .then((data) => active && setSheets((previous) => ({ ...previous, [grade]: { status: 'ready', data } })))
      .catch(() => active && setSheets((previous) => ({ ...previous, [grade]: { status: 'error', data: null } })));
    return () => {
      active = false;
    };
  }, [grade, sheets]);

  const sheet = sheets[grade];
  const rows = useMemo(() => validateForecastRows(sheet?.data?.rows).rows, [sheet]);
  const series = useMemo(() => weeklySeries(rows, market), [rows, market]);
  const current = weekContaining(series, today);
  const published = typeof sheet?.data?.updatedAt?.toDate === 'function' ? sheet.data.updatedAt.toDate() : null;
  const first = series[0]?.date;

  let state = null;
  if (!sheet) state = t.loading;
  else if (sheet.status === 'error') state = t.error;
  else if (series.length < 2) state = t.empty;

  return (
    <section className="lp-band" id="forecast" aria-labelledby="forecast-title">
      <div className="lp-container">
        <header className="lp-head">
          <h2 id="forecast-title">{t.title}</h2>
          <p>{t.lead}</p>
          {sheet?.data?.provenance === 'synthetic' ? <p role="note">{lang === 'ar' ? 'بيانات محاكاة للتجربة؛ ليست أسعار سوق فعلية.' : lang === 'en' ? 'Simulated demonstration data. These are not observed market prices.' : 'Données simulées pour la démonstration. Ce ne sont pas des prix observés sur le marché.'} {sheet.data.dataCutoff ? '(' + sheet.data.dataCutoff + ')' : ''}</p> : null}
        </header>

        <div className="lp-controls">
          <fieldset className="lp-segment">
            <legend>{t.grade}</legend>
            <div>
              {GRADES.map((value) => (
                <label key={value}>
                  <input type="radio" name="lp-grade" value={value} checked={grade === value} onChange={() => setGrade(value)} />
                  <span dir="ltr">{value}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="lp-segment">
            <legend>{t.market}</legend>
            <div>
              {MARKETS.map((value) => (
                <label key={value}>
                  <input type="radio" name="lp-market" value={value} checked={market === value} onChange={() => setMarket(value)} />
                  <span>{t.markets[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {state ? (
          <p className="lp-status" role="status">{state}</p>
        ) : (
          <>
            <div className="lp-forecast">
              <div className="lp-forecast__chart">
                <PriceBandChart
                  series={series}
                  today={today}
                  lang={lang}
                  unit={t.unit}
                  todayLabel={t.today}
                  summary={t.chartLabel(grade, t.markets[market])}
                />
                <ul className="lp-legend">
                  <li><i className="lp-legend__line" aria-hidden="true" />{t.legendMedian}</li>
                  <li><i className="lp-legend__band" aria-hidden="true" />{t.legendRange}</li>
                  <li><i className="lp-legend__past" aria-hidden="true" />{t.legendPast}</li>
                </ul>
              </div>

              <div className="lp-reading" aria-live="polite">
                {current ? (
                  <>
                    <h3>{t.thisWeek}</h3>
                    <dl>
                      <div className="lp-reading__main">
                        <dt>{t.median}</dt>
                        <dd>
                          <span className="lp-reading__value"><b>{formatPrice(current.expected, lang)}</b> {t.unit}</span>
                          <span className="lp-reading__note">{t.medianNote}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>{t.low}</dt>
                        <dd>
                          <span className="lp-reading__value"><b>{formatPrice(current.low, lang)}</b> {t.unit}</span>
                          <span className="lp-reading__note">{t.lowNote}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>{t.high}</dt>
                        <dd>
                          <span className="lp-reading__value"><b>{formatPrice(current.high, lang)}</b> {t.unit}</span>
                          <span className="lp-reading__note">{t.highNote}</span>
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="lp-reading__none">
                    {today < first ? t.notStarted(formatDay(first, lang)) : t.ended(formatDay(seriesEnd(series), lang))}
                  </p>
                )}
              </div>
            </div>

            {published ? <p className="lp-source">{t.updated(formatInstant(published, lang))}</p> : null}
          </>
        )}
      </div>
    </section>
  );
};

export default ForecastPreview;
