import { conditionLabel } from '../../utils/regionsWeather.js';
import { capitalize, formatDay, formatTemp } from './format.js';

// Five areas, coldest (highest) first. Each day shows the high and low; a
// word appears only when rain, frost or heat is worth knowing about.
const RegionWeather = ({ t, lang, weather }) => {
  if (weather.status !== 'ready') {
    return <p className="lp-status" role="status">{weather.status === 'error' ? t.error : t.loading}</p>;
  }
  const regions = [...weather.regions].sort((a, b) => (b.elevation ?? -Infinity) - (a.elevation ?? -Infinity));
  const days = regions.find((region) => region.days.length)?.days ?? [];

  return (
    <>
      <div className="lp-table-wrap" tabIndex={0} role="region" aria-labelledby="weather-title">
        <table className="lp-table lp-weather" aria-describedby="weather-note">
          <thead>
            <tr>
              <th scope="col">{t.region}</th>
              <th scope="col">{t.now}</th>
              {days.map((day, index) => (
                <th scope="col" key={day.date}>
                  {index === 0 ? t.today : capitalize(formatDay(day.date, lang, { weekday: 'long' }))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <th scope="row">{region[lang]}</th>
                <td>
                  <b className="lp-temp">{formatTemp(region.temperature, lang)}</b>
                  <span className="lp-sub">{conditionLabel(region.code, lang) ?? '—'}</span>
                </td>
                {days.map((_, index) => {
                  const day = region.days[index];
                  if (!day) return <td key={index}>—</td>;
                  const flags = [day.frost && ['lp-cold', t.frost], day.heat && ['lp-hot', t.heat], day.wet && ['lp-wet', t.rain]].filter(Boolean);
                  return (
                    <td key={day.date}>
                      <span className="lp-temps">
                        <b className={day.heat ? 'lp-hot' : undefined}>{formatTemp(day.max, lang)}</b>
                        <span className={day.frost ? 'lp-cold' : undefined}>{formatTemp(day.min, lang)}</span>
                      </span>
                      {flags.map(([tone, label]) => (
                        <span key={label} className={`lp-flag ${tone}`}>{label}</span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-note" id="weather-note">{t.caption}</p>
    </>
  );
};

export default RegionWeather;
