import { GROWING_REGIONS } from '../../data/growingRegions.js';
import { formatTemp } from './format.js';

// Bounds of the satellite crop as requested from NASA GIBS (EPSG:4326).
// The image is linear in latitude and longitude, so towns are placed by
// simple proportion.
const BOUNDS = { south: 33.25, north: 34.75, west: -5.9, east: -4.1 };
const WIDTH_KM = (BOUNDS.east - BOUNDS.west) * 111.32 * Math.cos((34 * Math.PI) / 180);
const SCALE_KM = 25;

const place = (lat, lon) => ({
  left: `${((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * 100}%`,
  top: `${((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * 100}%`,
});

// Label side for each town, chosen so neighbouring labels do not overlap.
// Geographic sides: the map is not mirrored in Arabic.
const LABEL_SIDE = { sefrou: 'east', azrou: 'west', ifrane: 'east', 'el-hajeb': 'west', taounate: 'east' };
const REFERENCE_TOWNS = [
  { id: 'fes', lat: 34.033, lon: -5.0, side: 'east' },
  { id: 'meknes', lat: 33.895, lon: -5.555, side: 'west' },
];

const SatelliteFigure = ({ t, lang, weather }) => {
  const readings = new Map(weather.regions.map((region) => [region.id, region]));
  const time = weather.regions.find((region) => region.time)?.time?.slice(11, 16);

  return (
    <figure className="lp-sat">
      <div className="lp-sat__frame">
        <img
          src="/images/saiss-2024-02-19-1200.jpg"
          srcSet="/images/saiss-2024-02-19-760.jpg 760w, /images/saiss-2024-02-19-1200.jpg 1200w"
          sizes="(min-width: 960px) 540px, calc(100vw - 32px)"
          width="1200"
          height="1206"
          alt={t.alt}
        />
        <ul className="lp-sat__pins" aria-label={t.pinsLabel}>
          {GROWING_REGIONS.map((region) => {
            const temperature = readings.get(region.id)?.temperature;
            return (
              <li key={region.id} className={`lp-pin lp-pin--${LABEL_SIDE[region.id]}`} style={place(region.lat, region.lon)}>
                <span className="lp-pin__label">
                  <strong>{region[lang]}</strong>
                  {temperature !== null && temperature !== undefined ? (
                    <span className="lp-pin__temp">{formatTemp(temperature, lang)}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
          {REFERENCE_TOWNS.map((town) => (
            <li key={town.id} className={`lp-pin lp-pin--ref lp-pin--${town.side}`} style={place(town.lat, town.lon)}>
              <span className="lp-pin__label">{t.reference[town.id]}</span>
            </li>
          ))}
        </ul>
        <div className="lp-sat__scale" style={{ width: `${(SCALE_KM / WIDTH_KM) * 100}%` }} aria-hidden="true">
          <span>{t.scale}</span>
        </div>
      </div>
      <figcaption>
        <span>{t.caption}</span>
        {weather.status === 'ready' && time ? <span>{t.tempsAt(time)}</span> : null}
        {weather.status === 'error' ? <span>{t.tempsError}</span> : null}
      </figcaption>
    </figure>
  );
};

export default SatelliteFigure;
